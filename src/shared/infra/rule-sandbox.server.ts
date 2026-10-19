import { db, dbConfigured } from "@/shared/infra/postgres/db.server";
import { PostgresStore } from "@/shared/infra/postgres/postgres-store.server";
import { HeuristicExtractor } from "@/shared/infra/heuristic-ai";
import { getOrRefreshRuleSnapshot } from "@/shared/infra/heuristics/rule-registry.server";
import { sanitizeJson } from "@/shared/infra/json-sanitize";
import {
  compileRuleSnapshot,
  ruleTerms,
  RULE_LANGUAGES,
  type DynamicRuleRow,
  type RuleKind,
  type RuleLanguage,
} from "@/shared/contracts/rules";
import { runSandbox, type SandboxResult } from "@/features/evaluation/sandbox";
import { hypothesisId, mineHypotheses } from "@/features/evaluation/hypotheses";
import type { EvalFixture } from "@/features/evaluation/evaluation";
import type { Candidate, Drone } from "@/entities/drone/types";
import type { JSONValue } from "postgres";
import fs from "node:fs";
import path from "node:path";

/**
 * Rule lifecycle on the server: propose → sandbox → (analyst) activate. Activation always
 * re-runs the sandbox against the rules active at that moment, so a verdict computed before
 * another rule went live can never let a regression through.
 */

const KINDS: readonly RuleKind[] = [
  "add_cue",
  "context_filter",
  "add_alias",
  "add_stopword",
  "add_unit_scale",
];
/** Mined hypotheses sandboxed per run (budget, EVALUATION_AUTOMATION §3 princip 4). */
const MAX_SANDBOX_PER_RUN = 8;

/** Serializable JSON, so a RuleView can cross the server-function boundary. */
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export interface RuleView {
  id: string;
  kind: string;
  language: string;
  payload: { [k: string]: Json };
  status: string;
  origin: string;
  targetKey: string | null;
  rationale: string | null;
  evidence: Json;
  createdAt: string;
  promotedAt: string | null;
  lastEvaluation: (SandboxResult & { evaluatedAt: string; rulesVersion: number | null }) | null;
}

