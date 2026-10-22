import { describe, expect, it } from "vitest";
import { consensus } from "@/entities/drone/consensus";
import {
  ANALYST_SOURCE,
  claimCounts,
  claimKey,
  heldReviews,
  restoreReviews,
} from "@/entities/drone/claim-review";
import { reviewSpecClaim, moveSpecClaim } from "@/shared/infra/catalog-operations";
import { adjudicateContradictions } from "@/shared/infra/ingest/contradictions";
import type { ContradictionAdjudicator } from "@/shared/contracts/ai";
import type { DroneRepository } from "@/shared/contracts/repository";
import type { Drone, SpecAttribute, SpecClaim } from "@/entities/drone/types";

const AT = "2026-10-20T12:00:00.000Z";

const claim = (value: number, source: string, over: Partial<SpecClaim> = {}): SpecClaim => ({
  value,
  source,
  date: "2026-10-01T00:00:00.000Z",
  normalized: { raw: `${value} km`, canonicalValue: value, canonicalUnit: "km", confidence: 1 },
  ...over,
});

const range = (claims: SpecClaim[]): SpecAttribute => ({
  key: "range",
  label: "Range",
  unit: "km",
  semantic: "range.max",
  discoveredBy: "ai",
  claims,
});

const drone = (specs: SpecAttribute[]): Drone => ({
  id: "lancet-3",
  name: "Lancet-3",
  aliases: [],
  domain: "Air",
  origin: "RU",
  operators: [],
  propulsion: "Unknown",
  summary: "",
  specs,
  rf: [],
  components: [],
  evolution: [],
  counterpartIds: [],
  createdAt: "",
  updatedAt: "",
});

function repo(initial: Drone[]) {
  const ds = [...initial];
  let writes = 0;
  const drones = {
    list: () => ds,
    get: (id: string) => ds.find((d) => d.id === id),
    upsert: (d: Drone) => {
      writes++;
      const i = ds.findIndex((x) => x.id === d.id);
      if (i >= 0) ds[i] = d;
      else ds.push(d);
    },
    remove: () => {},
    search: () => ds,
  } as DroneRepository;
  return { drones, all: () => ds, writes: () => writes };
}

const rejected = { verdict: "rejected" as const, by: "analyst" as const, at: AT };

describe("an analyst's verdict on a claim", () => {
  it("takes a rejected figure out of consensus without removing it", () => {
    const s = range([claim(40, "Militarnyi"), claim(40, "TWZ"), claim(4, "Rybar")]);
    expect(consensus(s).disputed).toBe(true);
    const reviewed = range([
      claim(40, "Militarnyi"),
      claim(40, "TWZ"),
      claim(4, "Rybar", { review: { ...rejected, issue: "unit" } }),
    ]);
    expect(consensus(reviewed)).toMatchObject({ display: "40 km", disputed: false, sources: 2 });
    expect(reviewed.claims).toHaveLength(3);
  });

  it("outranks the contradiction check in both directions", () => {
    const outlier = { verdict: "outlier" as const, confidence: 0.9, at: AT };
    const supported = { verdict: "supported" as const, confidence: 0.9, at: AT };
    expect(claimCounts(claim(1, "a", { adjudication: outlier }))).toBe(false);
    expect(
      claimCounts(
        claim(1, "a", {
          adjudication: outlier,
          review: { verdict: "confirmed", by: "analyst", at: AT },
        }),
      ),
    ).toBe(true);
    expect(
      claimCounts(
        claim(1, "a", { adjudication: supported, review: { ...rejected, issue: "value" } }),
      ),
    ).toBe(false);
  });
});

describe("reviewSpecClaim", () => {
  it("records the verdict and adds the corrected value as a confirmed analyst claim", () => {
    const wrong = claim(4, "Rybar", { sourceId: "rybar|1" });
    const { drones, all } = repo([drone([range([claim(40, "Militarnyi"), wrong])])]);
    const out = reviewSpecClaim(
      "lancet-3",
      "range",
      wrong,
      { verdict: "rejected", issue: "unit", correctValue: "40 km" },
      { drones },
      AT,
    );
    expect(out).toBeDefined();
    const claims = all()[0]!.specs[0]!.claims;
    expect(claims[1]!.review).toEqual({
      verdict: "rejected",
      issue: "unit",
      at: AT,
      by: "analyst",
    });
    expect(claims[2]).toMatchObject({
      source: ANALYST_SOURCE,
      value: 40,
      raw: "40 km",
      normalized: { canonicalValue: 40, canonicalUnit: "km" },
      review: { verdict: "confirmed", by: "analyst" },
    });
    expect(consensus(all()[0]!.specs[0]!)).toMatchObject({ display: "40 km", disputed: false });
  });

  it("clears an earlier verdict on undo", () => {
    const wrong = claim(4, "Rybar", { review: { ...rejected, issue: "value" } });
    const { drones, all } = repo([drone([range([wrong])])]);
    reviewSpecClaim("lancet-3", "range", wrong, null, { drones }, AT);
    expect(all()[0]!.specs[0]!.claims[0]!.review).toBeUndefined();
  });

  it("finds the claim by identity, not by the page's possibly stale copy of the entry", () => {
    const target = claim(4, "Rybar");
    // The stored entry gained a claim ahead of the one the page shows, shifting every index.
    const { drones, all } = repo([
      drone([range([claim(41, "TWZ"), claim(40, "Militarnyi"), target])]),
    ]);
    reviewSpecClaim(
      "lancet-3",
      "range",
      { ...target },
      { verdict: "rejected", issue: "value" },
      { drones },
      AT,
    );
    expect(all()[0]!.specs[0]!.claims.map((c) => c.review?.verdict)).toEqual([
      undefined,
      undefined,
      "rejected",
    ]);
  });

  it("writes nothing when the claim is no longer on the entry", () => {
    const { drones, writes } = repo([drone([range([claim(40, "Militarnyi")])])]);
    const gone = claim(4, "Rybar");
    expect(
      reviewSpecClaim("lancet-3", "range", gone, { verdict: "confirmed" }, { drones }, AT),
    ).toBeUndefined();
    expect(
      reviewSpecClaim("nope", "range", gone, { verdict: "confirmed" }, { drones }, AT),
    ).toBeUndefined();
    expect(writes()).toBe(0);
  });
});

