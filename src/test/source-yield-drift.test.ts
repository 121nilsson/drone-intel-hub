import { describe, expect, it } from "vitest";
import { yieldDrift, type FetchHistoryEntry } from "@/entities/source/health";

const NOW = Date.parse("2026-11-11T12:00:00Z");
// Newest first: entry 0 is the latest fetch, ten minutes apart.
const fetch = (i: number, ok: boolean, fetched: number): FetchHistoryEntry => ({
  at: new Date(NOW - i * 600_000).toISOString(),
  ok,
  fetched,
  relevant: 0,
});

describe("yieldDrift", () => {
  it("calls a source quiet when its last ten successes returned nothing after a yielding past", () => {
    const history = [
      ...Array.from({ length: 10 }, (_, i) => fetch(i, true, 0)),
      ...Array.from({ length: 10 }, (_, i) => fetch(10 + i, true, 3)),
    ];
    expect(yieldDrift(history, NOW)).toBe("quiet");
  });

  it("calls a source failing when its last five fetches all failed", () => {
    const history = [
      ...Array.from({ length: 5 }, (_, i) => fetch(i, false, 0)),
      ...Array.from({ length: 10 }, (_, i) => fetch(5 + i, true, 4)),
    ];
    expect(yieldDrift(history, NOW)).toBe("failing");
  });

  it("reports nothing for a source that keeps yielding", () => {
    const history = Array.from({ length: 30 }, (_, i) => fetch(i, true, i % 3 === 0 ? 0 : 2));
    expect(yieldDrift(history, NOW)).toBeUndefined();
  });

  it("reports nothing when the history is too short to call either way", () => {
    // Ten silent successes, but only five earlier yielding fetches to compare against.
    const quietShort = [
      ...Array.from({ length: 10 }, (_, i) => fetch(i, true, 0)),
      ...Array.from({ length: 5 }, (_, i) => fetch(10 + i, true, 3)),
    ];
    expect(yieldDrift(quietShort, NOW)).toBeUndefined();

    // Four failures is not yet five in a row.
    const failingShort = [
      ...Array.from({ length: 4 }, (_, i) => fetch(i, false, 0)),
      fetch(4, true, 2),
    ];
    expect(yieldDrift(failingShort, NOW)).toBeUndefined();

    expect(yieldDrift([], NOW)).toBeUndefined();
  });

  it("ignores fetches older than the thirty-day window", () => {
    // Ten silent successes now, but the yielding past is more than thirty days back.
    const history = [
      ...Array.from({ length: 10 }, (_, i) => fetch(i, true, 0)),
      ...Array.from({ length: 10 }, (_, i) => ({
        at: new Date(NOW - 40 * 86_400_000 - i * 600_000).toISOString(),
        ok: true,
        fetched: 3,
        relevant: 0,
      })),
    ];
    expect(yieldDrift(history, NOW)).toBeUndefined();
  });
});
