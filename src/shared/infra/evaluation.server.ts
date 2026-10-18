import { db, dbConfigured } from "@/shared/infra/postgres/db.server";
import { PostgresStore } from "@/shared/infra/postgres/postgres-store.server";
import { HeuristicExtractor } from "@/shared/infra/heuristic-ai";
import { getOrRefreshRuleSnapshot } from "@/shared/infra/heuristics/rule-registry.server";
import { evaluateHeuristic, compareSpecs, comparableSpecs } from "@/features/evaluation/evaluation";
import { normalizeExtraction } from "@/entities/normalization/apply";
import { semanticKeyFor } from "@/entities/normalization/semantic";
import { sanitizeJson } from "@/shared/infra/json-sanitize";
import type { JSONValue } from "postgres";
import type { Candidate, Drone } from "@/entities/drone/types";
import type { EvalFixture } from "@/features/evaluation/evaluation";
import { readProviderEnvConfig } from "@/shared/infra/provider-env.server";
import { chatCompletionOnce } from "@/shared/infra/ai-proxy.server";
import fs from "node:fs";
import path from "node:path";

const LOCK_NAME = "evaluation";
const LOCK_MS = 10 * 60 * 1000;

export interface EvaluationRunResult {
  ran: boolean;
  reason: string;
  reportId?: string;
  totalItems?: number;
}

export interface EvaluationHealthResult {
  ran: boolean;
  reason: string;
  regression: boolean;
  details: string[];
  reportId?: string;
}

export interface HarvestResult {
  ran: boolean;
  reason: string;
  inserted: number;
  skipped: number;
  corpusVersion?: number;
}

export interface AdjudicationResult {
  ran: boolean;
  reason: string;
  adjudicated: number;
  inserted: number;
}

/** Try to acquire the evaluation lock; returns true if acquired. */
async function claimLock(): Promise<boolean> {
  const conn = db();
  const rows = await conn`
    insert into eval_lock (name, held_until)
    values (${LOCK_NAME}, now() + (${LOCK_MS}::int * interval '1 millisecond'))
    on conflict (name) do update
      set held_until = excluded.held_until
      where eval_lock.held_until < now()
    returning name`;
  return rows.length > 0;
}

async function releaseLock() {
  await db()`update eval_lock set held_until = now() where name = ${LOCK_NAME}`;
}

export async function runEvaluation(): Promise<EvaluationRunResult> {
  if (!dbConfigured()) return { ran: false, reason: "no database configured" };
  const claimed = await claimLock();
  if (!claimed) return { ran: false, reason: "lock held" };

  try {
    const store = new PostgresStore();
    const drones = ((await store.load("drones")) ?? []) as unknown as Drone[];
    const candidates = ((await store.load("candidates")) ?? []) as unknown as Candidate[];
    const heuristic = new HeuristicExtractor(1, await getOrRefreshRuleSnapshot());
    const report = await evaluateHeuristic(candidates, drones, heuristic, {
      sampleSize: 200,
      seed: 1,
      includeDiscarded: false,
    });

    const id = crypto.randomUUID();
    await db()`
      insert into eval_reports (id, generated_at, seed, sample_size, corpus_version, report)
      values (${id}, ${report.generatedAt}, ${1}, ${report.totalItems}, ${1}, ${db().json(sanitizeJson(report as unknown as JSONValue))})`;
    return { ran: true, reason: "ok", reportId: id, totalItems: report.totalItems };
  } catch (e) {
    return { ran: false, reason: e instanceof Error ? e.message : String(e) };
  } finally {
    await releaseLock().catch(() => {});
  }
}

