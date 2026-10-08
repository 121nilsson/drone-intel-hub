import { describe, expect, it } from "vitest";
import { SEED_DRONES } from "@/entities/drone/seed";
import type { Extraction } from "@/entities/drone/types";
import { normalizeExtraction } from "@/entities/normalization/apply";
import { effectiveIeeeBands, effectiveNatoBands } from "@/entities/normalization/rf";

const extraction = (over: Partial<Extraction> = {}): Extraction => ({
  aliases: [],
  operators: [],
  specs: [],
  rfBands: [],
  confidence: 0.8,
  rationale: "",
  ...over,
});

describe("normalizeExtraction", () => {
  it("is idempotent", () => {
    const once = normalizeExtraction(
      extraction({
        propulsion: "Piston (MD-550)",
        rfBands: ["5.8 GHz analog video", "CRPA", "fiber-optic controlled"],
        specs: [
          { key: "range", label: "Range", value: "80 miles" },
          { key: "unit_cost", label: "Unit cost", value: "€25k" },
          { key: "jammers", label: "Onboard jammers", value: 2 },
        ],
      }),
    );
    expect(normalizeExtraction(once.extraction)).toEqual(once);
  });

  it("keeps raw text and classifies roles without inventing frequencies", () => {
    const { extraction: e, unknowns } = normalizeExtraction(
      extraction({
        propulsion: "pulsejet",
        rfBands: ["5.8 GHz analog video", "ExpressLRS", "fiber-optic controlled"],
        specs: [{ key: "range", label: "Range", value: "80 miles" }],
      }),
    );
    expect(e.specs[0]?.raw).toBe("80 miles");
    expect(e.specs[0]?.value).toBe("80 miles");
    expect(e.specs[0]?.normalized?.canonicalUnit).toBe("km");
    expect(e.specs[0]?.normalized?.canonicalValue).toBeCloseTo(128.74752, 4);
    expect(e.specs[0]?.semantic).toBe("range.max");
    expect(e.rf?.map((r) => r.role)).toEqual(["video", "unknown", "tether"]);
    expect(e.rf?.[1]?.freqMHz).toBeUndefined();
    expect(e.rf?.[2]?.freqMHz).toBeUndefined();
    expect(unknowns).toEqual([{ taxonomy: "propulsion", rawTerm: "pulsejet" }]);
  });

  it("classifies propulsion and installation from their own fields", () => {
    expect(normalizeExtraction(extraction({ propulsion: "Piston (MD-550)" })).extraction.propulsionId).toBe("piston");
    const tracked = normalizeExtraction(extraction({ propulsion: "Electric", installation: "Tracked" })).extraction;
    expect(tracked.propulsionId).toBe("electric");
    expect(tracked.installationId).toBe("tracked");
    expect(normalizeExtraction(extraction({ propulsion: "Electric tracked" })).extraction.installationId).toBeUndefined();
    expect(normalizeExtraction(extraction({ propulsion: "Waterjet" })).extraction.propulsionId).toBe("waterjet");
    expect(normalizeExtraction(extraction({ propulsion: "Outboard" })).extraction.propulsionId).toBe("outboard");
  });

  it("recomputes the Lancet video link from its frequencies", () => {
    const lancet = SEED_DRONES.find((d) => d.id === "lancet-3");
    const video = lancet?.rf.find((r) => r.band === "L");
    expect(video?.freqMHz).toEqual([868, 915]);
    expect(video && effectiveIeeeBands(video)).toEqual(["UHF"]);
    expect(video && effectiveNatoBands(video)).toEqual(["C"]);
    expect(video?.band).toBe("L");
  });
});
