import { db, dbConfigured } from "@/shared/infra/postgres/db.server";
import { PostgresStore } from "@/shared/infra/postgres/postgres-store.server";
import { HeuristicExtractor } from "@/shared/infra/heuristic-ai";
import { getOrRefreshRuleSnapshot } from "@/shared/infra/heuristics/rule-registry.server";
import { evaluateHeuristic } from "@/shared/infra/evaluation/evaluation";
import { sanitizeJson } from "@/shared/infra/json-sanitize";
import { documentsOf } from "@/shared/contracts/store";
import type { JSONValue } from "postgres";
import type { Candidate, Drone } from "@/entities/drone/types";
import { claimLock, releaseLock } from "@/shared/infra/evaluation/evaluation-lock.server";
import { EVAL_SEED, pinnedCorpusVersion } from "@/shared/infra/evaluation/evaluation-corpus.server";

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

export async function runEvaluation(): Promise<EvaluationRunResult> {
  if (!dbConfigured()) return { ran: false, reason: "no database configured" };
  const lock = await claimLock();
  if (!lock.ok) return { ran: false, reason: lock.reason };

  try {
    const corpusVersion = await pinnedCorpusVersion();
    const store = new PostgresStore();
    const drones = (documentsOf(await store.load("drones")) ?? []) as unknown as Drone[];
    const candidates = (documentsOf(await store.load("candidates")) ??
      []) as unknown as Candidate[];
    const heuristic = new HeuristicExtractor(1, await getOrRefreshRuleSnapshot());
    const report = await evaluateHeuristic(candidates, drones, heuristic, {
      sampleSize: 200,
      seed: EVAL_SEED,
      includeDiscarded: false,
    });

    const id = crypto.randomUUID();
    await db()`
      insert into eval_reports (id, generated_at, seed, sample_size, corpus_version, report)
      values (${id}, ${report.generatedAt}, ${EVAL_SEED}, ${report.totalItems}, ${corpusVersion}, ${db().json(sanitizeJson(report as unknown as JSONValue))})`;
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
  const lock = await claimLock();
  if (!lock.ok) return { ran: false, reason: lock.reason, regression: false, details: [] };

  try {
    const corpusVersion = await pinnedCorpusVersion();
    const store = new PostgresStore();
    const drones = (documentsOf(await store.load("drones")) ?? []) as unknown as Drone[];
    const candidates = (documentsOf(await store.load("candidates")) ??
      []) as unknown as Candidate[];
    const heuristic = new HeuristicExtractor(1, await getOrRefreshRuleSnapshot());
    const report = await evaluateHeuristic(candidates, drones, heuristic, {
      sampleSize: 200,
      seed: EVAL_SEED,
      includeDiscarded: false,
    });

    const rows = await db()`select report from eval_reports order by generated_at desc limit 1`;
    const prev = rows.length && rows[0] ? (rows[0]["report"] as Record<string, unknown>) : null;

    const details: string[] = [];
    let regression = false;

    const id = crypto.randomUUID();
    await db()`
      insert into eval_reports (id, generated_at, seed, sample_size, corpus_version, report)
      values (${id}, ${report.generatedAt}, ${EVAL_SEED}, ${report.totalItems}, ${corpusVersion}, ${db().json(sanitizeJson(report as unknown as JSONValue))})`;

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