export async function runEvaluationHealth(): Promise<EvaluationHealthResult> {
  if (!dbConfigured())
    return { ran: false, reason: "no database configured", regression: false, details: [] };
  const claimed = await claimLock();
  if (!claimed) return { ran: false, reason: "lock held", regression: false, details: [] };

  try {
    const store = new PostgresStore();
    const drones = ((await store.load("drones")) ?? []) as unknown as Drone[];
    const candidates = ((await store.load("candidates")) ?? []) as unknown as Candidate[];
    const heuristic = new HeuristicExtractor(1, await getOrRefreshRuleSnapshot());
    const report = await evaluateHeuristic(candidates, drones, heuristic, {
      sampleSize: 200,
      seed: 1,
      includeDiscarded: false,
    });

    const rows = await db()`select report from eval_reports order by generated_at desc limit 1`;
    const prev = rows.length && rows[0] ? (rows[0]["report"] as Record<string, unknown>) : null;

    const details: string[] = [];
    let regression = false;

    const id = crypto.randomUUID();
    await db()`
      insert into eval_reports (id, generated_at, seed, sample_size, corpus_version, report)
      values (${id}, ${report.generatedAt}, ${1}, ${report.totalItems}, ${1}, ${db().json(sanitizeJson(report as unknown as JSONValue))})`;

    if (prev) {
      const prevSummary = (prev["summary"] ?? {}) as Record<string, unknown>;
      const prevF1 = typeof prevSummary["f1"] === "number" ? (prevSummary["f1"] as number) : 0;
      if (report.summary.f1 < prevF1 - 0.02) {
        regression = true;
        details.push(`Total F1 dropped: ${prevF1.toFixed(3)} -> ${report.summary.f1.toFixed(3)}`);
      }
      const prevPerKey = (prev["perKey"] ?? {}) as Record<
        string,
        { tp: number; fp: number; fn: number; f1: number }
      >;
      for (const [k, v] of Object.entries(report.perKey ?? {})) {
        const pv = prevPerKey[k];
        if (pv && pv.tp + pv.fp + pv.fn >= 10 && v.f1 < pv.f1 - 0.05) {
          regression = true;
          details.push(`${k}: F1 dropped ${pv.f1.toFixed(3)} -> ${v.f1.toFixed(3)}`);
        }
      }
      const prevMismatches = (prev["mismatches"] ?? []) as Array<{
        candidateId: string;
        specKey: string;
      }>;
      const prevMismatchKeys = new Set(prevMismatches.map((m) => `${m.candidateId}|${m.specKey}`));
      const newMismatches = (report.mismatches ?? []).filter(
        (m) => !prevMismatchKeys.has(`${m.candidateId}|${m.specKey}`),
      );
      if (newMismatches.length > 0) {
        details.push(`${newMismatches.length} new mismatch patterns detected`);
      }
    } else {
      details.push("No previous report for comparison (first run)");
    }

    if (regression) {
      console.warn("[evaluation:health] REGRESSION DETECTED:", details.join("; "));
    } else {
      console.log("[evaluation:health] OK:", details.join("; ") || "no changes");
    }

    return { ran: true, reason: "ok", regression, details, reportId: id };
  } catch (e) {
    return {
      ran: false,
      reason: e instanceof Error ? e.message : String(e),
      regression: false,
      details: [],
    };
  } finally {
    await releaseLock().catch(() => {});
  }
}

/** Import git corpus files into eval_corpus (origin=git_import, status=approved). */
export async function importGitCorpus(): Promise<{ imported: number; skipped: number }> {
  if (!dbConfigured()) return { imported: 0, skipped: 0 };
  const files = [
    { path: "src/test/fixtures/eval-corpus.json", kind: "positive" },
    { path: "src/test/fixtures/eval-mismatches.json", kind: "negative" },
  ];
  let imported = 0;
  let skipped = 0;
  for (const { path: p, kind } of files) {
    const full = path.resolve(process.cwd(), p);
    if (!fs.existsSync(full)) continue;
    const arr = JSON.parse(fs.readFileSync(full, "utf8")) as EvalFixture[];
    for (const fx of arr) {
      const existing =
        await db()`select 1 from eval_corpus where id = ${fx.id} and origin = 'git_import'`;
      if (existing.length) {
        skipped++;
        continue;
      }
      await db()`
        insert into eval_corpus (id, version, kind, fixture, status, origin, observed_at)
        values (${fx.id}, 1, ${kind}, ${db().json(sanitizeJson(fx as unknown as JSONValue))}, 'approved', 'git_import', now())`;
      imported++;
    }
  }
  return { imported, skipped };
}

