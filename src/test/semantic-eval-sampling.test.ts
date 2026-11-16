import { describe, expect, it } from "vitest";
import {
  CODE_SEED_SNAPSHOT,
  SEMANTIC_RESOLVER_VERSION,
} from "@/entities/normalization/semantic-resolver";
import { sha256Hex } from "@/entities/normalization/sha256";
import {
  FAMILIES,
  allocateWithinCeiling,
  buildFrame,
  classifyFamily,
  drawSample,
  exampleIdFor,
  evidenceClusterIdFor,
  frameIdFor,
  renderSamplingReport,
  sourceConcentration,
} from "@/entities/normalization/semantic-eval/sampling";
import {
  FAMILY_COUNT,
  FRAME_CUTOFF,
  SAMPLING_SEED,
  type Example,
  type FrameRow,
} from "@/entities/normalization/semantic-eval/types";

const row = (over: Partial<FrameRow> = {}): FrameRow => ({
  sourceId: "dispatch-1",
  rawKey: "max_speed",
  rawValue: "120",
  excerpt: "Maximum speed 120 km/h was reported for the airframe.",
  publishedAt: "2026-03-02T00:00:00.000Z",
  ...over,
});

function frame(rows: readonly FrameRow[]) {
  return buildFrame(rows, {
    frameId: sha256Hex("frame"),
    snapshot: CODE_SEED_SNAPSHOT,
    resolverVersion: SEMANTIC_RESOLVER_VERSION,
  });
}

