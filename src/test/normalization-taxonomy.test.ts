import { describe, expect, it } from "vitest";
import { resolveTerm, type TaxonomyTerm } from "@/entities/normalization/taxonomy";

const terms: TaxonomyTerm[] = [
  {
    taxonomy: "protocol",
    canonicalId: "expresslrs",
    label: "ExpressLRS",
    aliases: ["ELRS", "Express LRS"],
    status: "active",
    origin: "seed",
  },
  {
    taxonomy: "propulsion",
    canonicalId: "piston",
    label: "Piston",
    aliases: ["MD-550"],
    status: "active",
    origin: "seed",
  },
  {
    taxonomy: "propulsion",
    canonicalId: "turbojet",
    label: "Turbojet",
    aliases: ["jet"],
    status: "active",
    origin: "seed",
  },
];

describe("resolveTerm", () => {
  it("folds separator differences onto one canonical id", () => {
    expect(resolveTerm("ELRS", "protocol", terms).canonicalId).toBe("expresslrs");
    expect(resolveTerm("Express LRS", "protocol", terms).canonicalId).toBe("expresslrs");
    expect(resolveTerm("ExpressLRS", "protocol", terms).canonicalId).toBe("expresslrs");
  });

  it("refuses to pick a winner when two canonical ids match", () => {
    const hit = resolveTerm("piston jet", "propulsion", terms);
    expect(hit.canonicalId).toBeUndefined();
    expect(hit.ambiguous).toBe(true);
    expect(hit.confidence).toBe(0.5);
  });

  it("does not invent a canonical id for an unknown term", () => {
    const hit = resolveTerm("pulsejet", "propulsion", terms);
    expect(hit.canonicalId).toBeUndefined();
    expect(hit.ambiguous).toBeUndefined();
  });
});
