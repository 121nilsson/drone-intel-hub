import type { SyncStateRepo } from "@/shared/contracts/sync-state-repo";
import { db } from "@/shared/infra/postgres/db.server";

/** PostgreSQL adapter for SyncStateRepo. */
export function createPostgresSyncStateRepo(): SyncStateRepo {
  return {
    async readSlots(names) {
      const sql = db();
      const rows = await sql`
      select name, last_sync, last_result from sync_state
      where name in ${sql([...names])}`;
      return rows.map((row) => ({
        name: row["name"] as string,
        lastSync: (row["last_sync"] as Date | null) ?? null,
        lastResult: row["last_result"],
      }));
    },
  };
}