export interface ProposeInput {
  kind: RuleKind;
  language?: RuleLanguage;
  payload: Record<string, unknown>;
  targetKey?: string;
  rationale?: string;
  evidence?: unknown;
  origin?: "analyst" | "autonomous_sandbox";
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
const json = (v: unknown) => db().json(sanitizeJson(v as JSONValue));

async function loadWorld() {
  const store = new PostgresStore();
  const drones = ((await store.load("drones")) ?? []) as unknown as Drone[];
  const candidates = ((await store.load("candidates")) ?? []) as unknown as Candidate[];
  return { drones, candidates };
}

/** Approved + pending_fix fixtures: latest DB version per id, then git files not in the DB. */
async function loadFixtures(): Promise<EvalFixture[]> {
  const rows = await db()`
    select distinct on (id) id, status, fixture from eval_corpus
    order by id, version desc`;
  const byId = new Map<string, EvalFixture>();
  for (const r of rows) {
    const status = r["status"] as string;
    if (status !== "approved" && status !== "pending_fix") continue;
    const fx = r["fixture"] as EvalFixture;
    byId.set(r["id"] as string, { ...fx, status });
  }
  for (const p of [
    "src/test/fixtures/eval-corpus.json",
    "src/test/fixtures/eval-mismatches.json",
  ]) {
    const full = path.resolve(process.cwd(), p);
    if (!fs.existsSync(full)) continue;
    for (const fx of JSON.parse(fs.readFileSync(full, "utf8")) as EvalFixture[])
      if (!byId.has(fx.id)) byId.set(fx.id, fx);
  }
  return [...byId.values()].filter((f) => typeof f.text === "string" && f.text.length > 0);
}

async function loadRule(id: string) {
  const [r] =
    await db()`select id, kind, language, payload, status from dynamic_rules where id = ${id}`;
  return r ? (r as unknown as DynamicRuleRow & { status: string }) : null;
}

async function activeRows(exceptId?: string) {
  const rows =
    await db()`select id, kind, language, payload from dynamic_rules where status = 'active'`;
  return (rows as unknown as DynamicRuleRow[]).filter((r) => r.id !== exceptId);
}

async function rulesVersion() {
  const [v] = await db()`select coalesce(max(version), 0)::int as v from dynamic_rules_version`;
  return Number(v?.["v"] ?? 0);
}

async function bumpRuleVersion(note: string) {
  await db()`insert into dynamic_rules_version (version, note)
    select coalesce(max(version), 0) + 1, ${note} from dynamic_rules_version`;
  await getOrRefreshRuleSnapshot({ force: true });
}

export async function proposeRule(
  input: ProposeInput,
): Promise<{ ok: boolean; id?: string; reason?: string }> {
  if (!dbConfigured()) return { ok: false, reason: "no database configured" };
  if (!KINDS.includes(input.kind)) return { ok: false, reason: `unknown kind ${input.kind}` };
  const language = input.language ?? "all";
  if (!RULE_LANGUAGES.includes(language))
    return { ok: false, reason: `unknown language ${language}` };
  const id = hypothesisId(input.kind, input.payload);
  const row = { id, kind: input.kind, language, payload: input.payload };
  const compiled = compileRuleSnapshot([row]);
  if (compiled.invalid.includes(id)) return { ok: false, reason: "payload does not compile" };
  const origin = input.origin ?? "analyst";
  // Re-proposing a rejected or quarantined pattern does not resurrect it; a human must.
  await db()`
    insert into dynamic_rules (id, kind, language, payload, status, origin, target_key, rationale, evidence, decided_by)
    values (${id}, ${input.kind}, ${language}, ${json(input.payload)}, 'candidate', ${origin},
      ${input.targetKey ?? null}, ${input.rationale ?? null}, ${json(input.evidence ?? null)}, ${origin})
    on conflict (id) do nothing`;
  return { ok: true, id };
}

/** Sandbox one rule against the active set. Records the verdict; never activates. */
export async function sandboxRule(
  id: string,
  mode: "fast" | "full" = "fast",
  world?: { drones: Drone[]; candidates: Candidate[]; fixtures: EvalFixture[] },
): Promise<{ ok: boolean; reason?: string; result?: SandboxResult }> {
  if (!dbConfigured()) return { ok: false, reason: "no database configured" };
  const rule = await loadRule(id);
  if (!rule) return { ok: false, reason: "rule not found" };
  const version = await rulesVersion();
  const active = await activeRows(id);
  const baselineRules = compileRuleSnapshot(active, version);
  const proposedRules = compileRuleSnapshot([...active, rule], version);
  if (proposedRules.invalid.includes(id)) return { ok: false, reason: "payload does not compile" };

  const { drones, candidates } = world ?? (await loadWorld());
  const fixtures = world?.fixtures ?? (await loadFixtures());
  const result = await runSandbox({
    fixtures,
    candidates,
    catalog: drones,
    baseline: new HeuristicExtractor(1, baselineRules),
    proposed: new HeuristicExtractor(1, proposedRules),
    terms: ruleTerms(rule),
    mode,
  });

  await db()`
    insert into rule_evaluations (rule_id, passed, corpus_size, regressions, broken_fixtures, f1_delta, mode, rules_version, report)
    values (${id}, ${result.passed}, ${result.corpusSize}, ${result.regressions.length},
      ${json(result.regressions.map((r) => r.id))}, ${result.f1Delta}, ${mode}, ${version}, ${json(result)})`;
  // Only a rule still awaiting a decision changes state; active rules keep theirs.
  await db()`
    update dynamic_rules set status = ${result.passed ? "candidate_passed" : "rejected"}
    where id = ${id} and status in ('candidate', 'evaluating', 'candidate_passed')`;
  return { ok: true, result };
}

/** Analyst activation: re-sandbox now, activate only on a pass, then hot-reload everywhere. */
export async function activateRule(id: string) {
  const res = await sandboxRule(id, "fast");
  if (!res.ok || !res.result) return { ok: false, reason: res.reason ?? "sandbox failed" };
  if (!res.result.passed)
    return { ok: false, reason: res.result.reasons.join("; "), result: res.result };
  await db()`
    update dynamic_rules set status = 'active', promoted_at = now(), decided_by = 'analyst',
      version = version + 1
    where id = ${id}`;
  await bumpRuleVersion(`activate ${id}`);
  return { ok: true, result: res.result };
}

/** Reject a candidate, or quarantine an active rule (which reloads the snapshot). */
export async function rejectRule(id: string) {
  if (!dbConfigured()) return { ok: false };
  const rows = await db()`
    update dynamic_rules
    set status = case when status = 'active' then 'quarantined' else 'rejected' end,
      decided_by = 'analyst'
    where id = ${id} returning status`;
  if (rows[0]?.["status"] === "quarantined") await bumpRuleVersion(`quarantine ${id}`);
  return { ok: rows.length > 0 };
}

export async function listRules(limit = 100): Promise<RuleView[]> {
  if (!dbConfigured()) return [];
  const rows = await db()`
    select r.*, e.report as eval_report, e.evaluated_at as eval_at, e.rules_version as eval_version
    from dynamic_rules r
    left join lateral (
      select report, evaluated_at, rules_version from rule_evaluations
      where rule_id = r.id order by evaluated_at desc limit 1
    ) e on true
    order by case r.status when 'candidate_passed' then 0 when 'active' then 1
      when 'candidate' then 2 else 3 end, r.created_at desc
    limit ${limit}`;
  return rows.map((r) => ({
    id: r["id"] as string,
    kind: r["kind"] as string,
    language: r["language"] as string,
    payload: (r["payload"] ?? {}) as { [k: string]: Json },
    status: r["status"] as string,
    origin: r["origin"] as string,
    targetKey: (r["target_key"] as string | null) ?? null,
    rationale: (r["rationale"] as string | null) ?? null,
    evidence: (r["evidence"] ?? null) as Json,
    createdAt: iso(r["created_at"])!,
    promotedAt: iso(r["promoted_at"]),
    lastEvaluation: r["eval_report"]
      ? {
          ...(r["eval_report"] as SandboxResult),
          evaluatedAt: iso(r["eval_at"])!,
          rulesVersion: (r["eval_version"] as number | null) ?? null,
        }
      : null,
  }));
}

export interface MineRunResult {
  ran: boolean;
  reason: string;
  mined: number;
  proposed: number;
  sandboxed: number;
  passed: number;
  parserDefects: number;
}

/**
 * Mine hypotheses from live candidates, propose them and sandbox the new ones. Never
 * activates: candidate_passed waits for an analyst (EVALUATION_FULL_AUTOMATION fas 2).
 */
export async function mineAndSandbox(): Promise<MineRunResult> {
  const none = { mined: 0, proposed: 0, sandboxed: 0, passed: 0, parserDefects: 0 };
  if (!dbConfigured()) return { ran: false, reason: "no database configured", ...none };
  try {
    const { drones, candidates } = await loadWorld();
    const fixtures = await loadFixtures();
    const heuristic = new HeuristicExtractor(1, await getOrRefreshRuleSnapshot({ force: true }));
    const mined = await mineHypotheses(candidates, drones, heuristic, { sampleSize: 400, seed: 1 });
    const known = new Set((await db()`select id from dynamic_rules`).map((r) => r["id"] as string));
    let proposed = 0;
    let sandboxed = 0;
    let passed = 0;
    for (const h of mined.hypotheses) {
      if (known.has(h.id)) continue;
      const p = await proposeRule({
        kind: h.kind,
        language: h.language,
        payload: h.payload,
        targetKey: h.targetKey,
        rationale: h.rationale,
        evidence: { support: h.support, basis: h.basis, samples: h.samples },
        origin: "autonomous_sandbox",
      });
      if (!p.ok || !p.id) continue;
      proposed++;
      if (sandboxed >= MAX_SANDBOX_PER_RUN) continue;
      const s = await sandboxRule(p.id, "fast", { drones, candidates, fixtures });
      sandboxed++;
      if (s.result?.passed) passed++;
    }
    return {
      ran: true,
      reason: "ok",
      mined: mined.hypotheses.length,
      proposed,
      sandboxed,
      passed,
      parserDefects: mined.parserDefects,
    };
  } catch (e) {
    return { ran: false, reason: e instanceof Error ? e.message : String(e), ...none };
  }
}
