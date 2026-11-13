import { describe, expect, it } from "vitest";
import type { AuditCandidate } from "@/entities/drone/audit";
import {
  FORMAL_SAMPLE_SIZE,
  drawFormalSample,
  finalAnswers,
  formalGate,
  formalStratum,
  type FormalDesign,
  type Presentation,
  type UnitOutcome,
} from "@/entities/drone/audit-design";
import { canonicalJsonStringify, claimFingerprintInput } from "@/entities/drone/claim-fingerprint";

const candidates = (counts: Record<"en" | "uk" | "ru" | "other", number>): AuditCandidate[] =>
  (Object.entries(counts) as ["en" | "uk" | "ru" | "other", number][]).flatMap(([language, n]) =>
    Array.from({ length: n }, (_, i) => ({
      claimId: `${language}-${i}`,
      language,
      family: "range",
    })),
  );

describe("the formal sample", () => {
  const pool = candidates({ en: 1200, uk: 300, ru: 200, other: 100 });

  it("draws 200 units, proportional by stratum, with one inclusion probability per stratum", () => {
    const { design, units } = drawFormalSample(pool, 7);
    expect(units).toHaveLength(FORMAL_SAMPLE_SIZE);
    expect(new Set(units.map((u) => u.claimId)).size).toBe(FORMAL_SAMPLE_SIZE);
    expect(design.populations).toEqual({ en: 1200, cyrillic: 500, other: 100 });
    expect(Object.values(design.allocation).reduce((s, n) => s + n, 0)).toBe(200);
    for (const [stratum, n] of Object.entries(design.allocation)) {
      const pi = design.allocation[stratum]! / design.populations[stratum]!;
      const mine = units.filter((u) => u.stratum === stratum);
      expect(mine).toHaveLength(n);
      for (const u of mine) expect(u.inclusionProbability).toBeCloseTo(pi, 12);
    }
  });

  it("puts Ukrainian and Russian in one stratum and keeps every sampled claim in its own", () => {
    const { units } = drawFormalSample(pool, 7);
    for (const u of units) {
      const language = u.claimId.split("-")[0] as "en" | "uk" | "ru" | "other";
      expect(u.stratum).toBe(formalStratum(language));
    }
    expect(units.some((u) => u.claimId.startsWith("uk-"))).toBe(true);
    expect(units.every((u) => u.stratum !== "uk" && u.stratum !== "ru")).toBe(true);
  });

  it("repeats from its seed and differs for another", () => {
    const a = drawFormalSample(pool, 7).units.map((u) => u.claimId);
    const b = drawFormalSample(pool, 7).units.map((u) => u.claimId);
    const c = drawFormalSample(pool, 8).units.map((u) => u.claimId);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("inspects every claim when the population is smaller than the sample", () => {
    const { design, units } = drawFormalSample(candidates({ en: 90, uk: 20, ru: 0, other: 5 }), 3);
    expect(units).toHaveLength(115);
    expect(units.every((u) => u.inclusionProbability === 1)).toBe(true);
    expect(design.allocation).toEqual(design.populations);
  });
});

const presentation = (
  unit: string,
  order: number,
  answer: Presentation["answer"],
  voided = false,
): Presentation => ({ sampleUnitId: unit, stratum: "en", answer, voided, order });

describe("one answer per sample unit", () => {
  it("counts a unit asked again once, with its latest valid answer", () => {
    const finals = finalAnswers([
      presentation("u1", 0, "yes", true),
      presentation("u1", 5, "no"),
      presentation("u2", 1, "yes"),
    ]);
    expect(finals.size).toBe(2);
    expect(finals.get("u1")?.outcome).toBe("no");
    expect(finals.get("u2")?.outcome).toBe("yes");
  });

  it("leaves a unit whose every answer was voided unanswered, so it has to be asked again", () => {
    const finals = finalAnswers([presentation("u1", 0, "yes", true)]);
    expect(finals.get("u1")?.outcome).toBeNull();
  });

  it("never counts the same unit twice however many presentations it has", () => {
    const finals = finalAnswers([
      presentation("u1", 0, null),
      presentation("u1", 1, "yes", true),
      presentation("u1", 2, "yes"),
      presentation("u1", 3, "no", true),
    ]);
    expect(finals.size).toBe(1);
    expect(finals.get("u1")?.outcome).toBe("yes");
  });
});

describe("the single analysis", () => {
  const design: FormalDesign = {
    populations: { en: 1000, cyrillic: 400, other: 100 },
    allocation: { en: 133, cyrillic: 53, other: 14 },
    size: 200,
    seed: 1,
  };
  const finals = (errors: { en?: number; cyrillic?: number; other?: number }, cannot = 0) => {
    const map = new Map<string, { stratum: string; outcome: UnitOutcome | null }>();
    let k = 0;
    for (const [stratum, n] of Object.entries(design.allocation)) {
      const wrong = (errors as Record<string, number>)[stratum] ?? 0;
      for (let i = 0; i < n; i++) {
        const ct = stratum === "en" && i < cannot;
        map.set(`u${k++}`, {
          stratum,
          outcome: ct
            ? "cannot_tell"
            : i < wrong + cannot && stratum === "en"
              ? "no"
              : i < wrong
                ? "no"
                : "yes",
        });
      }
    }
    return map;
  };

  it("stays open until every unit has a valid answer", () => {
    const partial = finals({});
    partial.set("u0", { stratum: "en", outcome: null });
    const gate = formalGate(design, partial);
    expect(gate.decision).toBe("continue");
    expect(gate.valid).toBe(199);
    expect(gate.upper).toBeUndefined();
  });

  it("passes with no errors: the upper bound is within the budget", () => {
    const gate = formalGate(design, finals({}));
    expect(gate.decision).toBe("pass");
    expect(gate.upper).toBeGreaterThan(0.01);
    expect(gate.upper).toBeLessThanOrEqual(0.05);
    expect(gate.errors).toBe(0);
  });

  it("is not proven when the bound is above the budget, even if the observed share is below it", () => {
    const gate = formalGate(design, finals({ en: 6, cyrillic: 2, other: 1 }));
    expect(gate.pointEstimate).toBeLessThan(0.05);
    expect(gate.upper).toBeGreaterThan(0.05);
    expect(gate.decision).toBe("not_proven");
  });

  it("counts 'cannot tell' as an error and shows the best case beside it", () => {
    const gate = formalGate(design, finals({}, 8));
    expect(gate.cannotTell).toBe(8);
    expect(gate.errors).toBe(8);
    expect(gate.upper!).toBeGreaterThan(gate.bestCaseUpper!);
    expect(gate.decision).toBe("not_proven");
  });

  it("settles a census by the population's own error share, with no confidence bound", () => {
    const small: FormalDesign = {
      populations: { en: 30, other: 10 },
      allocation: { en: 30, other: 10 },
      size: 200,
      seed: 1,
    };
    const answers = (wrong: number) => {
      const map = new Map<string, { stratum: string; outcome: UnitOutcome | null }>();
      for (let i = 0; i < 40; i++)
        map.set(`c${i}`, { stratum: i < 30 ? "en" : "other", outcome: i < wrong ? "no" : "yes" });
      return map;
    };
    expect(formalGate(small, answers(2))).toMatchObject({ census: true, decision: "pass" });
    expect(formalGate(small, answers(3))).toMatchObject({ census: true, decision: "fail" });
  });
});

describe("the claim fingerprint", () => {
  it("is canonical JSON: key order never matters and absent members are dropped", () => {
    expect(canonicalJsonStringify({ b: 1, a: [2, { d: 4, c: 3 }], e: undefined })).toBe(
      '{"a":[2,{"c":3,"d":4}],"b":1}',
    );
    expect(canonicalJsonStringify({ x: null })).toBe('{"x":null}');
  });

  it("serialises numbers the way JCS does and refuses what has no canonical form", () => {
    expect(canonicalJsonStringify([1e21, 0.1, -0, 100])).toBe("[1e+21,0.1,0,100]");
    expect(() => canonicalJsonStringify({ n: Number.NaN })).toThrow();
  });

  it("changes with the claim's figures or unit, and not with how the identity was assembled", () => {
    const base = {
      fingerprintVersion: 1 as const,
      claimId: "c1",
      droneId: "d1",
      semantic: "range.max",
      rawValue: 105,
      rawUnit: "lb",
      rawUnitBasis: "quote",
      quantityQualifier: "exact",
      evidenceHash: "e",
      sourceTextHash: "s",
    };
    // The same identity written with its members in another order.
    const same = {
      sourceTextHash: base.sourceTextHash,
      fingerprintVersion: base.fingerprintVersion,
      evidenceHash: base.evidenceHash,
      quantityQualifier: base.quantityQualifier,
      rawUnitBasis: base.rawUnitBasis,
      rawUnit: base.rawUnit,
      rawValue: base.rawValue,
      semantic: base.semantic,
      droneId: base.droneId,
      claimId: base.claimId,
    };
    expect(claimFingerprintInput(same)).toBe(claimFingerprintInput(base));
    expect(claimFingerprintInput({ ...base, rawUnit: "kg" })).not.toBe(claimFingerprintInput(base));
    expect(claimFingerprintInput({ ...base, rawValue: 106 })).not.toBe(claimFingerprintInput(base));
    expect(claimFingerprintInput({ ...base, rawUnit: null })).not.toBe(claimFingerprintInput(base));
  });
});
