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
import {
  breakerTrips,
  newShadowMetrics,
  promotionVerdict,
  ruleCategory,
  shadowStep,
  trustScores,
  PROMOTION_POLICY,
  type DecisionActor,
  type DecisionKind,
  type RuleDecision,
  type ShadowMetrics,
  type Trust,
} from "@/features/evaluation/autonomy";
import { hypothesisId, mineHypotheses } from "@/features/evaluation/hypotheses";
import type { EvalFixture } from "@/features/evaluation/evaluation";
import type { Candidate, Drone } from "@/entities/drone/types";
import type { JSONValue } from "postgres";
import fs from "node:fs";
import path from "node:path";

/**
 * Rule lifecycle on the server (EVALUATION_FULL_AUTOMATION §4):
 *
 *   candidate → sandbox → candidate_passed (analyst rule) | shadow (generated rule) | rejected
 *   shadow → active (analyst click, or auto-promotion once trust is earned) → quarantined
 *
 * Activation always re-runs the sandbox against the rules active at that moment, so a verdict
 * computed before another rule went live can never let a regression through. Every transition
 * is logged in rule_decisions, which is what trust is calibrated from.
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
  /** Shadow metrics plus what still blocks auto-promotion. */
  shadow: (ShadowMetrics & { blockers?: string[] }) | null;
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
    await db()`select id, kind, language, payload, status, origin from dynamic_rules where id = ${id}`;
  return r ? (r as unknown as DynamicRuleRow & { status: string; origin: string }) : null;
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

async function recordDecision(
  id: string,
  decision: DecisionKind,
  actor: DecisionActor,
  note: string | null = null,
) {
  await db()`
    insert into rule_decisions (rule_id, category, origin, decision, actor, note)
    select id, kind || ':' || coalesce(target_key, '*'), origin, ${decision}, ${actor}, ${note}
    from dynamic_rules where id = ${id}`;
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
  // Only a rule still awaiting a decision changes state; shadow and active rules keep theirs.
  // A generated rule that passes goes straight to shadow: it cannot affect production there,
  // and shadow is where it has to prove itself on reports it has never seen.
  const next = !result.passed
    ? "rejected"
    : rule.origin === "autonomous_sandbox"
      ? "shadow"
      : "candidate_passed";
  const [moved] = await db()`
    update dynamic_rules set status = ${next},
      shadow_metrics = ${next === "shadow" ? json(newShadowMetrics(new Date().toISOString())) : null}
    where id = ${id} and status in ('candidate', 'evaluating', 'candidate_passed')
    returning status`;
  if (moved && next === "rejected")
    await recordDecision(id, "rejected", "sandbox", result.reasons.join("; "));
  if (moved && next === "shadow") await recordDecision(id, "shadowed", "autonomous");
  return { ok: true, result };
}

/**
 * Activation by an analyst or by auto-promotion: re-sandbox now, activate only on a pass, then
 * hot-reload everywhere. A shadow rule that now breaks a fixture is rejected outright.
 */
export async function activateRule(id: string, actor: "analyst" | "autonomous" = "analyst") {
  const res = await sandboxRule(id, "fast");
  if (!res.ok || !res.result) return { ok: false, reason: res.reason ?? "sandbox failed" };
  if (!res.result.passed) {
    if (res.result.regressions.length) {
      const [r] = await db()`
        update dynamic_rules set status = 'rejected' where id = ${id} and status = 'shadow'
        returning id`;
      if (r) await recordDecision(id, "rejected", "sandbox", res.result.reasons.join("; "));
    }
    return { ok: false, reason: res.result.reasons.join("; "), result: res.result };
  }
  await db()`
    update dynamic_rules set status = 'active', promoted_at = now(),
      decided_by = ${actor === "analyst" ? "analyst" : "autonomous_sandbox"}, version = version + 1
    where id = ${id}`;
  await recordDecision(id, actor === "analyst" ? "activated" : "auto_activated", actor);
  await bumpRuleVersion(`${actor === "analyst" ? "activate" : "auto-activate"} ${id}`);
  return { ok: true, result: res.result };
}

/** Analyst: send a passed rule to shadow so it earns metrics before going live. */
export async function shadowRule(id: string) {
  if (!dbConfigured()) return { ok: false };
  const rows = await db()`
    update dynamic_rules set status = 'shadow',
      shadow_metrics = ${json(newShadowMetrics(new Date().toISOString()))}
    where id = ${id} and status = 'candidate_passed' returning id`;
  if (rows.length) await recordDecision(id, "shadowed", "analyst");
  return { ok: rows.length > 0 };
}

