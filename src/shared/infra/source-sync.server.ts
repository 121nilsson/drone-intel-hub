import type { JSONValue } from "postgres";
import {
  QUEUE_ROW,
  nextCooldown,
  providerErrorKind,
  type Cooldown,
  type SyncReport,
  type WorkProgress,
} from "@/features/sources/auto-ingest";
import { db, dbConfigured } from "./postgres/db.server";

/** Single global throttle slot for the auto-ingest job. */
const SLOT = "sources:auto";
/**
 * Live auto-sync heartbeat. Its own row, so writing progress never touches the throttle slot.
 * `last_result` holds a WorkProgress object. A database created before this row simply has no
 * progress until the next run writes one.
 */
const PROGRESS_SLOT = "sources:progress";
/**
 * Rate-limit cooldown, persisted so it survives across ticks and restarts: the in-process
 * pacer forgets a 429 the moment the run ends. `last_result` holds a Cooldown object.
 */
const COOLDOWN_SLOT = "sources:cooldown";

function parseCooldown(raw: unknown): Cooldown | null {
  const value = typeof raw === "string" ? safeJson(raw) : raw;
  if (!value || typeof value !== "object") return null;
  const c = value as Record<string, unknown>;
  const level = num(c["level"]);
  const until = c["until"];
  if (level === null || typeof until !== "string" || Number.isNaN(Date.parse(until))) return null;
  return { level, until };
}

async function readCooldown(): Promise<Cooldown | null> {
  const rows = await db()`select last_result from sync_state where name = ${COOLDOWN_SLOT}`;
  return rows.length ? parseCooldown(rows[0]!["last_result"]) : null;
}

async function writeCooldown(cooldown: Cooldown) {
  const conn = db();
  await conn`
    insert into sync_state (name, last_sync, last_result)
    values (${COOLDOWN_SLOT}, now(), ${conn.json(cooldown as unknown as JSONValue)})
    on conflict (name) do update
      set last_sync = excluded.last_sync,
          last_result = excluded.last_result`;
}

async function clearCooldown() {
  await db()`delete from sync_state where name = ${COOLDOWN_SLOT}`;
}

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
  const promoted = num(p["promoted"]);
  const discarded = num(p["discarded"]);
  return {
    phase,
    current: p["current"],
    ...(typeof currentId === "string" ? { currentId } : {}),
    index,
    total,
    processed,
    irrelevant,
    merged,
    ...(promoted !== null ? { promoted } : {}),
    ...(discarded !== null ? { discarded } : {}),
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
  /** While in the future, auto-sync collects but skips AI work after a provider rate limit. */
  cooldownUntil: string | null;
}

/** Throttle state for the UI. Never throws: a missing table just means "no auto-sync yet". */
export async function readSyncState(): Promise<SyncState> {
  const none: SyncState = { lastSync: null, configured: false, progress: null, cooldownUntil: null };
  if (!dbConfigured()) return none;
  try {
    const rows = await db()`
      select name, last_sync, last_result from sync_state
      where name in (${SLOT}, ${PROGRESS_SLOT}, ${COOLDOWN_SLOT})`;
    let lastSync: string | null = null;
    let progress: WorkProgress | null = null;
    let cooldownUntil: string | null = null;
    for (const row of rows) {
      if (row["name"] === SLOT) {
        const raw = row["last_sync"];
        lastSync = raw ? new Date(raw as Date).toISOString() : null;
      } else if (row["name"] === PROGRESS_SLOT) {
        progress = parseProgress(row["last_result"]);
      } else if (row["name"] === COOLDOWN_SLOT) {
        const c = parseCooldown(row["last_result"]);
        if (c && Date.parse(c.until) > Date.now()) cooldownUntil = c.until;
      }
    }
    return { lastSync, configured: true, progress, cooldownUntil };
  } catch (e) {
    console.error("[sync-state]", e);
    return none;
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
    // A cooldown read failure must not block collection; it just means "no cooldown known".
    const cooldown = await readCooldown().catch(() => null);
    const cooling = cooldown && Date.parse(cooldown.until) > Date.now() ? cooldown : null;
    const { fetchAllSources } = await import("./fetch-posts.server");
    const { reports, stopReason } = await fetchAllSources(report, {
      ...(cooling ? { cooldownUntil: cooling.until } : {}),
    });
    await storeResult(reports);
    try {
      if (stopReason && providerErrorKind(stopReason) === "rate limit")
        await writeCooldown(nextCooldown(cooldown));
      else if (!cooling && cooldown) await clearCooldown();
    } catch (e) {
      console.error("[auto-sync] cooldown", e);
    }
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
