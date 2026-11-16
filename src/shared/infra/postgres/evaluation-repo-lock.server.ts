import type { EvaluationLock } from "@/shared/contracts/evaluation-repo";
import { db } from "@/shared/infra/postgres/db.server";

export function createPostgresEvaluationLock(): EvaluationLock {
  return {
    async tryClaim(name, ttlMs) {
      const conn = db();
      const rows = await conn`
      insert into eval_lock (name, held_until)
      values (${name}, now() + (${ttlMs}::int * interval '1 millisecond'))
      on conflict (name) do update
        set held_until = excluded.held_until
        where eval_lock.held_until < now()
      returning name`;
      return rows.length > 0;
    },

    async release(name) {
      await db()`update eval_lock set held_until = now() where name = ${name}`;
    },
  };
}