/** Harvest trusted positive fixtures from a fresh evaluation run. */
export async function harvestCorpus(): Promise<{
  ran: boolean;
  reason: string;
  inserted: number;
  skipped: number;
  corpusVersion?: number;
}> {
  if (!dbConfigured())
    return { ran: false, reason: "no database configured", inserted: 0, skipped: 0 };
  const claimed = await claimLock();
  if (!claimed) return { ran: false, reason: "lock held", inserted: 0, skipped: 0 };

  try {
    const store = new PostgresStore();
    const drones = ((await store.load("drones")) ?? []) as unknown as Drone[];
    const candidates = ((await store.load("candidates")) ?? []) as unknown as Candidate[];
    const heuristic = new HeuristicExtractor(1, await getOrRefreshRuleSnapshot());
    const report = await evaluateHeuristic(candidates, drones, heuristic, {
      sampleSize: 200,
      seed: 1,
      includeDiscarded: false,
    });

    const vRows = await db()`select coalesce(max(version), 0) as v from eval_corpus_version`;
    const currentVersion = (vRows[0]?.["v"] as number) ?? 0;
    const nextVersion = currentVersion + 1;

    let inserted = 0;
    let skipped = 0;
    const perKeyCount = new Map<string, number>();
    const MAX_PER_KEY = 5;
    const MAX_TOTAL = 25;

    const refCounts = new Map<string, number>();
    for (const c of candidates) {
      for (const spec of c.extraction?.specs ?? []) {
        const key = `${spec.semantic ?? spec.key}|${spec.value}|${spec.unit ?? ""}`;
        refCounts.set(key, (refCounts.get(key) ?? 0) + 1);
      }
    }

    for (const fx of report.fixtures) {
      if (inserted >= MAX_TOTAL) break;
      const key = fx.expect.map((e) => e.semantic).join(",");
      if ((perKeyCount.get(key) ?? 0) >= MAX_PER_KEY) {
        skipped++;
        continue;
      }
      const corroborated = fx.expect.some(
        (e) => (refCounts.get(`${e.semantic}|${e.value}|${e.unit ?? ""}`) ?? 0) >= 2,
      );
      if (!corroborated) {
        skipped++;
        continue;
      }

      const exists = await db()`select 1 from eval_corpus where id = ${fx.id}`;
      if (exists.length) {
        skipped++;
        continue;
      }

      await db()`
        insert into eval_corpus (id, version, kind, fixture, status, origin, source_report, observed_at)
        values (${fx.id}, ${nextVersion}, 'positive', ${db().json(sanitizeJson(fx as unknown as JSONValue))}, 'approved', 'agreement', null, now())`;
      perKeyCount.set(key, (perKeyCount.get(key) ?? 0) + 1);
      inserted++;
    }

    if (inserted > 0) {
      await db()`insert into eval_corpus_version (version, created_at, note) values (${nextVersion}, now(), 'harvest')`;
    }

    return {
      ran: true,
      reason: "ok",
      inserted,
      skipped,
      corpusVersion: inserted > 0 ? nextVersion : currentVersion,
    };
  } catch (e) {
    return {
      ran: false,
      reason: e instanceof Error ? e.message : String(e),
      inserted: 0,
      skipped: 0,
    };
  } finally {
    await releaseLock().catch(() => {});
  }
}

/** Step 2: adjudicate mismatches via AI (max 10 per run). */
export interface PatternSuggestion {
  id: string;
  kind: "cue" | "notAfter" | "magnitude" | "alias" | "stop";
  specKey: string;
  description: string;
  count: number;
  sample: string[];
}

export async function minePatterns(): Promise<PatternSuggestion[]> {
  if (!dbConfigured()) return [];
  const rows = await db()`select report from eval_reports order by generated_at desc limit 1`;
  if (!rows.length) return [];
  const report = rows[0] ? (rows[0]["report"] as Record<string, unknown>) : null;
  if (!report) return [];
  const mismatches = (report["mismatches"] ?? []) as Array<{
    specKey: string;
    matchType: string;
    evidence: string;
  }>;
  const byKey = new Map<string, { count: number; samples: string[] }>();
  for (const m of mismatches) {
    const e = byKey.get(m.specKey) ?? { count: 0, samples: [] };
    e.count++;
    if (e.samples.length < 3 && m.evidence) e.samples.push(m.evidence);
    byKey.set(m.specKey, e);
  }
  const out: PatternSuggestion[] = [];
  for (const [key, v] of byKey) {
    if (v.count < 3) continue;
    out.push({
      id: `pat-${key}`,
      kind: "cue",
      specKey: key,
      description: `${key}: ${v.count} mismatches — review cue words / notAfter envelope`,
      count: v.count,
      sample: v.samples,
    });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, 20);
}

const RULE_KIND: Record<PatternSuggestion["kind"], string> = {
  cue: "add_cue",
  notAfter: "context_filter",
  magnitude: "add_unit_scale",
  alias: "add_alias",
  stop: "add_stopword",
};

/** Bump the rule version so every process reloads its snapshot within one TTL. */
async function bumpRuleVersion(note: string) {
  await db()`insert into dynamic_rules_version (version, note)
    select coalesce(max(version), 0) + 1, ${note} from dynamic_rules_version`;
  await getOrRefreshRuleSnapshot({ force: true });
}

