import { describe, expect, it } from "vitest";
import {
  BRIEFING_SUMMARY_TTL_MS,
  isBriefingSummaryFresh,
  parseBriefingSummaryStored,
} from "@/shared/contracts/briefing-summary";

describe("briefing summary shared", () => {
  it("parses stored rows", () => {
    expect(
      parseBriefingSummaryStored({
        summary: "text",
        generatedAt: 1,
        contextFingerprint: "abc",
      }),
    ).toEqual({ summary: "text", generatedAt: 1, contextFingerprint: "abc" });
    expect(parseBriefingSummaryStored({ summary: "x" })).toBeNull();
  });

  it("respects TTL", () => {
    const now = 1_700_000_000_000;
    expect(isBriefingSummaryFresh(now - 60_000, now)).toBe(true);
    expect(isBriefingSummaryFresh(now - BRIEFING_SUMMARY_TTL_MS - 1, now)).toBe(false);
  });
});