describe("moving a claim to the attribute it describes", () => {
  const altitude = (claims: SpecClaim[]): SpecAttribute => ({
    key: "altitude",
    label: "Maximum altitude",
    unit: "km",
    semantic: "altitude.max",
    discoveredBy: "ai",
    claims,
  });
  const speed = (claims: SpecClaim[]): SpecAttribute => ({
    key: "speed",
    label: "Cruise speed",
    unit: "km/h",
    semantic: "speed.cruise",
    discoveredBy: "ai",
    claims,
  });

  it("keeps the claim where the post put it and files the figure under the other attribute", () => {
    const wrong = claim(600, "sUAS News", {
      raw: "altitude and 600 kilometers",
      sourceId: "suas|1",
    });
    const { drones, all } = repo([drone([altitude([wrong]), speed([claim(500, "Defense News")])])]);
    const out = moveSpecClaim("lancet-3", "altitude", wrong, "speed", "600 km/h", { drones }, AT);
    expect(out).toBeDefined();
    const [alt, spd] = all()[0]!.specs;
    // The claim stays on the record where the post put it, but stops counting there.
    expect(alt!.claims).toHaveLength(1);
    expect(alt!.claims[0]!.review).toEqual({
      verdict: "rejected",
      issue: "attribute",
      movedTo: "speed",
      moveId: expect.any(String),
      at: AT,
      by: "analyst",
    });
    expect(consensus(alt!)).toMatchObject({ display: "—", sources: 0 });
    // And the figure is filed where it belongs, as the analyst read it.
    expect(spd!.claims).toHaveLength(2);
    expect(spd!.claims[1]).toMatchObject({
      source: "sUAS News",
      value: 600,
      raw: "600 km/h",
      normalized: { canonicalValue: 600, canonicalUnit: "km/h" },
      extractionEngine: "analyst",
      review: { verdict: "confirmed", by: "analyst" },
    });
    expect(consensus(spd!)).toMatchObject({ sources: 2 });
  });

  it("undoes an attribute move after a re-analysis recreates the source claim", () => {
    const wrong = claim(600, "sUAS News", {
      id: "claim-1",
      raw: "altitude and 600 kilometers",
    });
    const first = repo([drone([altitude([wrong]), speed([])])]);
    moveSpecClaim("lancet-3", "altitude", wrong, "speed", "600 km/h", { drones: first.drones }, AT);
    const after = first.all()[0]!;
    const review = after.specs[0]!.claims[0]!.review!;
    const moved = after.specs[1]!.claims[0]!;

    const reanalysedClaim = claim(600, "sUAS News", {
      id: "claim-2",
      raw: "altitude and 600 kilometers",
      review,
    });
    const later = repo([drone([altitude([reanalysedClaim]), speed([moved])])]);
    reviewSpecClaim("lancet-3", "altitude", reanalysedClaim, null, { drones: later.drones }, AT);
    expect(later.all()[0]!.specs[0]!.claims[0]!.review).toBeUndefined();
    expect(later.all()[0]!.specs[1]!.claims).toHaveLength(0);
  });

  it("keeps the claim's own number when the analyst gives no reading", () => {
    const wrong = claim(600, "sUAS News", { raw: "altitude and 600 kilometers" });
    const { drones, all } = repo([drone([altitude([wrong]), speed([])])]);
    moveSpecClaim("lancet-3", "altitude", wrong, "speed", "", { drones }, AT);
    const spd = all()[0]!.specs[1]!;
    expect(spd.claims[0]).toMatchObject({ value: 600, source: "sUAS News" });
    // No reading of its own: the target attribute's unit applies.
    expect(spd.claims[0]!.normalized).toBeUndefined();
    expect(consensus(spd)).toMatchObject({ display: "600 km/h", sources: 1 });
  });

  it("writes nothing when the claim is not on the entry or the target is the same attribute", () => {
    const wrong = claim(600, "sUAS News");
    const { drones, writes } = repo([drone([altitude([wrong]), speed([])])]);
    expect(
      moveSpecClaim("lancet-3", "altitude", claim(1, "Other"), "speed", "", { drones }, AT),
    ).toBeUndefined();
    expect(
      moveSpecClaim("lancet-3", "altitude", wrong, "altitude", "", { drones }, AT),
    ).toBeUndefined();
    expect(writes()).toBe(0);
  });

  it("undoing the verdict undoes the move with it", () => {
    const wrong = claim(600, "sUAS News", { raw: "altitude and 600 kilometers" });
    const { drones, all } = repo([drone([altitude([wrong]), speed([])])]);
    moveSpecClaim("lancet-3", "altitude", wrong, "speed", "600 km/h", { drones }, AT);
    expect(all()[0]!.specs[1]!.claims).toHaveLength(1);

    reviewSpecClaim("lancet-3", "altitude", wrong, null, { drones }, AT);
    const [alt, spd] = all()[0]!.specs;
    // The claim counts again where the post put it...
    expect(alt!.claims[0]!.review).toBeUndefined();
    expect(consensus(alt!)).toMatchObject({ display: "600 km", sources: 1 });
    // ...and the copy filed under the other attribute is gone.
    expect(spd!.claims).toHaveLength(0);
  });
});

