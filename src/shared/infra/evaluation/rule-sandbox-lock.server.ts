import { db } from "@/shared/infra/postgres/db.server";

/** Serializes activations across processes (web, tasks): see withActivationLock. */
export const ACTIVATION_LOCK = 7_301_002;

/**
 * Two activations sandboxed at once would each be checked against a rule set without the
 * other, so a pair that only breaks in combination would go live and wait for the nightly
 * breaker. Holding a session advisory lock on a reserved connection makes each activation see
 * every one before it; the lock dies with the connection if the process does.
 */
export async function withActivationLock<T>(
  fn: () => Promise<T>,
): Promise<T | { ok: false; reason: string }> {
  const conn = await db().reserve();
  try {
    await conn`set lock_timeout = '120s'`;
    try {
      await conn`select pg_advisory_lock(${ACTIVATION_LOCK})`;
    } catch {
      return { ok: false, reason: "another activation is still running - try again" };
    }
    try {
      return await fn();
    } finally {
      await conn`select pg_advisory_unlock(${ACTIVATION_LOCK})`;
    }
  } finally {
    await conn`reset lock_timeout`.catch(() => {});
    conn.release();
  }
}
