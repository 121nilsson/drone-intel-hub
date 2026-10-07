import type { JSONValue } from "postgres";
import { QUEUE_ROW, type SyncReport, type WorkProgress } from "@/features/sources/auto-ingest";
import { db, dbConfigured } from "./postgres/db.server";

/** Single global throttle slot for the auto-ingest job. */
const SLOT = "sources:auto";
/**
 * Live auto-sync heartbeat. Its own row, so writing progress never touches the throttle slot.
 * `last_result` holds a WorkProgress object. A database created before this row simply has no
 * progress until the next run writes one.
 */
const PROGRESS_SLOT = "sources:progress";

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Accept only a complete heartbeat. A corrupt blob is "no progress", not a thrown read. */
function parseProgress(raw: unknown): WorkProgress | null {
  const value = typeof raw === "string" ? safeJson(raw) : raw;
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  const phase = p["phase"];
  if (phase !== "fetching" && phase !== "analysing" && phase !== "done") return null;
  if (typeof p["current"] !== "string" || typeof p["updatedAt"] !== "string") return null;
  const index = num(p["index"]);
  const total = num(p["total"]);
  const processed = num(p["processed"]);
  const irrelevant = num(p["irrelevant"]);
  const merged = num(p["merged"]);
  const queued = num(p["queued"]);
  const failed = num(p["failed"]);
  const remaining = num(p["remaining"]);
  if (
    index === null ||
    total === null ||
    processed === null ||
    irrelevant === null ||
    merged === null ||
    queued === null ||
    failed === null ||
    remaining === null
  )
    return null;
  const currentId = p["currentId"];
  return {
    phase,
    current: p["current"],
    ...(typeof currentId === "string" ? { currentId } : {}),
    index,
    total,
    processed,
    irrelevant,
    merged,
    queued,
    failed,
    remaining,
    updatedAt: p["updatedAt"],
  };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeProgress(progress: WorkProgress) {
  const conn = db();
  await conn`
    insert into sync_state (name, last_sync, last_result)
    values (${PROGRESS_SLOT}, now(), ${conn.json(progress as unknown as JSONValue)})
    on conflict (name) do update
      set last_sync = excluded.last_sync,
          last_result = excluded.last_result`;
}

/**
 * Claim the throttle slot. The WHERE clause on the conflict branch makes this a
 * compare-and-swap: overlapping cron ticks or a manual click cannot both win, so a second
 * run cannot start while one is in flight. Returns false when the minimum interval has not
 * elapsed. Timestamps the *start* of a run, which also bounds retry frequency after a
 * slow or failing run.
 */
async function claimSlot(minIntervalMs: number, force: boolean): Promise<boolean> {
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
}

async function storeResult(result: SyncReport[]) {
  const conn = db();
  // Interface types lack an index signature, so postgres.js' JSONValue rejects them.
  await conn`update sync_state set last_result = ${conn.json(result as unknown as JSONValue)} where name = ${SLOT}`;
}

async function releaseSlot() {
  try {
    await db()`delete from sync_state where name = ${SLOT}`;
  } catch {
    /* nothing to release */
  }
}

export interface SyncState {
  lastSync: string | null;
  configured: boolean;
  /** Heartbeat of the background auto-sync, or null when it has never reported. */
  progress: WorkProgress | null;
}

/** Throttle state for the UI. Never throws: a missing table just means "no auto-sync yet". */
export async function readSyncState(): Promise<SyncState> {
  if (!dbConfigured()) return { lastSync: null, configured: false, progress: null };
  try {
    const rows = await db()`
      select name, last_sync, last_result from sync_state
      where name = ${SLOT} or name = ${PROGRESS_SLOT}`;
    let lastSync: string | null = null;
    let progress: WorkProgress | null = null;
    for (const row of rows) {
      if (row["name"] === SLOT) {
        const raw = row["last_sync"];
        lastSync = raw ? new Date(raw as Date).toISOString() : null;
      } else if (row["name"] === PROGRESS_SLOT) {
        progress = parseProgress(row["last_result"]);
      }
    }
    return { lastSync, configured: true, progress };
  } catch (e) {
    console.error("[sync-state]", e);
    return { lastSync: null, configured: false, progress: null };
  }
}

/**
 * Attempt one auto-ingest pass. `minIntervalMs` (default 1 min) is enforced by the
 * compare-and-swap above unless `force` is set, which the manual button uses.
 */
export async function runAutoSync(opts?: {
  minIntervalMs?: number;
  force?: boolean;
}): Promise<{ ran: boolean; reason: string }> {
  const minIntervalMs =
    typeof opts?.minIntervalMs === "number" && opts.minIntervalMs >= 0
      ? opts.minIntervalMs
      : 60_000;
  const force = opts?.force === true;

  if (!dbConfigured()) return { ran: false, reason: "Auto-sync needs DATABASE_URL (PostgreSQL)" };

  let claimed: boolean;
  try {
    claimed = await claimSlot(minIntervalMs, force);
  } catch (e) {
    console.error("[auto-sync] throttle unavailable", e);
    return { ran: false, reason: "sync_state missing - apply migrations/002_sync_state.sql" };
  }
  if (!claimed) return { ran: false, reason: "Throttled: minimum interval not elapsed" };

  const report = async (progress: WorkProgress) => {
    try {
      await writeProgress(progress);
    } catch (e) {
      console.error("[auto-sync] progress", e);
    }
  };

  try {
    const { fetchAllSources } = await import("./fetch-posts.server");
    const reports = await fetchAllSources(report);
    await storeResult(reports);
    // The queue is reported as a pseudo-source row, so exclude it from the source count and
    // from the unreachable count. Its failures (rate limits, bad posts) matter, but calling
    // them "sources failed" would misattribute them.
    const sources = reports.filter((r) => r.source !== QUEUE_ROW);
    const queue = reports.find((r) => r.source === QUEUE_ROW);
    const unreachable = sources.filter((r) => r.error).length;
    const parts = [`Collected ${sources.length} sources`];
    if (unreachable) parts.push(`${unreachable} unreachable`);
    if (queue?.error) parts.push(queue.error);
    return { ran: true, reason: parts.join(", ") };
  } catch (e) {
    // Release the slot so a transient failure does not lock out the next tick.
    await releaseSlot();
    const reason = e instanceof Error ? e.message : "Sync failed";
    // A thrown run must not leave the heartbeat on "fetching" until it goes stale.
    await writeProgress({
      phase: "done",
      current: reason,
      index: 0,
      total: 0,
      processed: 0,
      irrelevant: 0,
      merged: 0,
      queued: 0,
      failed: 0,
      remaining: 0,
      updatedAt: new Date().toISOString(),
    }).catch(() => {});
    return { ran: false, reason };
  }
}