describe("the contradiction check after an analyst rejected a claim", () => {
  it("does not offer the rejected claim to the model and leaves its record alone", async () => {
    const { drones, all } = repo([
      drone([
        range([
          claim(40, "Militarnyi"),
          claim(300, "X", { review: { ...rejected, issue: "value" } }),
          claim(40, "TWZ"),
          claim(90, "Rybar"),
        ]),
      ]),
    ]);
    let offered: string[] = [];
    // Index 1 of what it was shown is TWZ; in the stored list TWZ sits at index 2.
    const adjudicate: ContradictionAdjudicator = async (q) => {
      offered = q.claims.map((c) => c.source);
      return { supported: 1, confidence: 0.9 };
    };
    await adjudicateContradictions(drones, { adjudicate, now: Date.parse(AT) });
    expect(offered).toEqual(["Militarnyi", "TWZ", "Rybar"]);
    const claims = all()[0]!.specs[0]!.claims;
    expect(claims.map((c) => c.adjudication?.verdict)).toEqual([
      "outlier",
      undefined,
      "supported",
      "outlier",
    ]);
    expect(claims[1]!.review?.verdict).toBe("rejected");
  });
});

describe("claimKey identity", () => {
  it("uses the stable id when present", () => {
    const c = claim(40, "Militarnyi", { id: "uuid-1" });
    expect(claimKey(c)).toBe("uuid-1");
  });

  it("falls back to a composite key that includes evidence for legacy claims", () => {
    const a = claim(40, "Rybar", { evidence: "range 40 km per source A" });
    const b = claim(40, "Rybar", { evidence: "range 40 km per source B" });
    // Same source, same value, same date — but different evidence must produce different keys.
    expect(claimKey(a)).not.toBe(claimKey(b));
  });

  it("does not collide when two legacy claims share source/value/date but differ in raw", () => {
    const a: SpecClaim = {
      value: 40,
      source: "Rybar",
      date: "2026-10-01T00:00:00.000Z",
      raw: "40 km max range",
    };
    const b: SpecClaim = {
      value: 40,
      source: "Rybar",
      date: "2026-10-01T00:00:00.000Z",
      raw: "40 km combat radius",
    };
    expect(claimKey(a)).not.toBe(claimKey(b));
  });

  it("two id-bearing claims never collide even with identical evidence", () => {
    const a = claim(40, "Rybar", { id: "uuid-a", evidence: "same text" });
    const b = claim(40, "Rybar", { id: "uuid-b", evidence: "same text" });
    expect(claimKey(a)).not.toBe(claimKey(b));
  });
});

describe("restoring a verdict after a re-analysis", () => {
  const reviewed = { verdict: "rejected" as const, by: "analyst" as const, at: AT };

  it("puts the verdict back on the same claim, not on another with the same number", () => {
    const original = drone([
      range([
        claim(40, "Militarnyi", { sourceId: "m|1", evidence: "range 40 km", review: reviewed }),
        claim(40, "Rybar", { sourceId: "r|1", evidence: "range 40 km" }),
      ]),
    ]);
    const held = heldReviews(original, () => true);
    expect(held).toHaveLength(1);

    // A re-analysis re-creates the claim objects: the ids move, the content does not.
    const reanalysed = drone([
      range([
        claim(40, "Militarnyi", { sourceId: "m|1", evidence: "range 40 km", id: "new-1" }),
        claim(40, "Rybar", { sourceId: "r|1", evidence: "range 40 km", id: "new-2" }),
      ]),
    ]);
    const restored = restoreReviews(reanalysed, held, () => true);
    const claims = restored.specs[0]!.claims;
    expect(claims[0]!.review?.verdict).toBe("rejected");
    // The other outlet's claim, which happens to carry the same number, is untouched.
    expect(claims[1]!.review).toBeUndefined();
  });
});
