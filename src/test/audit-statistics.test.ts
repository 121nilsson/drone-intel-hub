import { describe, it, expect } from "vitest";
import {
  allocateProportional,
  errorPointEstimate,
  hypergeometricPmf,
  inclusionProbability,
  stratifiedUpperBound,
  type StratumSample,
} from "@/entities/drone/audit-statistics";

const ALPHA = 0.05;

function one(population: number, sampled: number, errors: number): StratumSample[] {
  return [{ name: "all", population, sampled, errors }];
}

function fourStrata(population: number, sampled: number, errors: number[]): StratumSample[] {
  return ["en", "uk", "ru", "other"].map((name, i) => ({
    name,
    population,
    sampled,
    errors: errors[i] ?? 0,
  }));
}

/** Exact binomial-style count with small arguments, independent of the module's log code. */
function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

function hyp(population: number, successes: number, draws: number, k: number): number {
  return (
    (choose(successes, k) * choose(population - successes, draws - k)) / choose(population, draws)
  );
}

/**
 * Plain definition, no pruning, no binary search: enumerate every allocation and every outcome,
 * then take the largest total that is not rejected.
 */
function bruteWrongMax(
  pops: [number, number],
  samples: [number, number],
  errors: [number, number],
  alpha: number,
): number {
  const w = [pops[0] / samples[0], pops[1] / samples[1]];
  const observed = w[0]! * errors[0] + w[1]! * errors[1];
  const total = pops[0] + pops[1];
  let wrongMax = 0;
  for (let d = 0; d <= total; d++) {
    let pSup = 0;
    for (let D0 = 0; D0 <= pops[0]; D0++) {
      const D1 = d - D0;
      if (D1 < 0 || D1 > pops[1]) continue;
      let p = 0;
      for (let x0 = 0; x0 <= samples[0]; x0++) {
        for (let x1 = 0; x1 <= samples[1]; x1++) {
          if (w[0]! * x0 + w[1]! * x1 <= observed + 1e-9) {
            p += hyp(pops[0], D0, samples[0], x0) * hyp(pops[1], D1, samples[1], x1);
          }
        }
      }
      pSup = Math.max(pSup, p);
    }
    if (pSup > alpha) wrongMax = d;
  }
  return wrongMax;
}

describe("hypergeometricPmf", () => {
  it("sums to 1 over k", () => {
    let sum = 0;
    for (let k = 0; k <= 4; k++) sum += hypergeometricPmf(50, 12, 9, k);
    // k runs over the whole support (at most 9 draws, at most 12 successes).
    for (let k = 5; k <= 9; k++) sum += hypergeometricPmf(50, 12, 9, k);
    expect(sum).toBeCloseTo(1, 12);
  });

  it("matches a hand value: C(3,1) * C(7,3) / C(10,4) = 0.5", () => {
    expect(hypergeometricPmf(10, 3, 4, 1)).toBeCloseTo(0.5, 12);
  });

  it("is zero outside the support", () => {
    // Four draws from 10 with 8 successes must contain at least two successes.
    expect(hypergeometricPmf(10, 8, 4, 1)).toBe(0);
  });
});

describe("allocateProportional", () => {
  it("drops an empty stratum, keeps every other stratum at one draw or more, and sums to size", () => {
    const result = allocateProportional({ en: 1000, uk: 0, ru: 3 }, 50);
    expect(result).not.toHaveProperty("uk");
    expect(result["ru"]).toBeGreaterThanOrEqual(1);
    expect(result["en"]).toBeGreaterThanOrEqual(1);
    expect((result["en"] ?? 0) + (result["ru"] ?? 0)).toBe(50);
  });

  it("gives a tiny stratum one draw and redistributes the rest", () => {
    const result = allocateProportional({ big: 9999, tiny: 1 }, 10);
    expect(result["tiny"]).toBe(1);
    expect(result["big"]).toBe(9);
  });

  it("inspects every claim when the population fits in the sample size", () => {
    expect(allocateProportional({ en: 4, uk: 2 }, 10)).toEqual({ en: 4, uk: 2 });
  });

  it("splits unequal strata with sum equal to size and n_h <= N_h", () => {
    const populations = { en: 900, uk: 60, ru: 30, other: 10 };
    const result = allocateProportional(populations, 100);
    const sum = Object.values(result).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
    for (const [name, n] of Object.entries(result)) {
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(populations[name as keyof typeof populations]);
    }
    expect(result).toEqual({ en: 90, uk: 6, ru: 3, other: 1 });
  });
});

describe("inclusionProbability and errorPointEstimate", () => {
  it("inclusion probability is sampled over population", () => {
    expect(inclusionProbability(400, 100)).toBe(0.25);
    expect(() => inclusionProbability(0, 0)).toThrow();
  });

  it("weights each stratum's error rate by its share of claims", () => {
    const estimate = errorPointEstimate([
      { name: "en", population: 900, sampled: 90, errors: 9 },
      { name: "uk", population: 100, sampled: 10, errors: 0 },
    ]);
    expect(estimate).toBeCloseTo(0.9 * 0.1, 12);
  });
});

