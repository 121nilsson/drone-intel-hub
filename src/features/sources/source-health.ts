import type { MonitoredSource } from "@/entities/source/types";

/**
 * Self-healing source list. A source that keeps failing (a site that started returning 403, a
 * channel that went private) costs a request and an error line on every run and buries the
 * sources that work. So:
 *
 * 1. after FAILURES_BEFORE_PAUSE consecutive failures it is PAUSED for PAUSE_MS;
 * 2. when the pause ends it is tried again automatically, because sites come back;
 * 3. if it then fails FAILURES_BEFORE_PAUSE times again without a single success in between, it
 *    is turned OFF (autoSync false) with the reason recorded, for an analyst to look at.
 *
 * Any success resets all of it. Turning a source back on by hand clears the history too.
 */
export const FAILURES_BEFORE_PAUSE = 3;
export const PAUSE_MS = 7 * 86_400_000;

/**
 * Consecutive 200-replies-with-no-posts at which a source counts as silent on the Sources page.
 * Silence is deliberately never a failure: a feed that publishes once a week legally returns
 * nothing on 97% of the cron's ticks, and pausing it for that would cost a week of intel. The
 * streak only marks the source, and feeds the fleet check in platformDrift, which catches the
 * one case silence really does indicate - a parser change that empties a platform at once.
 */
export const SILENT_RUNS = 36; // ~6h at the 10-minute cron

export function isPaused(s: MonitoredSource, now = Date.now()): boolean {
  return !!s.pausedUntil && Date.parse(s.pausedUntil) > now;
}

/** Collected by auto-sync and "Fetch all": not off, not paused. X is excluded elsewhere. */
export function isCollectable(s: MonitoredSource, now = Date.now()): boolean {
  return s.autoSync !== false && !isPaused(s, now);
}

/**
 * The patch to store after one fetch of `s`, given its error (undefined on success) and how many
 * posts the fetch returned (0 when it failed).
 *
 * A successful run that returned posts is also the proof the parser still works on this source;
 * that is what lastPostAt records and what platformDrift's denominator needs. A successful run
 * that returned nothing is not a failure, just a longer silence streak.
 */
export function healthAfterFetch(
  s: MonitoredSource,
  error: string | undefined,
  now = Date.now(),
  fetched = 0,
): Partial<MonitoredSource> {
  if (!error) {
    if (fetched === 0)
      return {
        failStreak: 0,
        pausedUntil: undefined,
        pausedOnce: false,
        emptyStreak: (s.emptyStreak ?? 0) + 1,
      };
    return {
      failStreak: 0,
      pausedUntil: undefined,
      pausedOnce: false,
      emptyStreak: 0,
      lastPostAt: new Date(now).toISOString(),
    };
  }
  const streak = (s.failStreak ?? 0) + 1;
  if (streak < FAILURES_BEFORE_PAUSE) return { failStreak: streak };
  if (s.pausedOnce)
    return {
      failStreak: 0,
      pausedUntil: undefined,
      autoSync: false,
      disabledReason: `Turned off ${new Date(now).toISOString().slice(0, 10)}: still failing after a ${PAUSE_MS / 86_400_000}-day pause (${error})`,
    };
  return {
    failStreak: 0,
    pausedUntil: new Date(now + PAUSE_MS).toISOString(),
    pausedOnce: true,
  };
}

/** Turning a source on by hand starts it with a clean record. */
export function reenable(): Partial<MonitoredSource> {
  return {
    autoSync: true,
    failStreak: 0,
    pausedUntil: undefined,
    pausedOnce: false,
    emptyStreak: 0,
  };
}

/** Shown next to a source that keeps answering 200 with no posts; null while it is within bounds. */
export function silenceNotice(s: MonitoredSource): string | null {
  const n = s.emptyStreak ?? 0;
  if (n < SILENT_RUNS) return null;
  return `Silent: ${n} fetches in a row returned no posts — parser drift or a channel gone quiet`;
}

export interface DriftInput {
  platform: string;
  /** Posts this run's fetch returned for the source. */
  fetched: number;
  /** When the source last proved its parser works; drift needs a recent one. */
  lastPostAt?: string | undefined;
}

/**
 * The signal a per-source silence check cannot see: a parser change (new Telegram markup, a feed
 * served as HTML) empties every source on one platform in the same run, while each source alone
 * reads as a quiet day. Only sources with a recent yield count, so a genuinely quiet corner of
 * the list is not mistaken for a broken one.
 */
export function platformDrift(sources: DriftInput[], now = Date.now()): string[] {
  const RECENT_MS = 7 * 86_400_000;
  const by = new Map<string, { proven: number; silent: number }>();
  for (const s of sources) {
    const last = s.lastPostAt ? Date.parse(s.lastPostAt) : NaN;
    if (!Number.isFinite(last) || now - last > RECENT_MS) continue;
    const entry = by.get(s.platform) ?? { proven: 0, silent: 0 };
    entry.proven++;
    if (s.fetched === 0) entry.silent++;
    by.set(s.platform, entry);
  }
  const out: string[] = [];
  for (const [platform, e] of by) {
    if (e.proven >= 4 && e.silent * 4 >= e.proven * 3)
      out.push(`${e.silent} of ${e.proven} ${platform} sources returned no posts`);
  }
  return out;
}
