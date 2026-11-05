import { db, dbConfigured } from "@/shared/infra/postgres/db.server";
import { sanitizeJson } from "@/shared/infra/json-sanitize";
import type { JSONValue } from "postgres";
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
  const rows = await db()`select coalesce(max(version), 0) as v from eval_corpus_version`;
  return (rows[0]?.["v"] as number) ?? 0;
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