describe("stratifiedUpperBound", () => {
  it("one stratum, zero errors in 200 of 1000: rejects 14 and keeps 13", () => {
    expect(hypergeometricPmf(1000, 13, 200, 0)).toBeCloseTo(0.0539, 3);
    expect(hypergeometricPmf(1000, 14, 200, 0)).toBeCloseTo(0.043, 3);
    const result = stratifiedUpperBound(one(1000, 200, 0));
    expect(result).toMatchObject({ kind: "bound", wrongMax: 13 });
    if (result.kind !== "bound") throw new Error("expected a bound");
    expect(result.upper).toBeCloseTo(0.013, 12);
  });

  it("the same sample split into four strata of 250 with 50 each stays in the same range", () => {
    const result = stratifiedUpperBound(fourStrata(250, 50, [0, 0, 0, 0]));
    expect(result.kind).toBe("bound");
    if (result.kind !== "bound") throw new Error("expected a bound");
    expect(result.upper).toBeGreaterThanOrEqual(0.013);
    expect(result.upper).toBeLessThanOrEqual(0.02);
  });

  it("a million claims, zero errors in 200: close to 1 - 0.05^(1/200)", () => {
    const result = stratifiedUpperBound(one(1_000_000, 200, 0));
    if (result.kind !== "bound") throw new Error("expected a bound");
    expect(Math.abs(result.upper - (1 - Math.pow(ALPHA, 1 / 200)))).toBeLessThan(0.0005);
  });

  it("the bound rises with each observed error and stays under 5 % at four errors", () => {
    const uppers = [0, 1, 2, 3, 4].map((x) => {
      const result = stratifiedUpperBound(one(1000, 200, x));
      if (result.kind !== "bound") throw new Error("expected a bound");
      return result.upper;
    });
    for (let i = 1; i < uppers.length; i++) {
      expect(uppers[i]!).toBeGreaterThan(uppers[i - 1]!);
    }
    expect(uppers[4]!).toBeLessThan(0.05);
  });

  it("returns census when every stratum was fully inspected", () => {
    const strata: StratumSample[] = [
      { name: "en", population: 40, sampled: 40, errors: 4 },
      { name: "uk", population: 10, sampled: 10, errors: 1 },
    ];
    expect(stratifiedUpperBound(strata)).toEqual({
      kind: "census",
      upper: errorPointEstimate(strata),
    });
    expect(errorPointEstimate(strata)).toBeCloseTo(5 / 50, 12);
  });

  it("is incomplete when the allocation cap is too small", () => {
    const result = stratifiedUpperBound(fourStrata(250, 50, [1, 0, 0, 0]), { cap: 10 });
    expect(result.kind).toBe("incomplete");
  });

  it("agrees with a brute-force enumeration on small two-strata designs, every outcome", () => {
    const designs: [[number, number], [number, number]][] = [
      [
        [12, 7],
        [5, 3],
      ],
      [
        [10, 12],
        [4, 5],
      ],
      [
        [8, 6],
        [3, 2],
      ],
      [
        [12, 12],
        [1, 5],
      ],
    ];
    for (const [pops, samples] of designs) {
      for (let e0 = 0; e0 <= samples[0]; e0++) {
        for (let e1 = 0; e1 <= samples[1]; e1++) {
          const strata: StratumSample[] = [
            { name: "a", population: pops[0], sampled: samples[0], errors: e0 },
            { name: "b", population: pops[1], sampled: samples[1], errors: e1 },
          ];
          const result = stratifiedUpperBound(strata);
          expect(result.kind).toBe("bound");
          if (result.kind !== "bound") throw new Error("expected a bound");
          expect(result.wrongMax).toBe(bruteWrongMax(pops, samples, [e0, e1], ALPHA));
        }
      }
    }
  });

  it("handles a realistic audit: 3000 claims in four strata, 200 sampled, zero errors, under 5 s", () => {
    const start = performance.now();
    const result = stratifiedUpperBound(fourStrata(750, 50, [0, 0, 0, 0]));
    const elapsed = performance.now() - start;
    expect(result.kind).toBe("bound");
    expect(elapsed).toBeLessThan(5000);
  });
});

describe("realistic catalogue sizes", () => {
  it("settles three strata with errors at 14 500 claims within the allocation limit", () => {
    const t = performance.now();
    const r = stratifiedUpperBound([
      { name: "en", population: 8700, sampled: 120, errors: 2 },
      { name: "cyrillic", population: 5000, sampled: 69, errors: 1 },
      { name: "other", population: 800, sampled: 11, errors: 1 },
    ]);
    expect(r.kind).toBe("bound");
    // Four errors in 200 stay under the 5 % budget, as the plan expects.
    if (r.kind === "bound") expect(r.upper).toBeLessThan(0.05);
    expect(performance.now() - t).toBeLessThan(15_000);
  }, 30_000);

  it("never passes a catalogue too large to compute: it says incomplete", () => {
    const r = stratifiedUpperBound(
      [
        { name: "en", population: 60_000, sampled: 120, errors: 2 },
        { name: "cyrillic", population: 30_000, sampled: 60, errors: 1 },
        { name: "other", population: 10_000, sampled: 20, errors: 1 },
      ],
      { cap: 200_000 },
    );
    expect(r.kind).toBe("incomplete");
  });
});
