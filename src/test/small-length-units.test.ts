import { describe, expect, it } from "vitest";
import { convert, normalizeQuantityLoose } from "@/entities/normalization/units";
import { canonicalUnitForSemantic } from "@/entities/normalization/semantic";
import { verifyClaim } from "@/entities/drone/verification";
import { repairDrone } from "@/entities/drone/repair";
import type { Drone, SpecAttribute, SpecClaim } from "@/entities/drone/types";

const read = (s: string) => {
  const q = normalizeQuantityLoose(s);
  return q ? { value: q.value, unit: q.unit } : undefined;
};

describe("millimetres, centimetres and inches", () => {
  it("reads every spelling a calibre is written in", () => {
    expect(read("240 mm")).toEqual({ value: 240, unit: "mm" });
    expect(read("240mm")).toEqual({ value: 240, unit: "mm" });
    expect(read("155-mm")).toEqual({ value: 155, unit: "mm" });
    expect(read("7,62 мм")).toEqual({ value: 7.62, unit: "mm" });
    expect(read("35 cm")).toEqual({ value: 35, unit: "cm" });
    expect(read("2.75‑inch")).toEqual({ value: 2.75, unit: "in" });
    expect(read("12″")).toEqual({ value: 12, unit: "in" });
  });

  it("does not take the word 'in' for inches", () => {
    expect(read("10 in")).toBeUndefined();
  });

  it("converts between them", () => {
    expect(convert(2.75, "in", "mm")).toBe(69.85);
    expect(convert(0.24, "m", "mm")).toBe(240);
  });

  it("shows a calibre in millimetres", () => {
    expect(canonicalUnitForSemantic("dimension.caliber")).toBe("mm");
    expect(canonicalUnitForSemantic("dimension.length")).toBe("m");
  });
});

describe("a bare calibre figure", () => {
  const claim: SpecClaim = {
    id: "c",
    value: "240",
    raw: "240",
    source: "The War Zone",
    date: "2026-10-31T00:00:00.000Z",
    evidence: "Russia’s 2S4 Tyulpan, a 240mm self-propelled mortar",
  };
  const spec: SpecAttribute = {
    key: "calibre",
    label: "Calibre",
    unit: "mm",
    semantic: "dimension.caliber",
    canonicalUnit: "m",
    discoveredBy: "ai",
    claims: [claim],
  };
  const drone = { id: "t", name: "2S4 Tyulpan", aliases: [], specs: [spec] } as unknown as Drone;

  it("is measured in its attribute's unit", () => {
    const v = verifyClaim({ drone, spec, claim })!;
    expect(v.checks.find((c) => c.kind === "unit_dimension")).toMatchObject({ verdict: "pass" });
  });

  it("has its stored canonical unit moved from metres to millimetres by the repair", () => {
    const { drone: out } = repairDrone({ ...drone, operators: [] } as Drone);
    expect(out.specs[0]!.canonicalUnit).toBe("mm");
    expect(repairDrone(out).changes).toEqual([]);
  });
});

describe("a count of carried missiles", () => {
  const claim: SpecClaim = {
    id: "m",
    value: 650,
    raw: "650 missiles",
    source: "Defense Express",
    date: "2026-10-31T00:00:00.000Z",
    evidence: "650 missiles",
  };
  const spec: SpecAttribute = {
    key: "missiles",
    label: "Number of missiles",
    unit: "kg",
    semantic: "payload.missile.count",
    canonicalUnit: "kg",
    discoveredBy: "ai",
    claims: [claim],
  };
  const drone = { id: "p", name: "PAC-3", aliases: [], specs: [spec] } as unknown as Drone;

  it("has no unit, though its semantic sits under payload", () => {
    expect(canonicalUnitForSemantic("payload.missile.count")).toBeUndefined();
    expect(canonicalUnitForSemantic("payload.bomb.count")).toBeUndefined();
    expect(canonicalUnitForSemantic("payload.capacity")).toBe("kg");
  });

  it("has the stored kilogram dropped by the repair, so it is not checked as a mass", () => {
    const { drone: out } = repairDrone({ ...drone, operators: [] } as Drone);
    const fixed = out.specs[0]!;
    expect(fixed.canonicalUnit).toBeUndefined();
    expect(fixed.unit).toBeUndefined();
    expect(repairDrone(out).changes).toEqual([]);
    const v = verifyClaim({ drone: out, spec: fixed, claim })!;
    expect(v.checks.find((c) => c.kind === "unit_dimension")).toMatchObject({
      verdict: "uncertain",
      applicable: false,
    });
  });
});
