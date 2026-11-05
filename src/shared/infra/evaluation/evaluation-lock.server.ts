import { db } from "@/shared/infra/postgres/db.server";

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
    const conn = db();
    const rows = await conn`
      insert into eval_lock (name, held_until)
      values (${LOCK_NAME}, now() + (${LOCK_MS}::int * interval '1 millisecond'))
      on conflict (name) do update
        set held_until = excluded.held_until
        where eval_lock.held_until < now()
      returning name`;
    return rows.length > 0 ? { ok: true } : { ok: false, reason: "lock held" };
  } catch (e) {
    return {
      ok: false,
      reason: `lock unavailable: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export async function releaseLock() {
  await db()`update eval_lock set held_until = now() where name = ${LOCK_NAME}`;
}
