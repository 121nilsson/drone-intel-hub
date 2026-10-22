import { describe, expect, it } from "vitest";
import { db } from "@/shared/infra/postgres/db.server";
import { runEvaluation } from "@/shared/infra/evaluation/evaluation.server";

const configured = !!process.env["DATABASE_URL"];

/**
 * The report row is what the trend and the health comparison read, so the version it names must be
 * the corpus that was measured. Writing a constant 1 while harvest had already bumped the corpus to
 * version N made a metric move caused by new fixtures read as a heuristic regression, because the
 * health run compares consecutive reports without knowing the corpus changed underneath them.
 *
 * Skipped without DATABASE_URL, like the other store-level tests: the stored value is SQL, so only
 * the real database can vouch for it. Run with the local Docker database to see it execute.
 */
describe.skipIf(!configured)("the evaluation report pins the corpus version", () => {
  // A real run samples the whole catalogue and evaluates 200 items; it is not a unit test's pace.
  it("stores the current corpus version rather than a constant", { timeout: 120_000 }, async () => {
    const res = await runEvaluation();
    expect(res.ran).toBe(true);
    expect(res.reportId).toBeTruthy();

    const reportRows = (await db()`
      select corpus_version, seed from eval_reports where id = ${res.reportId!}`) as unknown as {
      corpus_version: number;
      seed: number;
    }[];
    const corpusRows = (await db()`
      select coalesce(max(version), 0) as v from eval_corpus_version`) as unknown as {
      v: number;
    }[];

    // The seed stays the pinned constant; the corpus version is a reading, not a constant.
    expect(reportRows[0]?.seed).toBe(1);
    expect(reportRows[0]?.corpus_version).toBe(corpusRows[0]?.v);
    // On an unharvested corpus this is the assertion the constant could never satisfy.
    expect(reportRows[0]?.corpus_version).not.toBeUndefined();
  });
});