/** Reject a candidate, or quarantine an active rule (which reloads the snapshot). */
export async function rejectRule(id: string) {
  if (!dbConfigured()) return { ok: false };
  const rows = await db()`
    update dynamic_rules
    set status = case when status = 'active' then 'quarantined' else 'rejected' end,
      decided_by = 'analyst'
    where id = ${id} and status not in ('rejected', 'quarantined', 'superseded')
    returning status`;
  const status = rows[0]?.["status"] as "rejected" | "quarantined" | undefined;
  if (status) await recordDecision(id, status, "analyst");
  if (status === "quarantined") await bumpRuleVersion(`quarantine ${id}`);
  return { ok: rows.length > 0 };
}

async function quarantine(ids: string[], note: string) {
  for (const id of ids) {
    const [r] = await db()`
      update dynamic_rules set status = 'quarantined', decided_by = 'circuit_breaker'
      where id = ${id} and status = 'active' returning id`;
    if (r) await recordDecision(id, "quarantined", "circuit_breaker", note);
  }
  if (ids.length) await bumpRuleVersion(`circuit breaker: ${ids.join(", ")}`);
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
    order by case r.status when 'candidate_passed' then 0 when 'shadow' then 1
      when 'active' then 2 when 'candidate' then 3 else 4 end, r.created_at desc
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
    shadow: (r["shadow_metrics"] as RuleView["shadow"]) ?? null,
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
 * activates: the ones that pass go to shadow and must earn promotion there.
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

const autopromoteEnabled = () => process.env["RULES_AUTOPROMOTE"]?.toLowerCase() !== "off";

async function decisionsAndTrust() {
  const rows = await db()`select category, origin, decision, actor from rule_decisions`;
  const trust = trustScores(rows as unknown as RuleDecision[]);
  const [c] = await db()`
    select count(*)::int as n from rule_decisions
    where decision = 'auto_activated' and decided_at > now() - interval '24 hours'`;
  return { trust, autoLast24h: Number(c?.["n"] ?? 0) };
}

export interface ShadowRunResult {
  ran: boolean;
  reason: string;
  rules: number;
  evaluated: number;
  promoted: string[];
}

/**
 * Score every shadow rule on reports that arrived since it entered shadow, then auto-promote
 * the ones that meet PROMOTION_POLICY. Runs hourly; ingestion itself never waits for shadows.
 */
export async function runShadow(): Promise<ShadowRunResult> {
  const none = { rules: 0, evaluated: 0, promoted: [] as string[] };
  if (!dbConfigured()) return { ran: false, reason: "no database configured", ...none };
  try {
    const rows = await db()`
      select id, kind, language, payload, origin, target_key, shadow_metrics
      from dynamic_rules where status = 'shadow' order by created_at`;
    if (!rows.length) return { ran: true, reason: "no shadow rules", ...none };
    const { drones, candidates } = await loadWorld();
    let { trust, autoLast24h } = await decisionsAndTrust();
    let active = await activeRows();
    const promoted: string[] = [];
    let evaluated = 0;
    for (const r of rows) {
      const rule = r as unknown as DynamicRuleRow;
      const before =
        (r["shadow_metrics"] as ShadowMetrics | null) ?? newShadowMetrics(new Date().toISOString());
      const metrics = await shadowStep(
        before,
        candidates,
        drones,
        new HeuristicExtractor(1, compileRuleSnapshot(active)),
        new HeuristicExtractor(1, compileRuleSnapshot([...active, rule])),
      );
      evaluated += metrics.evaluated - before.evaluated;
      const category = ruleCategory(r["kind"] as string, r["target_key"] as string | null);
      const verdict = promotionVerdict({
        origin: r["origin"] as string,
        metrics,
        trust: trust[category],
        autoActivatedLast24h: autoLast24h,
        now: new Date(),
      });
      const blockers = autopromoteEnabled()
        ? verdict.reasons
        : [...verdict.reasons, "auto-promotion disabled (RULES_AUTOPROMOTE=off)"];
      await db()`update dynamic_rules set shadow_metrics = ${json({ ...metrics, blockers })}
        where id = ${rule.id}`;
      if (!verdict.promote || !autopromoteEnabled()) continue;
      const res = await activateRule(rule.id, "autonomous");
      if (!res.ok) continue;
      promoted.push(rule.id);
      // Later shadows compare against the rule set that is now live, and count the cap anew.
      active = await activeRows();
      ({ trust, autoLast24h } = await decisionsAndTrust());
    }
    return { ran: true, reason: "ok", rules: rows.length, evaluated, promoted };
  } catch (e) {
    return { ran: false, reason: e instanceof Error ? e.message : String(e), ...none };
  }
}

export interface SuperviseResult {
  ran: boolean;
  reason: string;
  breaker: { checked: number; tripped: boolean; reasons: string[] };
  audited: number;
  quarantined: string[];
}

/** Active rules audited per night by leave-one-out full sandbox (budget). */
const MAX_AUDIT_PER_RUN = 10;

/**
 * Nightly supervision of live rules. 1) Circuit breaker: the full corpus and a fresh sample with
 * all active rules vs without those activated in the last 24 h - a drop beyond BREAKER_F1_DROP
 * or any broken fixture quarantines all of them. 2) Audit: each older rule is re-checked against
 * the full corpus without it; one that now breaks a fixture (the corpus grew) is quarantined.
 */
export async function superviseActiveRules(): Promise<SuperviseResult> {
  const empty = {
    breaker: { checked: 0, tripped: false, reasons: [] as string[] },
    audited: 0,
    quarantined: [] as string[],
  };
  if (!dbConfigured()) return { ran: false, reason: "no database configured", ...empty };
  try {
    const rows = await db()`
      select id, kind, language, payload,
        coalesce(promoted_at > now() - interval '24 hours', false) as recent
      from dynamic_rules where status = 'active' order by promoted_at desc nulls last`;
    const all = rows as unknown as (DynamicRuleRow & { recent: boolean })[];
    if (!all.length) return { ran: true, reason: "no active rules", ...empty };
    const { drones, candidates } = await loadWorld();
    const fixtures = await loadFixtures();
    const version = await rulesVersion();
    // "proposed" = everything live now; "baseline" = live minus the rules under suspicion.
    const run = async (suspects: DynamicRuleRow[], mode: "breaker" | "audit") => {
      const result = await runSandbox({
        fixtures,
        candidates,
        catalog: drones,
        baseline: new HeuristicExtractor(
          1,
          compileRuleSnapshot(all.filter((r) => !suspects.includes(r))),
        ),
        proposed: new HeuristicExtractor(1, compileRuleSnapshot(all)),
        terms: [...new Set(suspects.flatMap(ruleTerms))],
        mode: "full",
      });
      for (const r of suspects)
        await db()`
          insert into rule_evaluations (rule_id, passed, corpus_size, regressions, broken_fixtures, f1_delta, mode, rules_version, report)
          values (${r.id}, ${result.regressions.length === 0}, ${result.corpusSize}, ${result.regressions.length},
            ${json(result.regressions.map((x) => x.id))}, ${result.f1Delta}, ${mode}, ${version}, ${json(result)})`;
      return result;
    };

    const quarantined: string[] = [];
    const recent = all.filter((r) => r.recent);
    const breaker = { checked: recent.length, tripped: false, reasons: [] as string[] };
    if (recent.length) {
      const verdict = breakerTrips(await run(recent, "breaker"));
      breaker.tripped = verdict.trips;
      breaker.reasons = verdict.reasons;
      if (verdict.trips) {
        await quarantine(
          recent.map((r) => r.id),
          verdict.reasons.join("; "),
        );
        quarantined.push(...recent.map((r) => r.id));
        console.warn("[evaluation:rules] circuit breaker tripped:", verdict.reasons.join("; "));
      }
    }
    let audited = 0;
    for (const r of all) {
      if (r.recent || quarantined.includes(r.id) || audited >= MAX_AUDIT_PER_RUN) continue;
      audited++;
      const result = await run([r], "audit");
      if (result.regressions.length) {
        await quarantine([r.id], `audit: ${result.regressions.length} fixture(s) regress`);
        quarantined.push(r.id);
      }
    }
    return { ran: true, reason: "ok", breaker, audited, quarantined };
  } catch (e) {
    return { ran: false, reason: e instanceof Error ? e.message : String(e), ...empty };
  }
}

export interface AutonomyStatus {
  autopromote: boolean;
  policy: typeof PROMOTION_POLICY;
  trust: Record<string, Trust>;
  autoActivatedLast24h: number;
  recent: { ruleId: string; decision: string; actor: string; note: string | null; at: string }[];
}

export async function getAutonomyStatus(): Promise<AutonomyStatus | null> {
  if (!dbConfigured()) return null;
  const { trust, autoLast24h } = await decisionsAndTrust();
  const rows = await db()`
    select rule_id, decision, actor, note, decided_at from rule_decisions
    order by decided_at desc limit 20`;
  return {
    autopromote: autopromoteEnabled(),
    policy: PROMOTION_POLICY,
    trust,
    autoActivatedLast24h: autoLast24h,
    recent: rows.map((r) => ({
      ruleId: r["rule_id"] as string,
      decision: r["decision"] as string,
      actor: r["actor"] as string,
      note: (r["note"] as string | null) ?? null,
      at: iso(r["decided_at"])!,
    })),
  };
}
