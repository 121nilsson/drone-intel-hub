import type { JSONValue } from "postgres";
import type { SourceSyncRepo } from "@/shared/contracts/source-sync-repo";
import {
  SYNC_COOLDOWN_SLOT,
  SYNC_PROGRESS_SLOT,
  SYNC_SLOT,
} from "@/shared/contracts/sync-state-repo";
import { db } from "@/shared/infra/postgres/db.server";
import { sanitizeJson } from "@/shared/infra/json-sanitize";

const SLOT = SYNC_SLOT;
const PROGRESS_SLOT = SYNC_PROGRESS_SLOT;
const COOLDOWN_SLOT = SYNC_COOLDOWN_SLOT;

/** PostgreSQL adapter for SourceSyncRepo. */
export function createPostgresSourceSyncRepo(): SourceSyncRepo {
  return {
    async claimSlot(minIntervalMs, force) {
      // A forced run still has to stamp last_sync, otherwise the slot stays free and the next
      // cron tick could start immediately after a manual sync. Forcing drops the interval
      // check (the WHERE clause), not the bookkeeping.
      if (force) {
        const rows = await db()`
      insert into sync_state (name, last_sync) values (${SLOT}, now())
      on conflict (name) do update set last_sync = excluded.last_sync
      returning last_sync`;
        return rows.length > 0;
      }
      const rows = await db()`
    insert into sync_state (name, last_sync) values (${SLOT}, now())
    on conflict (name) do update set last_sync = excluded.last_sync
    where sync_state.last_sync <= now() - ${`${minIntervalMs} milliseconds`}::interval
    returning last_sync`;
      return rows.length > 0;
    },

    async releaseSlot() {
      await db()`delete from sync_state where name = ${SLOT}`;
    },

    async storeResult(result) {
      const conn = db();
      // Interface types lack an index signature, so postgres.js' JSONValue rejects them.
      await conn`update sync_state set last_result = ${conn.json(sanitizeJson(result as unknown as JSONValue))} where name = ${SLOT}`;
    },

    async readCooldown() {
      const rows = await db()`select last_result from sync_state where name = ${COOLDOWN_SLOT}`;
      return rows.length ? rows[0]!["last_result"] : undefined;
    },

    async writeCooldown(cooldown) {
      const conn = db();
      await conn`
    insert into sync_state (name, last_sync, last_result)
    values (${COOLDOWN_SLOT}, now(), ${conn.json(sanitizeJson(cooldown as unknown as JSONValue))})
    on conflict (name) do update
      set last_sync = excluded.last_sync,
          last_result = excluded.last_result`;
    },

    async clearCooldown() {
      await db()`delete from sync_state where name = ${COOLDOWN_SLOT}`;
    },

    async writeProgress(progress) {
      const conn = db();
      await conn`
    insert into sync_state (name, last_sync, last_result)
    values (${PROGRESS_SLOT}, now(), ${conn.json(sanitizeJson(progress as unknown as JSONValue))})
    on conflict (name) do update
      set last_sync = excluded.last_sync,
          last_result = excluded.last_result`;
    },
  };
}
