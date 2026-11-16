import { serverServices } from "@/shared/infra/server-services.server";
import { HeuristicExtractor } from "@/shared/infra/heuristic-ai";
import { getOrRefreshRuleSnapshot } from "@/shared/infra/heuristics/rule-registry.server";
import { comparableSpecs, evaluateHeuristic } from "@/shared/infra/evaluation/evaluation";
import { documentsOf } from "@/shared/contracts/store";
import type { Candidate, Drone } from "@/entities/drone/types";
import { claimLock, releaseLock } from "@/shared/infra/evaluation/evaluation-lock.server";
import { EVAL_SEED, pinnedCorpusVersion } from "@/shared/infra/evaluation/evaluation-corpus.server";

export interface HarvestResult {
  ran: boolean;
  reason: string;
  inserted: number;
  skipped: number;
  corpusVersion?: number;
}

/** Harvest trusted positive fixtures from a fresh evaluation run. */
export async function harvestCorpus(): Promise<{
  ran: boolean;
  reason: string;
  inserted: number;
  skipped: number;
  corpusVersion?: number;
}> {
  if (!serverServices().backend.capabilities.sql)
    return { ran: false, reason: "no database configured", inserted: 0, skipped: 0 };
  const lock = await claimLock();
  if (!lock.ok) return { ran: false, reason: lock.reason, inserted: 0, skipped: 0 };

  try {
    const store = await serverServices().backend.documents();
    const drones = (documentsOf(await store.load("drones")) ?? []) as unknown as Drone[];
    const candidates = (documentsOf(await store.load("candidates")) ??
      []) as unknown as Candidate[];
    const heuristic = new HeuristicExtractor(1, await getOrRefreshRuleSnapshot());
    const report = await evaluateHeuristic(candidates, drones, heuristic, {
      sampleSize: 200,
      seed: EVAL_SEED,
      includeDiscarded: false,
    });

    const currentVersion = await pinnedCorpusVersion();
    const nextVersion = currentVersion + 1;

    let inserted = 0;
    let skipped = 0;
    const perKeyCount = new Map<string, number>();
    const MAX_PER_KEY = 5;
    const MAX_TOTAL = 25;

    // Build corroboration counts using normalized/canonical form so the keys match
    // what fx.expect carries (canonical values and units from comparableSpecs).
    const refCounts = new Map<string, number>();
    for (const c of candidates) {
      for (const s of comparableSpecs(c.extraction)) {
        const key = `${s.semantic}|${s.canonical ?? s.value}|${s.canonicalUnit ?? s.unit ?? ""}`;
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

      if (await serverServices().evaluation.fixtureIdExists(fx.id)) {
        skipped++;
        continue;
      }

      await serverServices().evaluation.insertHarvestedFixture({
        id: fx.id,
        version: nextVersion,
        fixture: fx,
      });
      perKeyCount.set(key, (perKeyCount.get(key) ?? 0) + 1);
      inserted++;
    }

    if (inserted > 0) {
      await serverServices().evaluation.recordVersion(nextVersion, "harvest");
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
