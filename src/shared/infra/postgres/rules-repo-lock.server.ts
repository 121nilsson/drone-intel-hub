import { ACTIVATION_LOCK, type RuleLock } from "@/shared/contracts/rules-repo";
import { db } from "./db.server";

/**
 * Two activations sandboxed at once would each be checked against a rule set without the
 * other, so a pair that only breaks in combination would go live and wait for the nightly
 * breaker. Holding a session advisory lock on a reserved connection makes each activation see
 * every one before it; the lock dies with the connection if the process does.
 */
export function createPostgresRuleLock(): RuleLock {
  return {
    async withActivationLock(fn) {
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
    },
  };
}
