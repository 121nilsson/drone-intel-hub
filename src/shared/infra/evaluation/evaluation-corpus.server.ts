import { serverServices } from "@/shared/infra/server-services.server";
import type { EvalFixture } from "@/shared/infra/evaluation/evaluation";
import fs from "node:fs";
import path from "node:path";

/**
 * One seed for every run, on purpose: the sample must be the same sample, or a trend line compares
 * two different corpora and calls the difference progress. Stored with each report so a report can
 * be reproduced. The corpus version is what changes over time.
 */
export const EVAL_SEED = 1;

/**
 * The corpus version a run is pinned to, read before its report is stored. Storing a constant
 * instead would let a metric move caused by corpus growth (harvest added fixtures) read as a
 * heuristic change, because the trend compares consecutive reports. 0 means nothing is harvested
 * yet, which is a true statement about the corpus.
 */
export async function pinnedCorpusVersion(): Promise<number> {
  return serverServices().evaluation.pinnedVersion();
}

/** Import git corpus files into eval_corpus (origin=git_import, status=approved). */
export async function importGitCorpus(): Promise<{ imported: number; skipped: number }> {
  const { backend, evaluation } = serverServices();
  if (!backend.capabilities.sql) return { imported: 0, skipped: 0 };
  const files = [
    { path: "src/test/fixtures/eval-corpus.json", kind: "positive" as const },
    { path: "src/test/fixtures/eval-mismatches.json", kind: "negative" as const },
  ];
  let imported = 0;
  let skipped = 0;
  for (const { path: p, kind } of files) {
    const full = path.resolve(process.cwd(), p);
    if (!fs.existsSync(full)) continue;
    const arr = JSON.parse(fs.readFileSync(full, "utf8")) as EvalFixture[];
    for (const fx of arr) {
      if (await evaluation.gitFixtureExists(fx.id)) {
        skipped++;
        continue;
      }
      await evaluation.insertGitFixture({ id: fx.id, kind, fixture: fx });
      imported++;
    }
  }
  return { imported, skipped };
}
