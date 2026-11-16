import { serverServices } from "@/shared/infra/server-services.server";

export const LOCK_NAME = "evaluation";
export const LOCK_MS = 10 * 60 * 1000;

/**
 * Try to acquire the evaluation lock. Never throws: a claim that cannot be made (the lock table
 * missing on a database that has not finished migrating, a dropped connection) is reported to the
 * caller, because a scheduled run has nowhere to put a rejected promise. "lock held" keeps its
 * meaning - another run is active, not a broken database.
 */
export async function claimLock(): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const claimed = await serverServices().evaluation.tryClaim(LOCK_NAME, LOCK_MS);
    return claimed ? { ok: true } : { ok: false, reason: "lock held" };
  } catch (e) {
    return {
      ok: false,
      reason: `lock unavailable: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export async function releaseLock() {
  await serverServices().evaluation.release(LOCK_NAME);
}
