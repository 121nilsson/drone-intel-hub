import type { RawDispatch } from "@/entities/dispatch/types";
import type { MonitoredSource } from "@/entities/source/types";

/** Matches the cron in vite.config.ts: the default lane polls on every tick. */
export const FAST_INTERVAL_MS = 10 * 60_000;
/**
 * A source that has never once produced a drone-related post costs a request every tick and
 * yields nothing. Polling it hourly keeps its coverage while freeing the lanes.
 */
export const SLOW_INTERVAL_MS = 60 * 60_000;
/** The same bar the Sources page uses to tag a source "no signal", so both read one measure. */
export const NO_SIGNAL_STORED = 20;

export interface SourceYield {
  /** Dispatches stored by this source, duplicates included - the request cost it represents. */
  stored: number;
  /** Dispatches that turned out to be drone-related: analysed, or still queued for review. */
  relevant: number;
}

/**
 * Polling cadence from measured yield, so the fixed 10-minute cron stops spending most of its
 * requests on sources that have never paid off. A source with any drone-related post keeps the
 * fast lane - the cost of missing a first report beats the cost of a request. A source with a
 * long record of pure noise (the archive shows what the pipeline made of every post it fetched)
 * drops to hourly. Anything else - a new source, or too little data to judge - keeps the fast
 * lane until there is evidence either way.
 */
export function pollIntervalMs(y: SourceYield | undefined): number {
  if (!y || y.relevant > 0) return FAST_INTERVAL_MS;
  return y.stored >= NO_SIGNAL_STORED ? SLOW_INTERVAL_MS : FAST_INTERVAL_MS;
}

/** A source is due when its lane's interval has elapsed; one never fetched is due at once. */
export function isDue(s: MonitoredSource, y: SourceYield | undefined, now = Date.now()): boolean {
  if (!s.lastFetched) return true;
  const last = Date.parse(s.lastFetched);
  if (!Number.isFinite(last)) return true;
  return now - last >= pollIntervalMs(y);
}

/**
 * Yield per source over the dispatch archive. Same definitions as the Sources page's
 * breakdown, so the cadence decision and what an operator sees cannot diverge. The archive is
 * capped (see PostgresStore), so this is the recent record, not all of history - enough to sort
 * sources into lanes, and honest about being approximate.
 */
export function yieldBySource(dispatches: Iterable<RawDispatch>): Map<string, SourceYield> {
  const by = new Map<string, SourceYield>();
  for (const d of dispatches) {
    const y = by.get(d.sourceId) ?? { stored: 0, relevant: 0 };
    y.stored++;
    if (d.status === "processed" || d.outcome === "queued") y.relevant++;
    by.set(d.sourceId, y);
  }
  return by;
}
