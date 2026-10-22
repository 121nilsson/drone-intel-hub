import { describe, expect, it, vi } from "vitest";

/**
 * A scheduled evaluation must report a lock it could not take, not reject.
 *
 * The claim used to run before the try, so a database without the lock table - reproduced while
 * the evaluation migration was still being applied - escaped as a rejected promise from the cron
 * tick, and the task had no result to log. The two failures are not the same thing either:
 * "lock held" is another run doing the work, "lock unavailable" is a database that needs
 * attention, so the reason has to keep them apart.
 */
vi.mock("@/shared/infra/postgres/db.server", () => ({
  dbConfigured: () => true,
  db: () => {
    throw new Error('relation "eval_lock" does not exist');
  },
}));

const { runEvaluation, runEvaluationHealth, harvestCorpus } =
  await import("@/shared/infra/evaluation/evaluation.server");

describe("an evaluation run that cannot take the lock", () => {
  it("returns the reason instead of rejecting", async () => {
    const res = await runEvaluation();

    expect(res.ran).toBe(false);
    expect(res.reason).toContain("lock unavailable");
    // The provider's own wording survives, so the cause is diagnosable from the result.
    expect(res.reason).toContain("eval_lock");
  });

  it("says the same for the health run, which must still answer its interface", async () => {
    const res = await runEvaluationHealth();

    expect(res).toMatchObject({ ran: false, regression: false, details: [] });
    expect(res.reason).toContain("lock unavailable");
  });

  it("does not report harvest work it did not do", async () => {
    const res = await harvestCorpus();

    expect(res).toMatchObject({ ran: false, inserted: 0, skipped: 0 });
    expect(res.reason).toContain("lock unavailable");
  });
});
