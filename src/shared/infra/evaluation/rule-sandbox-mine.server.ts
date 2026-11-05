import { db, dbConfigured } from "@/shared/infra/postgres/db.server";
import { HeuristicExtractor } from "@/shared/infra/heuristic-ai";
import { getOrRefreshRuleSnapshot } from "@/shared/infra/heuristics/rule-registry.server";
import { mineHypotheses } from "@/shared/infra/evaluation/hypotheses";
import {
  candidateSample,
  CONTROL_POOL,
  mergeById,
  reviewedCandidates,
} from "@/shared/infra/evaluation/rule-sandbox-candidates.server";
import { loadFixtures } from "@/shared/infra/evaluation/rule-sandbox-fixtures.server";
import { loadCatalog } from "@/shared/infra/evaluation/rule-sandbox-store.server";
import { proposeRule } from "@/shared/infra/evaluation/rule-sandbox-propose.server";
import { sandboxRule } from "@/shared/infra/evaluation/rule-sandbox-sandbox.server";

/** Mined hypotheses sandboxed per run (budget, EVALUATION_AUTOMATION §3 princip 4). */
export const MAX_SANDBOX_PER_RUN = 3;

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
    const drones = await loadCatalog();
    const fixtures = await loadFixtures(drones);
    // The miner stratifies 400 out of this pool; the pool doubles as the sandbox control set.
    const control = await candidateSample(2 * CONTROL_POOL);
    const heuristic = new HeuristicExtractor(1, await getOrRefreshRuleSnapshot({ force: true }));
    // Reviewed reports join the miner's pool, which always samples them (mineHypotheses).
    const pool = mergeById(await reviewedCandidates(drones), control);
    const mined = await mineHypotheses(pool, drones, heuristic, { sampleSize: 400, seed: 1 });
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
      const s = await sandboxRule(p.id, "fast", { drones, control, fixtures });
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
