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

describe("combineExtractions: the AI decides identity", () => {
  /** `extraction()` minus identity fields; exactOptionalPropertyTypes forbids `name: undefined`. */
  const unnamed = (over: Partial<Extraction> = {}): Extraction => {
    const { name: _n, matchId: _m, ...rest } = extraction(over);
    void _n;
    void _m;
    return rest;
  };
  const ai = (over: Partial<Extraction> = {}): Extraction => ({
    ...unnamed({ systems: [], systemExtractions: [], specs: [], confidence: 0 }),
    metadata: { schemaVersion: 2, engine: "ai", analyzedAt: "" },
    ...over,
  });
  const noisy: Extraction = {
    ...unnamed(),
    name: "National",
    systems: [{ name: "National" }, { name: "Svatove" }],
    systemExtractions: [
      { name: "National", specs: [], rfBands: [], confidence: 0.1 },
      { name: "Svatove", specs: [], rfBands: [], confidence: 0.1 },
    ],
    confidence: 0.1,
    metadata: { schemaVersion: 2, engine: "heuristic", analyzedAt: "" },
  };

  it("drops unconfirmed heuristic systems when the AI finds none", () => {
    const c = combineExtractions(noisy, ai());
    expect(c.name).toBeUndefined();
    expect(c.systems).toEqual([]);
    expect(c.systemExtractions).toEqual([]);
    expect(c.confidence).toBe(0);
    // Facts are still never dropped.
    expect(c.specs.map((s) => s.key)).toEqual(["range"]);
  });

  it("keeps a catalog match even when the AI misses it", () => {
    const c = combineExtractions(extraction({ confidence: 0.8 }), ai());
    expect(c.name).toBe("Geran-2");
    expect(c.systems).toEqual([{ name: "Geran-2", matchId: "geran-2" }]);
    expect(c.confidence).toBe(0.8);
  });

  it("keeps a heuristic system the AI confirms, without duplicating it", () => {
    const c = combineExtractions(
      noisy,
      ai({ name: "Svatove", systems: [{ name: "Svatove" }], confidence: 0.4 }),
    );
    expect(c.systems).toEqual([{ name: "Svatove" }]);
    expect(c.confidence).toBe(0.4);
  });

  it("skips the deep tier once the AI has found no system", () => {
    expect(needsDeepAI(combineExtractions(noisy, ai()), 0.6).needed).toBe(false);
    // A heuristic-only result with no system still escalates as before.
    const heuristicOnly: Extraction = {
      ...unnamed({ systems: [], confidence: 0.1 }),
      metadata: { schemaVersion: 2, engine: "heuristic", analyzedAt: "" },
    };
    expect(needsDeepAI(heuristicOnly, 0.6).needed).toBe(true);
  });
});