describe("frame classifier and ids", () => {
  it("uses 12 families derived from the manifest, independent of the resolver", () => {
    expect(FAMILIES).toHaveLength(FAMILY_COUNT);
    expect(new Set(FAMILIES).size).toBe(FAMILY_COUNT);
    expect(FAMILIES).toContain("other_programme_metadata");
    expect(classifyFamily("warhead_weight")).toBe("payload");
    expect(classifyFamily("payload_capacity")).toBe("payload");
    expect(classifyFamily("max_speed", "Max Speed")).toBe("speed");
    expect(classifyFamily("something_unheard_of")).toBe("other_programme_metadata");
  });

  it("gives two occurrences of the same attribute in one text two distinct ids", () => {
    const first = row({ occurrenceIndex: 0 });
    const second = row({ occurrenceIndex: 1 });
    expect(exampleIdFor(first)).not.toBe(exampleIdFor(second));
    // A different locator (claim id) also separates them.
    expect(exampleIdFor(row({ claimId: "claim-a" }))).not.toBe(
      exampleIdFor(row({ claimId: "claim-b" })),
    );
    // The same occurrence is stable.
    expect(exampleIdFor(first)).toBe(exampleIdFor(row({ occurrenceIndex: 0 })));
    expect(exampleIdFor(first)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes exact evidence key/value/unit into the evidence cluster", () => {
    expect(evidenceClusterIdFor(row())).toBe(evidenceClusterIdFor(row()));
    expect(evidenceClusterIdFor(row())).not.toBe(evidenceClusterIdFor(row({ rawValue: "130" })));
  });

  it("separates rows whose key and value match but whose unit or excerpt differs", () => {
    const base = { sourceId: "d1", rawKey: "max_speed", rawValue: "120", occurrenceIndex: 0 };
    const kmh = row({ ...base, rawUnit: "km/h" });
    const mph = row({ ...base, rawUnit: "mph" });
    expect(exampleIdFor(kmh)).not.toBe(exampleIdFor(mph));
    expect(exampleIdFor(kmh)).not.toBe(
      exampleIdFor(row({ ...base, rawUnit: "km/h", excerpt: "A different report of the limit." })),
    );

    const built = frame([kmh, mph]);
    expect(built.examples).toHaveLength(2);
    // Every downstream map is keyed by exampleId, so the frame must have no collisions.
    expect(new Set(built.examples.map((e) => e.exampleId)).size).toBe(built.examples.length);
  });
});

describe("frame freeze and whole-frame replay", () => {
  it("dedupes identical evidence but keeps every distinct attribute of one document", () => {
    const rows = [
      row(),
      row(), // identical evidence -> collapsed
      row({ rawKey: "payload", rawValue: "40", excerpt: "Payload up to 40 kg." }),
    ];
    const built = frame(rows);
    expect(built.examples).toHaveLength(2);
    expect(new Set(built.examples.map((e) => e.evidenceClusterId)).size).toBe(2);
    expect(new Set(built.examples.map((e) => e.family))).toEqual(new Set(["speed", "payload"]));
    expect(built.exclusions).toContainEqual({ reason: "duplicate_evidence", count: 1 });
  });

  it("excludes material after the cutoff, derives language and freezes resolver status", () => {
    const built = frame([
      row({ publishedAt: "2026-12-01T00:00:00.000Z" }),
      row({
        rawKey: "корисне_навантаження",
        rawValue: "40",
        excerpt: "Безпілотник має корисне навантаження 40 кг, і ці дані є точними.",
      }),
    ]);
    expect(built.exclusions).toContainEqual({ reason: "after_cutoff", count: 1 });
    expect(built.examples).toHaveLength(1);
    expect(built.examples[0]!.language).toBe("uk");
    expect(["resolved", "withheld"]).toContain(built.examples[0]!.resolverStatus);
    expect(built.examples[0]!.stratum).toBe(
      `uk|${built.examples[0]!.family}|${built.examples[0]!.resolverStatus}`,
    );
    expect(built.predictions[0]!.result.snapshotHash).toBe(built.predictions[0]!.snapshotHash);
    expect(FRAME_CUTOFF).toBe("2026-11-01T00:00:00Z");
  });

  it("truncates long excerpts and never stores the prior analyst verdict as a label", () => {
    const built = frame([
      row({ excerpt: "x".repeat(400), claimId: "claim-1", priorAnalystVerdict: "accepted" }),
    ]);
    expect(built.examples[0]!.excerpt).toHaveLength(300);
    expect(built.truncated).toBe(1);
    expect(built.examples[0]!.priorAnalystReview).toEqual({
      claimId: "claim-1",
      verdict: "accepted",
    });
    expect((built.examples[0]! as unknown as Record<string, unknown>)["label"]).toBeUndefined();
  });
});

describe("allocation and sampling", () => {
  it("spreads a ceiling by largest remainder without forcing a draw in every non-empty cell", () => {
    const populations: Record<string, number> = { a: 100, b: 80, c: 1, d: 1 };
    const alloc = allocateWithinCeiling(populations, 4);
    expect(Object.values(alloc).reduce((s, n) => s + n, 0)).toBe(4);
    expect(alloc["a"]).toBeGreaterThanOrEqual(alloc["b"]!);
    for (const name of ["a", "b", "c", "d"]) {
      expect(alloc[name]).toBeLessThanOrEqual(populations[name]!);
    }
    // Tiny cells may legitimately receive no draw under the ceiling; they are reported, not backfilled.
    expect(allocateWithinCeiling({ a: 1, b: 1 }, 5)).toEqual({ a: 1, b: 1 });
  });

  it("takes the whole population when it fits under the ceiling", () => {
    expect(allocateWithinCeiling({ a: 2, b: 3 }, 72)).toEqual({ a: 2, b: 3 });
  });

  it("reports empty and unsampled cells and a covered fraction under the ceiling", () => {
    const rows: FrameRow[] = [];
    for (let i = 0; i < 120; i++) {
      rows.push(row({ sourceId: `s${i}`, occurrenceIndex: i, rawKey: "max_speed" }));
    }
    const built = frame(rows);
    const sample = drawSample(built.examples, { seed: SAMPLING_SEED, ceiling: 72 });
    expect(sample.drawnCount).toBeLessThanOrEqual(72);
    expect(sample.populationCount).toBe(built.examples.length);
    expect(sample.coveredFraction).toBeGreaterThan(0);
    expect(sample.emptyCells.length).toBeGreaterThan(0);
    expect(sample.cells.reduce((s, c) => s + c.population, 0)).toBe(sample.populationCount);
    expect(sample.cells.reduce((s, c) => s + c.drawn, 0)).toBe(sample.drawnCount);
    expect(() =>
      renderSamplingReport({
        frameId: "f",
        seed: SAMPLING_SEED,
        cutoff: FRAME_CUTOFF,
        ceiling: 72,
        snapshotHash: CODE_SEED_SNAPSHOT.contentHash,
        resolverVersion: SEMANTIC_RESOLVER_VERSION,
        sample,
        exclusions: built.exclusions,
        truncated: built.truncated,
        concentration: sourceConcentration(built.examples),
        manifestHash: sha256Hex("manifest"),
      }),
    ).not.toThrow();
  });

  it("re-running the sampler is bit-identical, including the report", () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      row({
        sourceId: `s${i}`,
        occurrenceIndex: i,
        rawKey: i % 2 === 0 ? "max_speed" : "warhead_weight",
      }),
    );
    const a = frame(rows);
    const b = frame(rows);
    const sa = drawSample(a.examples, { seed: SAMPLING_SEED, ceiling: 20 });
    const sb = drawSample(b.examples, { seed: SAMPLING_SEED, ceiling: 20 });
    expect(sa).toEqual(sb);
    expect(frameIdFor(a.examples)).toBe(frameIdFor(b.examples));
    const report = (s: typeof sa) =>
      renderSamplingReport({
        frameId: "f",
        seed: SAMPLING_SEED,
        cutoff: FRAME_CUTOFF,
        ceiling: 20,
        snapshotHash: CODE_SEED_SNAPSHOT.contentHash,
        resolverVersion: SEMANTIC_RESOLVER_VERSION,
        sample: s,
        exclusions: [],
        truncated: 0,
        concentration: sourceConcentration(a.examples),
        manifestHash: sha256Hex("manifest"),
      });
    expect(report(sa)).toBe(report(sb));
  });

  it("samples within a cell rather than capping per source", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({
        sourceId: "same-publication",
        contentHash: sha256Hex("simhash"),
        occurrenceIndex: i,
        rawValue: String(i),
      }),
    );
    const built = frame(rows);
    const sample = drawSample(built.examples, { seed: SAMPLING_SEED, ceiling: 5 });
    expect(sample.drawnCount).toBe(5);
    const concentration = sourceConcentration(sample.sampled);
    expect(concentration.topShare).toBe(1);
  });

  it("each decision's example id is a real sampled example", () => {
    const built = frame(
      Array.from({ length: 20 }, (_, i) => row({ sourceId: `s${i}`, occurrenceIndex: i })),
    );
    const sample = drawSample(built.examples, { seed: SAMPLING_SEED, ceiling: 5 });
    const ids = new Set(sample.sampled.map((e) => e.exampleId));
    for (const e of sample.sampled as readonly Example[]) expect(ids.has(e.exampleId)).toBe(true);
  });
});
