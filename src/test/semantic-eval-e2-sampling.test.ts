/**
 * E2 step b: population freeze, design B allocation and the stratified draw.
 *
 * Every expected allocation below is written by hand (the first six rows come from the design
 * document's section 3.1 table, the rest are hand computed in the comments). No expectation is
 * computed with `allocateE2` or a helper it uses. The only independent machinery is plain
 * arithmetic and node:crypto.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allocateE2 } from "../entities/normalization/semantic-eval/e2/allocation";
import { drawE2Sample } from "../entities/normalization/semantic-eval/e2/draw";
import {
  e2RowsJsonl,
  freezeE2Population,
} from "../entities/normalization/semantic-eval/e2/population";
import {
  ROUTING_STRATA,
  type RoutingStratum,
} from "../entities/normalization/semantic-eval/e2/types";
import {
  checkE2Allocation,
  checkE2HashChain,
  e2RoutingStratum,
  validateE2Example,
  validateE2PopulationManifest,
  validateE2SampleManifest,
} from "../entities/normalization/semantic-eval/e2/validate";
import type { FrameRow } from "../entities/normalization/semantic-eval/types";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

type Counts = Record<RoutingStratum, number>;
const counts = (en: number, ru: number, uk: number, unknown: number): Counts => ({
  en,
  ru,
  uk,
  unknown,
});
const sizes = (a: ReturnType<typeof allocateE2>) => a.strata.map((s) => s.sampleCount);

// ─── Allocation facit ──────────────────────────────────────────────────────

describe("allocateE2: design document 3.1 table (n = 150, m = 25)", () => {
  // [name, N (en/ru/uk/unknown), expected n_h, expected rounds]
  const table: [string, Counts, number[], number][] = [
    ["one small stratum", counts(1000, 400, 12, 88), [67, 42, 12, 29], 1],
    ["empty stratum", counts(900, 300, 0, 50), [79, 43, 0, 28], 1],
    ["several small strata", counts(500, 20, 8, 3), [119, 20, 8, 3], 1],
    ["caps force redistribution", counts(60, 40, 30, 26), [54, 40, 30, 26], 3],
    ["n >= population", counts(50, 30, 10, 5), [50, 30, 10, 5], 0],
  ];
  for (const [name, N, expected, rounds] of table) {
    it(name, () => {
      const a = allocateE2(N, 150, 25);
      expect(sizes(a)).toEqual(expected);
      expect(a.redistributionRounds).toBe(rounds);
      expect(a.strata.map((s) => s.stratum)).toEqual(["en", "ru", "uk", "unknown"]);
    });
  }

  it("minimum exceeds n (n = 90, 4 x 25 = 100): refused, nothing reduced silently", () => {
    expect(() => allocateE2(counts(100, 100, 100, 100), 90, 25)).toThrow(/refused.*100.*90/);
  });

  it("n >= population: realised n is the population, the request is kept", () => {
    const a = allocateE2(counts(50, 30, 10, 5), 150, 25);
    expect(a.n).toBe(95);
    expect(a.requestedN).toBe(150);
    expect(a.strata.every((s) => s.census)).toBe(true);
  });
});

describe("allocateE2: hand-computed cases of our own", () => {
  it("a cap forces a second round: 200/100/11/10, n = 100, m = 10", () => {
    // minima 10/10/10/10 = 40, r = 60. Round 1 over en, ru, uk (unknown 10 is a census), T = 311:
    // shares 38.58, 19.29, 2.12 -> floors 38, 19, 2, one left; remainders 182, 91, 38 -> en.
    // en 49, ru 29, uk 12 -> capped at 11, excess 1. Round 2 over en, ru (T = 300): floors 0, 0,
    // remainders 200, 100 -> en. en 50, ru 29, uk 11, unknown 10 = 100.
    const a = allocateE2(counts(200, 100, 11, 10), 100, 10);
    expect(sizes(a)).toEqual([50, 29, 11, 10]);
    expect(a.redistributionRounds).toBe(2);
  });

  it("a tie goes to the name that sorts first: en before ru", () => {
    // minima 1 + 1, r = 49 over 100/100: exactly 24.5 each, one unit left, equal remainders -> en.
    const a = allocateE2(counts(100, 100, 0, 0), 51, 1);
    expect(sizes(a)).toEqual([26, 25, 0, 0]);
  });

  it("a tie goes to the name that sorts first: ru before uk", () => {
    expect(sizes(allocateE2(counts(0, 100, 100, 0), 51, 1))).toEqual([0, 26, 25, 0]);
  });

  it("a tie goes to the name that sorts first: uk before unknown", () => {
    expect(sizes(allocateE2(counts(0, 0, 100, 100), 51, 1))).toEqual([0, 0, 26, 25]);
  });

  it("every stratum a census: n equal to the population", () => {
    const a = allocateE2(counts(10, 5, 3, 2), 20, 25);
    expect(sizes(a)).toEqual([10, 5, 3, 2]);
    expect(a.redistributionRounds).toBe(0);
    expect(
      a.strata.every((s) => s.census && s.w === `${s.populationCount}/${s.populationCount}`),
    ).toBe(true);
  });

  it("m larger than every N_h: the minima are the whole population", () => {
    // minima 10 + 5 + 3 + 2 = 20 > n = 12: refused. With n = 25 it is a full census, n realised 20.
    expect(() => allocateE2(counts(10, 5, 3, 2), 12, 25)).toThrow(/refused/);
    const a = allocateE2(counts(10, 5, 3, 2), 25, 25);
    expect(sizes(a)).toEqual([10, 5, 3, 2]);
    expect(a.n).toBe(20);
  });

  it("empty strata are reported and never drawn", () => {
    // Only uk has rows: minimum min(40, 3) = 3, r = 7, all of it to uk.
    const a = allocateE2(counts(0, 0, 40, 0), 10, 3);
    expect(sizes(a)).toEqual([0, 0, 10, 0]);
    expect(a.emptyStrata).toEqual(["en", "ru", "unknown"]);
    expect(a.strata[0]).toEqual({
      stratum: "en",
      populationCount: 0,
      sampleCount: 0,
      census: true,
      pi: null,
      w: null,
    });
  });

  it("m = 1 gives every non-empty stratum at least one row: 1000/1/1/1, n = 10", () => {
    // minima 1 + 1 + 1 + 1 = 4, r = 6, only en is open: 7.
    expect(sizes(allocateE2(counts(1000, 1, 1, 1), 10, 1))).toEqual([7, 1, 1, 1]);
  });

  it("a mixed case with a remainder tie: 60/30/12/8, n = 40, m = 5", () => {
    // minima 5 each = 20, r = 20, T = 110: shares 10.91, 5.45, 2.18, 1.45 -> floors 10, 5, 2, 1,
    // two left; remainders 100, 50, 20, 50 (over 110): en, then the tie ru / unknown -> ru.
    // en 16, ru 11, uk 7, unknown 6.
    expect(sizes(allocateE2(counts(60, 30, 12, 8), 40, 5))).toEqual([16, 11, 7, 6]);
  });

  it("refuses m = 0, n = 0, non-integers and an empty population", () => {
    expect(() => allocateE2(counts(10, 10, 10, 10), 10, 0)).toThrow(/m must be/);
    expect(() => allocateE2(counts(10, 10, 10, 10), 0, 5)).toThrow(/n must be/);
    expect(() => allocateE2(counts(10, 10, 10, 10), 10.5, 5)).toThrow(/n must be/);
    expect(() => allocateE2(counts(0, 0, 0, 0), 10, 5)).toThrow(/empty/);
  });
});

describe("pi and w are exact rationals", () => {
  it("1000/400/12/88 -> literal strings", () => {
    const a = allocateE2(counts(1000, 400, 12, 88), 150, 25);
    expect(a.strata.map((s) => [s.pi, s.w, s.census])).toEqual([
      ["67/1000", "1000/67", false],
      ["42/400", "400/42", false],
      ["12/12", "12/12", true],
      ["29/88", "88/29", false],
    ]);
  });

  it("900/300/0/50 -> the empty stratum has null pi and w", () => {
    const a = allocateE2(counts(900, 300, 0, 50), 150, 25);
    expect(a.strata.map((s) => [s.pi, s.w])).toEqual([
      ["79/900", "900/79"],
      ["43/300", "300/43"],
      [null, null],
      ["28/50", "50/28"],
    ]);
  });

  const cases: [Counts, number, number][] = [
    [counts(1000, 400, 12, 88), 150, 25],
    [counts(900, 300, 0, 50), 150, 25],
    [counts(60, 40, 30, 26), 150, 25],
    [counts(200, 100, 11, 10), 100, 10],
    [counts(1000, 1, 1, 1), 10, 1],
  ];
  for (const [N, n, m] of cases) {
    it(`properties for ${JSON.stringify(N)} n = ${n}`, () => {
      const a = allocateE2(N, n, m);
      let sumPiN = 0;
      for (const s of a.strata) {
        const big = N[s.stratum];
        expect(s.populationCount).toBe(big);
        if (big === 0) {
          expect(s.pi).toBeNull();
          continue;
        }
        const [pa, pb] = s.pi!.split("/").map(Number) as [number, number];
        const [wa, wb] = s.w!.split("/").map(Number) as [number, number];
        expect(pa).toBe(s.sampleCount);
        expect(pb).toBe(big);
        expect(wa).toBe(big);
        expect(wb).toBe(s.sampleCount);
        expect(s.sampleCount).toBeGreaterThanOrEqual(1); // inclusion probability positive
        expect(s.sampleCount).toBeLessThanOrEqual(big);
        sumPiN += (pa / pb) * big;
      }
      expect(sumPiN).toBeCloseTo(n, 9);
      expect(checkE2Allocation(a.strata, a.n)).toEqual([]);
    });
  }
});

// ─── Population freeze ─────────────────────────────────────────────────────

const BASE: Record<RoutingStratum, string> = {
  en: "The aircraft is a long range drone that is used by the army and it has been seen in the east",
  ru: "Беспилотник имеет максимальную скорость сто километров в час при полете",
  uk: "Дрон має максимальну швидкість сто кілометрів на годину і є українським",
  unknown: "x",
};

function makeRows(c: Counts): FrameRow[] {
  const rows: FrameRow[] = [];
  for (const s of ROUTING_STRATA) {
    for (let i = 0; i < c[s]; i++) {
      rows.push({
        sourceId: `${s}-${i}`,
        rawKey: `speed_${s}_${i}`,
        rawValue: String(i),
        excerpt: `${BASE[s]} ${i}`,
        publishedAt: "2026-01-01T00:00:00Z",
      });
    }
  }
  return rows;
}

/** Deterministic shuffle that does not use the code under test. */
function permute<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let x = seed;
  for (let i = out.length - 1; i > 0; i--) {
    x = (x * 1103515245 + 12345) % 2147483648;
    const j = x % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

describe("freezeE2Population", () => {
  it("the synthetic excerpts land in the strata the test assumes", () => {
    for (const s of ROUTING_STRATA) expect(e2RoutingStratum(`${BASE[s]} 7`)).toBe(s);
  });

  it("every element is in exactly one stratum; counts sum to N", () => {
    const pop = freezeE2Population(makeRows(counts(60, 30, 12, 8)));
    expect(pop.manifest.populationCount).toBe(110);
    expect(pop.rows.length).toBe(110);
    expect(pop.manifest.stratumCounts).toEqual({ en: 60, ru: 30, uk: 12, unknown: 8 });
    const sum = ROUTING_STRATA.reduce((t, s) => t + pop.manifest.stratumCounts[s], 0);
    expect(sum).toBe(pop.rows.length);
    for (const r of pop.rows) expect(r.routingStratum).toBe(e2RoutingStratum(r.excerpt));
    expect(() => validateE2PopulationManifest(pop.manifest)).not.toThrow();
    for (const r of pop.rows) expect(() => validateE2Example(r)).not.toThrow();
  });

  it("the manifest carries the rows file SHA-256, content only and canonical order", () => {
    const pop = freezeE2Population(makeRows(counts(5, 5, 5, 5)));
    expect(pop.manifest.populationRowsSha256).toBe(sha(e2RowsJsonl(pop.rows)));
    const ids = pop.rows.map((r) => r.exampleId);
    expect(ids).toEqual([...ids].sort());
  });

  it("does not depend on input order", () => {
    const rows = makeRows(counts(20, 10, 5, 5));
    const a = freezeE2Population(rows);
    const b = freezeE2Population(permute(rows, 7));
    expect(b.rows).toEqual(a.rows);
    expect(b.manifest).toEqual(a.manifest);
  });

  it("drops rows per resolver-independent reason and counts them", () => {
    const ok = makeRows(counts(1, 0, 0, 0))[0]!;
    const rows: FrameRow[] = [
      ok,
      { ...ok, sourceId: "a", rawKey: "  " },
      { ...ok, sourceId: "b", excerpt: "   " },
      { ...ok, sourceId: "c", publishedAt: undefined },
      { ...ok, sourceId: "d", publishedAt: "not a date" },
      { ...ok, sourceId: "e", publishedAt: "2026-11-02T00:00:00Z" },
      { ...ok, sourceId: "f" }, // same evidence as ok, other source: duplicate_evidence
    ];
    const pop = freezeE2Population(rows);
    expect(pop.rows.length).toBe(1);
    expect(pop.manifest.exclusions).toEqual([
      { reason: "after_cutoff", count: 1 },
      { reason: "duplicate_evidence", count: 1 },
      { reason: "empty_excerpt", count: 1 },
      { reason: "empty_raw_key", count: 1 },
      { reason: "invalid_published_at", count: 1 },
      { reason: "missing_published_at", count: 1 },
    ]);
  });

  it("stores a truncated excerpt of 300 characters and routes on it", () => {
    const long = `${BASE.en} ${"word ".repeat(100)}`;
    const row: FrameRow = { ...makeRows(counts(1, 0, 0, 0))[0]!, excerpt: long };
    const pop = freezeE2Population([row]);
    const stored = pop.rows[0]!.excerpt;
    expect(stored.length).toBe(300);
    expect(stored.endsWith("…")).toBe(true);
    expect(pop.rows[0]!.routingStratum).toBe(e2RoutingStratum(stored));
  });

  it("excludes the whole cluster when declared language differs, counted once", () => {
    const base = makeRows(counts(1, 0, 0, 0))[0]!;
    const rows: FrameRow[] = [
      { ...base, sourceId: "s1", declaredLanguage: "en" },
      { ...base, sourceId: "s2", declaredLanguage: "ru" },
      { ...base, sourceId: "s3" },
    ];
    const pop = freezeE2Population(rows);
    expect(pop.rows).toEqual([]);
    expect(pop.manifest.exclusions).toEqual([
      { reason: "conflicting_evidence_metadata", count: 1 },
    ]);
  });

  it("excludes the cluster when context differs", () => {
    const base = makeRows(counts(1, 0, 0, 0))[0]!;
    const pop = freezeE2Population([
      { ...base, sourceId: "s1", domain: "air" },
      { ...base, sourceId: "s2", domain: "sea" },
    ]);
    expect(pop.manifest.exclusions).toEqual([
      { reason: "conflicting_evidence_metadata", count: 1 },
    ]);
  });

  it("case-only variants: same stratum, the first canonical row is kept with its own text", () => {
    const text = "Maximum speed is 100 km/h and the range is long for the drone in the field";
    const lower: FrameRow = {
      sourceId: "s1",
      rawKey: "speed",
      rawValue: "100",
      excerpt: text,
      publishedAt: "2026-01-01T00:00:00Z",
    };
    const upper: FrameRow = { ...lower, sourceId: "s2", excerpt: text.toUpperCase() };
    expect(e2RoutingStratum(text)).toBe(e2RoutingStratum(text.toUpperCase()));
    const a = freezeE2Population([lower, upper]);
    const b = freezeE2Population([upper, lower]);
    // Canonical JSON sorts keys; "excerpt" comes first and "MAXIMUM" < "Maximum" by code units.
    expect(a.rows.length).toBe(1);
    expect(a.rows[0]!.excerpt).toBe(text.toUpperCase());
    expect(a.rows[0]!.source.id).toBe("s2");
    expect(b.rows).toEqual(a.rows);
    expect(a.manifest.exclusions).toEqual([{ reason: "duplicate_evidence", count: 1 }]);
  });

  it("NFKC-equal variants with different strata are a conflict and are excluded", () => {
    // U+212A KELVIN SIGN normalises to K, so both rows share one evidence cluster. With the ASCII K
    // the text has 12 Latin letters (en); with the Kelvin sign it has 11 (unknown).
    const ascii = "is is is is is Kk";
    const kelvin = "is is is is is Kk";
    expect(e2RoutingStratum(ascii)).toBe("en");
    expect(e2RoutingStratum(kelvin)).toBe("unknown");
    const mk = (sourceId: string, excerpt: string): FrameRow => ({
      sourceId,
      rawKey: "speed",
      rawValue: "1",
      excerpt,
      publishedAt: "2026-01-01T00:00:00Z",
    });
    const a = freezeE2Population([mk("s1", ascii), mk("s2", kelvin)]);
    const b = freezeE2Population([mk("s2", kelvin), mk("s1", ascii)]);
    expect(a.rows).toEqual([]);
    expect(a.manifest.exclusions).toEqual([{ reason: "conflicting_evidence_metadata", count: 1 }]);
    expect(b.manifest).toEqual(a.manifest);
  });

  it("refuses declaredLanguage unknown, any other value and the legacy language field", () => {
    const base = makeRows(counts(1, 0, 0, 0))[0]!;
    const bad = (extra: object) => freezeE2Population([{ ...base, ...extra } as FrameRow]);
    expect(() => bad({ declaredLanguage: "unknown" })).toThrow(/declaredLanguage "unknown"/);
    expect(() => bad({ declaredLanguage: "de" })).toThrow(/declaredLanguage "de"/);
    expect(() => bad({ language: "en" })).toThrow(/legacy language field/);
  });

  it("accepts en, ru, uk declarations and keeps them on the row", () => {
    const base = makeRows(counts(0, 1, 0, 0))[0]!;
    const pop = freezeE2Population([{ ...base, declaredLanguage: "ru" }]);
    expect(pop.rows[0]!.declaredLanguage).toBe("ru");
  });
});

// ─── The draw ──────────────────────────────────────────────────────────────

describe("drawE2Sample", () => {
  const pop = freezeE2Population(makeRows(counts(60, 30, 12, 8)));
  const alloc = allocateE2(pop.manifest.stratumCounts, 40, 5);

  it("draws n_h rows per stratum with a valid, chained manifest", () => {
    const s = drawE2Sample(pop, alloc, "seed-1");
    const perStratum = Object.fromEntries(ROUTING_STRATA.map((k) => [k, 0])) as Counts;
    for (const r of s.rows) perStratum[r.routingStratum]++;
    expect(perStratum).toEqual({ en: 16, ru: 11, uk: 7, unknown: 6 });
    expect(s.rows.length).toBe(40);
    expect(s.manifest.n).toBe(40);
    expect(s.manifest.m).toBe(5);
    expect(s.manifest.seed).toBe("seed-1");
    expect(s.manifest.redistributionRounds).toBe(1);
    expect(s.manifest.drawnExampleIds).toEqual(s.rows.map((r) => r.exampleId));
    expect(s.manifest.drawnRowsSha256).toBe(sha(e2RowsJsonl(s.rows)));
    expect(() => validateE2SampleManifest(s.manifest)).not.toThrow();
    expect(checkE2Allocation(s.manifest.strata, s.manifest.n)).toEqual([]);
    expect(checkE2HashChain({ population: pop.manifest, sample: s.manifest })).toEqual([]);
    expect(s.manifest.strata.map((x) => x.pi)).toEqual(["16/60", "11/30", "7/12", "6/8"]);
    expect(s.manifest.strata.map((x) => x.w)).toEqual(["60/16", "30/11", "12/7", "8/6"]);
    const ids = new Set(pop.rows.map((r) => r.exampleId));
    for (const r of s.rows) expect(ids.has(r.exampleId)).toBe(true);
  });

  it("a census stratum is drawn whole", () => {
    const s = drawE2Sample(pop, allocateE2(pop.manifest.stratumCounts, 60, 12), "seed-1");
    const uk = s.rows.filter((r) => r.routingStratum === "uk").length;
    expect(uk).toBe(12);
  });

  it("same seed and population give the same draw; shuffled input gives the same output", () => {
    const a = drawE2Sample(pop, alloc, "seed-1");
    const shuffledPop = {
      rows: permute(pop.rows, 11),
      manifest: pop.manifest,
    };
    const b = drawE2Sample(shuffledPop, alloc, "seed-1");
    expect(b.rows).toEqual(a.rows);
    expect(b.manifest).toEqual(a.manifest);
    // and a population frozen from shuffled frame rows
    const refrozen = freezeE2Population(permute(makeRows(counts(60, 30, 12, 8)), 3));
    expect(drawE2Sample(refrozen, alloc, "seed-1").manifest).toEqual(a.manifest);
  });

  it("a different seed gives a different draw", () => {
    const a = drawE2Sample(pop, alloc, "seed-1");
    const b = drawE2Sample(pop, alloc, "seed-2");
    expect(b.manifest.drawnExampleIds).not.toEqual(a.manifest.drawnExampleIds);
  });

  it("is uniform within a stratum: empirical inclusion near n_h / N_h", () => {
    const small = freezeE2Population(makeRows(counts(40, 0, 0, 0)));
    const a = allocateE2(small.manifest.stratumCounts, 10, 3); // en: 10 of 40, pi = 0.25
    const hits = new Map<string, number>();
    const runs = 300;
    for (let i = 0; i < runs; i++) {
      for (const id of drawE2Sample(small, a, `u${i}`).manifest.drawnExampleIds) {
        hits.set(id, (hits.get(id) ?? 0) + 1);
      }
    }
    expect(hits.size).toBe(40); // every row can be drawn
    for (const row of small.rows) {
      const rate = (hits.get(row.exampleId) ?? 0) / runs;
      expect(Math.abs(rate - 0.25)).toBeLessThan(0.1);
    }
  });

  it("rejects a population that does not match its manifest or the allocation", () => {
    expect(() =>
      drawE2Sample({ rows: pop.rows.slice(1), manifest: pop.manifest }, alloc, "seed-1"),
    ).toThrow(/manifest hash/);
    expect(() => drawE2Sample(pop, allocateE2(counts(60, 30, 12, 9), 40, 5), "seed-1")).toThrow(
      /N_h/,
    );
    expect(() => drawE2Sample(pop, alloc, "")).toThrow(/seed/);
  });
});

// ─── No resolver ───────────────────────────────────────────────────────────

describe("E2 step b has no resolver", () => {
  const root = process.cwd();
  // evaluation.ts is step d: it runs the injected snapshot, so it is covered by its own guard below.
  const files = [
    ...readdirSync(join(root, "src/entities/normalization/semantic-eval/e2"))
      .filter((f) => f !== "evaluation.ts")
      .map((f) => join(root, "src/entities/normalization/semantic-eval/e2", f)),
    join(root, "scripts/e2-freeze-and-draw.ts"),
  ];

  it("no new file imports the resolver, a snapshot or the detector", () => {
    for (const f of files) {
      const imports = readFileSync(f, "utf8")
        .split(/\r?\n/)
        .filter((l) => /^\s*(import|export)\b.*\bfrom\b/.test(l) || /^\s*from\s+"/.test(l));
      for (const line of imports) {
        expect(line, f).not.toMatch(/semantic-resolver|snapshot|\/language"|canonical-manifest/);
      }
    }
  });

  it("step d (evaluation.ts) takes the resolver only as a type and never the detector", () => {
    const lines = readFileSync(
      join(root, "src/entities/normalization/semantic-eval/e2/evaluation.ts"),
      "utf8",
    )
      .split(/\r?\n/)
      .filter((l) => /^\s*(import|export)\b.*\bfrom\b/.test(l));
    for (const line of lines) {
      expect(line).not.toMatch(/\/language"|canonical-manifest/);
      if (/semantic-resolver/.test(line)) expect(line).toMatch(/^import type /);
    }
  });

  it("population and sample rows carry no resolver status or prediction fields", () => {
    const pop = freezeE2Population(makeRows(counts(10, 6, 4, 3)));
    const sample = drawE2Sample(pop, allocateE2(pop.manifest.stratumCounts, 12, 2), "s");
    const allowed = new Set([
      "exampleId",
      "sourceClusterId",
      "evidenceClusterId",
      "source",
      "excerpt",
      "routingStratum",
      "declaredLanguage",
      "rawKey",
      "rawLabel",
      "rawValue",
      "rawUnit",
      "context",
      "family",
      "origin",
      "frameId",
      "schemaVersion",
    ]);
    for (const r of [...pop.rows, ...sample.rows]) {
      for (const k of Object.keys(r)) {
        expect(allowed.has(k), k).toBe(true);
        expect(k).not.toMatch(/resolver|prediction|status|snapshot|verdict/i);
      }
    }
  });
});
