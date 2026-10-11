import { describe, expect, it } from "vitest";
import {
  FAST_INTERVAL_MS,
  NO_SIGNAL_STORED,
  SLOW_INTERVAL_MS,
  isDue,
  pollIntervalMs,
  yieldBySource,
} from "@/features/sources/cadence";
import type { MonitoredSource } from "@/entities/source/types";
import type { RawDispatch } from "@/entities/dispatch/types";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

const source = (over: Partial<MonitoredSource> = {}): MonitoredSource => ({
  id: "s",
  name: "Site",
  platform: "Web",
  handle: "https://example.com",
  domain: "Air",
  notes: "",
  ...over,
});

const dispatch = (sourceId: string, status: string, outcome?: string): RawDispatch =>
  ({
    id: `${sourceId}-${status}-${outcome ?? "none"}`,
    sourceId,
    sourceName: sourceId,
    externalId: "x",
    url: "https://example.com/x",
    text: "text",
    createdAt: iso(NOW),
    status,
    outcome,
  }) as RawDispatch;

describe("pollIntervalMs: the lane a source's measured yield earns it", () => {
  it("polls a source with any drone-related post every tick", () => {
    expect(pollIntervalMs({ stored: 200, relevant: 1 })).toBe(FAST_INTERVAL_MS);
  });

  it("slows a source with a long record of pure noise to hourly", () => {
    // Missing a first report costs more than a request, so anything short of a proven
    // no-signal record keeps the fast lane.
    expect(pollIntervalMs({ stored: NO_SIGNAL_STORED, relevant: 0 })).toBe(SLOW_INTERVAL_MS);
    expect(pollIntervalMs({ stored: NO_SIGNAL_STORED - 1, relevant: 0 })).toBe(FAST_INTERVAL_MS);
  });

  it("keeps polling a source with no record either way", () => {
    expect(pollIntervalMs(undefined)).toBe(FAST_INTERVAL_MS);
    expect(pollIntervalMs({ stored: 0, relevant: 0 })).toBe(FAST_INTERVAL_MS);
  });
});

describe("isDue", () => {
  it("treats a source never fetched as due at once", () => {
    expect(isDue(source(), undefined, NOW)).toBe(true);
  });

  it("holds a fast-lane source until its interval elapses, even with no yield record", () => {
    const s = source({ lastFetched: iso(NOW - 9 * 60_000) });
    expect(isDue(s, undefined, NOW)).toBe(false);
    expect(isDue(source({ lastFetched: iso(NOW - 11 * 60_000) }), undefined, NOW)).toBe(true);
  });

  it("holds a slowed source for an hour past its last fetch", () => {
    const noise = { stored: NO_SIGNAL_STORED, relevant: 0 };
    expect(isDue(source({ lastFetched: iso(NOW - 30 * 60_000) }), noise, NOW)).toBe(false);
    expect(isDue(source({ lastFetched: iso(NOW - 61 * 60_000) }), noise, NOW)).toBe(true);
  });

  it("fetches again when the stored timestamp is unusable", () => {
    expect(isDue(source({ lastFetched: "not a date" }), undefined, NOW)).toBe(true);
  });
});

describe("yieldBySource", () => {
  it("counts duplicates as stored but only drone-related posts as relevant", () => {
    const yields = yieldBySource([
      dispatch("a", "processed"),
      dispatch("a", "duplicate"),
      dispatch("a", "duplicate"),
      dispatch("a", "irrelevant"),
      dispatch("a", "failed"),
      dispatch("b", "pending", "queued"),
      dispatch("b", "pending"),
    ]);
    expect(yields.get("a")).toEqual({ stored: 5, relevant: 1 });
    expect(yields.get("b")).toEqual({ stored: 2, relevant: 1 });
  });

  it("says nothing about sources with no dispatches", () => {
    expect(yieldBySource([]).size).toBe(0);
  });
});