export async function approveOverride(suggestion: PatternSuggestion): Promise<{ ok: boolean }> {
  if (!dbConfigured()) return { ok: false };
  await db()`
    insert into dynamic_rules (id, kind, payload, status, origin, target_key, rationale, decided_by, promoted_at)
    values (${suggestion.id}, ${RULE_KIND[suggestion.kind]}, ${db().json(sanitizeJson(suggestion as unknown as JSONValue))},
      'active', 'analyst', ${suggestion.specKey}, ${suggestion.description}, 'analyst', now())
    on conflict (id) do update set status = 'active', version = dynamic_rules.version + 1,
      payload = excluded.payload, promoted_at = now(), decided_by = 'analyst'`;
  await bumpRuleVersion(`approve ${suggestion.id}`);
  return { ok: true };
}

export async function rejectOverride(id: string): Promise<{ ok: boolean }> {
  if (!dbConfigured()) return { ok: false };
  await db()`
    insert into dynamic_rules (id, kind, payload, status, origin, decided_by)
    values (${id}, 'add_cue', ${db().json(sanitizeJson({ id } as unknown as JSONValue))}, 'rejected', 'analyst', 'analyst')
    on conflict (id) do update set status = 'rejected', decided_by = 'analyst'`;
  await bumpRuleVersion(`reject ${id}`);
  return { ok: true };
}

export async function runAdjudication(): Promise<{
  ran: boolean;
  reason: string;
  adjudicated: number;
  inserted: number;
}> {
  if (!dbConfigured())
    return { ran: false, reason: "no database configured", adjudicated: 0, inserted: 0 };
  const env = await (await import("@/shared/infra/provider-env.server")).readProviderEnvConfig();
  if (!env.hasKey) return { ran: false, reason: "no AI provider key", adjudicated: 0, inserted: 0 };

  const claimed = await claimLock();
  if (!claimed) return { ran: false, reason: "lock held", adjudicated: 0, inserted: 0 };

  try {
    const store = new PostgresStore();
    const drones = ((await store.load("drones")) ?? []) as unknown as Drone[];
    const candidates = ((await store.load("candidates")) ?? []) as unknown as Candidate[];
    const heuristic = new HeuristicExtractor(1, await getOrRefreshRuleSnapshot());
    const { chatCompletionOnce } = await import("@/shared/infra/ai-proxy.server");

    let adjudicated = 0;
    let inserted = 0;
    const MAX = 10;

    for (const c of candidates) {
      if (adjudicated >= MAX) break;
      if (!c.raw || c.raw.trim().length < 50) continue;
      const heur = normalizeExtraction(await heuristic.extract(c.raw, drones)).extraction;
      const cmp = compareSpecs(comparableSpecs(heur), comparableSpecs(c.extraction));
      const conflicts = [...cmp.wrongKeys, ...cmp.falsePositives.map((h) => ({ h, r: null }))];
      if (conflicts.length === 0) continue;

      for (const conf of conflicts) {
        if (adjudicated >= MAX) break;
        const h = conf.h;
        const r = conf.r;
        const prompt = `You are an OSINT adjudicator. A heuristic extractor and an AI extractor disagree on a spec.\n\nRaw text:\n${c.raw.slice(0, 1500)}\n\nHeuristic says: ${h.semantic} = ${h.value} ${h.unit ?? ""}\nAI says: ${r ? `${r.semantic} = ${r.value} ${r.unit ?? ""}` : "(no value)"}\n\nWhich is better supported by the text? Answer only one of: heuristic, ai, neither.`;
        const res = await chatCompletionOnce({
          model: env.tier2Model ?? "gpt-4o",
          json: false,
          system:
            "You are a precise OSINT adjudicator. Answer only one word: heuristic, ai, or neither.",
          prompt,
          tier: "tier2",
        });
        if (!res.ok) continue;
        const answer = res.content.trim().toLowerCase();
        adjudicated++;

        if (answer === "heuristic") {
          const fx: EvalFixture = {
            id: `adj-${c.id}-${h.semantic}`,
            source: c.source,
            text: c.raw,
            expect: [
              {
                semantic: h.semantic,
                value: h.canonical ?? h.value,
                ...(h.canonicalUnit ? { unit: h.canonicalUnit } : {}),
              },
            ],
            status: "pending",
          };
          await db()`insert into eval_corpus (id, version, kind, fixture, status, origin, observed_at)
            values (${fx.id}, 1, 'positive', ${db().json(sanitizeJson(fx as unknown as JSONValue))}, 'pending', 'adjudication', now())
            on conflict (id, version) do nothing`;
          inserted++;
        } else if (answer === "ai" && r) {
          const fx: EvalFixture = {
            id: `adj-${c.id}-${r.semantic}`,
            source: c.source,
            text: c.raw,
            expect: [
              {
                semantic: r.semantic,
                value: r.canonical ?? r.value,
                ...(r.canonicalUnit ? { unit: r.canonicalUnit } : {}),
              },
            ],
            status: "pending",
          };
          await db()`insert into eval_corpus (id, version, kind, fixture, status, origin, observed_at)
            values (${fx.id}, 1, 'positive', ${db().json(sanitizeJson(fx as unknown as JSONValue))}, 'pending', 'adjudication', now())
            on conflict (id, version) do nothing`;
          inserted++;
          // negative against heuristic's value
          const neg: EvalFixture = {
            id: `adj-neg-${c.id}-${h.semantic}`,
            source: c.source,
            text: c.raw,
            expect: [],
            forbid: [
              {
                semantic: h.semantic,
                value: h.canonical ?? h.value,
                ...(h.canonicalUnit ? { unit: h.canonicalUnit } : {}),
              },
            ],
            status: "pending_fix",
            // origin stored in DB column, not fixture
          };
          await db()`insert into eval_corpus (id, version, kind, fixture, status, origin, observed_at)
            values (${neg.id}, 1, 'negative', ${db().json(sanitizeJson(neg as unknown as JSONValue))}, 'pending_fix', 'adjudication', now())
            on conflict (id, version) do nothing`;
        }
      }
    }

    return { ran: true, reason: "ok", adjudicated, inserted };
  } catch (e) {
    return {
      ran: false,
      reason: e instanceof Error ? e.message : String(e),
      adjudicated: 0,
      inserted: 0,
    };
  } finally {
    await releaseLock().catch(() => {});
  }
}
export interface EvalReportRow {
  id: string;
  generatedAt: string;
  totalItems: number;
  f1: number;
  precision: number;
  recall: number;
}

