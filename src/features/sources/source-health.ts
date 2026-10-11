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

export function isPaused(s: MonitoredSource, now = Date.now()): boolean {
  return !!s.pausedUntil && Date.parse(s.pausedUntil) > now;
}

/** Collected by auto-sync and "Fetch all": not off, not paused. X is excluded elsewhere. */
export function isCollectable(s: MonitoredSource, now = Date.now()): boolean {
  return s.autoSync !== false && !isPaused(s, now);
}

/** The patch to store after one fetch of `s`, given its error (undefined on success). */
export function healthAfterFetch(
  s: MonitoredSource,
  error: string | undefined,
  now = Date.now(),
): Partial<MonitoredSource> {
  if (!error) {
    if (!s.failStreak && !s.pausedUntil && !s.pausedOnce) return {};
    return { failStreak: 0, pausedUntil: undefined, pausedOnce: false };
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
    disabledReason: undefined,
  };
}
