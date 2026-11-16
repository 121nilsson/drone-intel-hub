import type { JSONValue } from "postgres";
import { BRIEFING_SUMMARY_SLOT, type BriefingRepo } from "@/shared/contracts/briefing-repo";
import { db } from "@/shared/infra/postgres/db.server";
import { sanitizeJson } from "@/shared/infra/json-sanitize";

/** PostgreSQL adapter for BriefingRepo. */
export function createPostgresBriefingRepo(): BriefingRepo {
  return {
    async readSummary() {
      const rows = await db()`
    select last_result from sync_state where name = ${BRIEFING_SUMMARY_SLOT}`;
      const row = rows[0];
      return row ? row["last_result"] : undefined;
    },

    async writeSummary(entry) {
      const conn = db();
      await conn`
    insert into sync_state (name, last_sync, last_result)
    values (${BRIEFING_SUMMARY_SLOT}, now(), ${conn.json(sanitizeJson(entry as unknown as JSONValue))})
    on conflict (name) do update
      set last_sync = excluded.last_sync,
          last_result = excluded.last_result`;
    },
  };
}