export interface EvalKeyTrend {
  key: string;
  values: number[];
  dates: string[];
}

export async function getEvalKeyTrends(limit = 20): Promise<EvalKeyTrend[]> {
  if (!dbConfigured()) return [];
  const rows =
    await db()`select generated_at, report from eval_reports order by generated_at asc limit ${limit}`;
  const byKey = new Map<string, { values: number[]; dates: string[] }>();
  for (const r of rows) {
    const rep = r["report"] as Record<string, unknown>;
    const perKey = (rep["perKey"] ?? {}) as Record<string, { f1: number }>;
    const date = (r["generated_at"] as Date).toISOString();
    for (const [k, v] of Object.entries(perKey)) {
      const e = byKey.get(k) ?? { values: [], dates: [] };
      e.values.push(typeof v.f1 === "number" ? v.f1 : 0);
      e.dates.push(date);
      byKey.set(k, e);
    }
  }
  return [...byKey.entries()]
    .map(([key, v]) => ({ key, values: v.values, dates: v.dates }))
    .sort((a, b) => b.values.length - a.values.length)
    .slice(0, 12);
}

export async function getEvalReports(limit = 20): Promise<EvalReportRow[]> {
  if (!dbConfigured()) return [];
  const rows =
    await db()`select id, generated_at, report from eval_reports order by generated_at desc limit ${limit}`;
  return rows.map((r) => {
    const rep = r["report"] as Record<string, unknown>;
    const summary = (rep["summary"] ?? {}) as Record<string, unknown>;
    return {
      id: r["id"] as string,
      generatedAt: (r["generated_at"] as Date).toISOString(),
      totalItems: (rep["totalItems"] as number) ?? 0,
      f1: typeof summary["f1"] === "number" ? (summary["f1"] as number) : 0,
      precision: typeof summary["precision"] === "number" ? (summary["precision"] as number) : 0,
      recall: typeof summary["recall"] === "number" ? (summary["recall"] as number) : 0,
    };
  });
}

export async function recordAnalystFixture(candidate: Candidate): Promise<{ ok: boolean }> {
  if (!dbConfigured()) return { ok: false };
  const fx = {
    id: "analyst-" + candidate.id,
    source: candidate.source,
    text: candidate.raw,
    expect: (candidate.extraction?.specs ?? []).map((s) => ({
      semantic: semanticKeyFor(s.key, s.label),
      value: s.value,
      ...(s.unit ? { unit: s.unit } : {}),
    })),
    status: "approved",
  };
  await db()`
    insert into eval_corpus (id, version, kind, fixture, status, origin, observed_at)
    values (${fx.id}, 1, 'positive', ${db().json(sanitizeJson(fx as unknown as JSONValue))}, 'approved', 'analyst', now())
    on conflict (id, version) do nothing`;
  return { ok: true };
}
