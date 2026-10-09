import { describe, expect, it } from "vitest";
import { combineExtractions, needsDeepAI, needsFastAI } from "@/features/intake/extraction-gates";
import type { Extraction } from "@/entities/drone/types";

const extraction = (over: Partial<Extraction> = {}): Extraction => ({
  name: "Geran-2",
  aliases: [],
  operators: [],
  specs: [{ key: "range", label: "Range", value: 1000, unit: "km" }],
  rfBands: [],
  systems: [{ name: "Geran-2", matchId: "geran-2" }],
  matchId: "geran-2",
  confidence: 0.9,
  rationale: "test",
  ...over,
});

describe("extraction gates", () => {
  it("skips provider calls for complete deterministic extraction", () => {
    expect(needsFastAI(extraction(), 0.6).needed).toBe(false);
  });

  it("uses fast AI for novel systems but does not use deep AI for no-match alone", () => {
    const novel = extraction({
      name: "Geran-5",
      systems: [{ name: "Geran-5", variantOf: "geran-2" }],
    });
    delete novel.matchId;
    expect(needsFastAI(novel, 0.6).needed).toBe(true);
    expect(needsDeepAI(novel, 0.6).needed).toBe(false);
  });

  it("preserves deterministic observations when AI adds fields", () => {
    const combined = combineExtractions(
      extraction(),
      extraction({ specs: [{ key: "weight_mtow", label: "MTOW", value: 250, unit: "kg" }] }),
    );
    expect(combined.specs.map((s) => s.key)).toEqual(["range", "weight_mtow"]);
  });
});
