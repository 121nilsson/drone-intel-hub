import { afterEach, describe, expect, it } from "vitest";
import {
  BRIEFING_SUMMARY_TTL_MS,
  readBriefingSummaryCache,
  writeBriefingSummaryCache,
} from "@/features/briefing/briefing-summary-cache";

describe("briefing summary cache", () => {
  afterEach(() => localStorage.clear());

  it("returns a summary within the TTL", () => {
    const now = 1_700_000_000_000;
    writeBriefingSummaryCache({ summary: "Cached text", generatedAt: now - 60_000 });
    expect(readBriefingSummaryCache(now)?.summary).toBe("Cached text");
  });

  it("expires after the TTL", () => {
    const now = 1_700_000_000_000;
    writeBriefingSummaryCache({ summary: "Stale", generatedAt: now - BRIEFING_SUMMARY_TTL_MS - 1 });
    expect(readBriefingSummaryCache(now)).toBeNull();
  });
});
