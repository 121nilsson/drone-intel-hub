/**
 * Phase 3.2 pilot follow-up — the report distinguishes sampling coverage from human-review
 * coverage. These scenarios use synthetic historical examples only; no fixture example or human
 * decision from the frozen pilot is read or rewritten.
 */

import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/entities/normalization/sha256";
import {
  computeMetrics,
  metricsContextFor,
  renderMetricsReport,
  type MetricsInput,
} from "@/entities/normalization/semantic-eval/metrics";
import {
  EVAL_PROTOCOL_VERSION,
  SEMANTIC_EVAL_SCHEMA_VERSION,
  type Decision,
  type Example,
  type Origin,
  type Prediction,
  type SamplingManifest,
} from "@/entities/normalization/semantic-eval/types";

const SNAP = sha256Hex("coverage-snapshot");

interface Scenario {
  readonly population: number;
  readonly drawn: number;
  readonly reviewed: number;
  readonly origins?: readonly Origin[];
}

interface Built {
  readonly input: MetricsInput;
  readonly report: string;
  readonly drawnIds: readonly string[];
  readonly reviewedIds: readonly string[];
}

function build(over: Partial<Scenario> = {}): Built {
  const { population, drawn, reviewed } = {
    population: 24,
    drawn: 24,
    reviewed: 5,
    ...over,
  };
  const origins = over.origins ?? (["historical"] as const);
  const resolvedCount = Math.ceil((population * 9) / 24);
  const examples: Example[] = [];
  const predictions: Prediction[] = [];
  for (let i = 0; i < population; i++) {
    const exampleId = sha256Hex(`coverage-example-${i}`);
    const resolverStatus = i < resolvedCount ? "resolved" : "withheld";
    const family = "speed";
    const stratum = `en|${family}|${resolverStatus}`;
    examples.push({
      exampleId,
      sourceClusterId: sha256Hex(`coverage-source-${i % 5}`),
      evidenceClusterId: sha256Hex(`coverage-evidence-${i}`),
      source: { id: `source-${i}` },
      context: {},
      excerpt: `Evidence ${i}.`,
      language: "en",
      rawKey: resolverStatus === "resolved" ? "max_speed" : "unknown_term_xyz",
      family,
      resolverStatus,
      stratum,
      origin: "historical",
      isPilot: true,
      frameId: sha256Hex("coverage-frame"),
      schemaVersion: SEMANTIC_EVAL_SCHEMA_VERSION,
    });
    predictions.push({
      exampleId,
      snapshotHash: SNAP,
      resolverVersion: "1.2.0",
      result: {
        status: resolverStatus === "resolved" ? "resolved" : "unresolved_unknown",
        ...(resolverStatus === "resolved" ? { canonicalId: "speed.max" } : {}),
        snapshotHash: SNAP,
        snapshotVersion: 0,
        rawKey: resolverStatus === "resolved" ? "max_speed" : "unknown_term_xyz",
        diagnostics: [],
      },
    });
  }

  const drawnIds = examples.slice(0, drawn).map((e) => e.exampleId);
  const drawnSet = new Set(drawnIds);
  const resolvedDrawn = examples.filter(
    (e) => e.resolverStatus === "resolved" && drawnSet.has(e.exampleId),
  );
  const withheldDrawn = examples.filter(
    (e) => e.resolverStatus === "withheld" && drawnSet.has(e.exampleId),
  );
  // Mirror the pilot's five reviewed cards: two resolution decisions and three withhold decisions.
  const baseResolvedTake = Math.min(resolvedDrawn.length, Math.min(2, reviewed));
  const withheldTake = Math.min(withheldDrawn.length, reviewed - baseResolvedTake);
  const extraResolved = Math.min(
    resolvedDrawn.length - baseResolvedTake,
    reviewed - baseResolvedTake - withheldTake,
  );
  const reviewedExamples = [
    ...resolvedDrawn.slice(0, baseResolvedTake + extraResolved),
    ...withheldDrawn.slice(0, withheldTake),
  ];
  const decisions: Decision[] = reviewedExamples.map((e) => ({
    exampleId: e.exampleId,
    blindVerdict: e.resolverStatus === "resolved" ? "resolve" : "unknown_term",
    ...(e.resolverStatus === "resolved" ? { blindCanonicalId: "speed.max" } : {}),
    blindNote: "",
    finalVerdict: e.resolverStatus === "resolved" ? "resolve" : "unknown_term",
    ...(e.resolverStatus === "resolved" ? { finalCanonicalId: "speed.max" } : {}),
    revisedAfterReveal: false,
    reviewer: "test",
    reviewedAt: "2026-11-23T00:00:00.000Z",
    protocolVersion: EVAL_PROTOCOL_VERSION,
    status: "human_reviewed",
  }));

  const byStratum = new Map<string, Example[]>();
  for (const e of examples) byStratum.set(e.stratum, [...(byStratum.get(e.stratum) ?? []), e]);
  const cells = [...byStratum.entries()].map(([stratum, group]) => {
    const inCell = group.filter((e) => drawnSet.has(e.exampleId)).map((e) => e.exampleId);
    return {
      stratum,
      language: "en" as const,
      family: "speed",
      resolverStatus: group[0]!.resolverStatus,
      population: group.length,
      drawn: inCell.length,
      sampledExampleIds: inCell,
    };
  });
  const manifest: SamplingManifest = {
    manifestVersion: "1.0.0",
    frameId: sha256Hex("coverage-frame"),
    seed: "coverage-seed",
    cutoff: "2026-11-01T00:00:00Z",
    ceiling: 72,
    pilot: true,
    familyCount: 12,
    languageCount: 4,
    resolverStatusCount: 2,
    resolverVersion: "1.2.0",
    snapshotHash: SNAP,
    populationCount: population,
    drawnCount: drawn,
    cells,
    emptyCells: [],
    unsampledCells: [],
    coveredFraction: drawn / population,
    concentration: [],
    topShare: 0,
    exclusions: [],
    examplesSha256: "a",
    predictionsSha256: "b",
  };
  const selectedExamples = examples.filter((e) => origins.includes(e.origin));
  const input: MetricsInput = {
    examples,
    predictions,
    decisions,
    sampledExampleIds: drawnIds,
    frameId: manifest.frameId,
    seed: manifest.seed,
    cutoff: manifest.cutoff,
    snapshotHash: SNAP,
    resolverVersion: "1.2.0",
    manifestHash: sha256Hex("coverage-manifest"),
    pilot: true,
    origins,
    context: metricsContextFor(manifest, selectedExamples),
  };
  return {
    input,
    report: renderMetricsReport(input, computeMetrics(input)),
    drawnIds,
    reviewedIds: decisions.map((d) => d.exampleId),
  };
}

describe("report coverage terminology", () => {
  it("Scenario A: fully drawn, partially reviewed (24 / 24 / 5)", () => {
    const { input, report, drawnIds, reviewedIds } = build();
    const result = computeMetrics(input);
    expect(drawnIds).toHaveLength(24);
    expect(reviewedIds).toHaveLength(5);
    expect(result.diagnostics.decided).toBe(5);

    expect(report).toContain("| Population (eligible examples) | 24 |");
    expect(report).toContain("| Drawn sample | 24 |");
    expect(report).toContain("| Human-reviewed decisions | 5 |");
    expect(report).toContain("| Sampling coverage of population | 100.0% |");
    expect(report).toContain("| Human-review coverage of drawn sample | 20.8% |");
    expect(report).toContain("| Sampling inclusion coverage (cell-level) | 100.0% |");
    expect(report).not.toContain("covered fraction of population");
    // Metric sample sizes come from eligible human decisions, not from the 24 drawn ids.
    expect(result.precision.resolution.conditional.assessed).toBe(2);
    expect(result.precision.withholding.conditional.assessed).toBe(3);
    expect(result.precision.resolution.conditional.sampled).toBe(2);
    expect(report).toContain("| resolutionPrecision | 2 | 2 | 100.0% |");
    expect(report).toContain("| withholdingPrecision | 3 | 3 | 100.0% |");
  });

  it("Scenario B: fully drawn, no human decisions", () => {
    const { input, report } = build({ reviewed: 0 });
    const result = computeMetrics(input);
    expect(result.diagnostics.decided).toBe(0);
    expect(report).toContain("| Sampling coverage of population | 100.0% |");
    expect(report).toContain("| Human-review coverage of drawn sample | 0.0% |");
    expect(report).toContain(
      "**No performance estimate or confidence bound is reported: there are zero eligible human blind decisions.**",
    );
    expect(report).toContain("not available (no eligible human blind decisions)");
    expect(report).not.toContain("Exact finite-population bound:");
    expect(report).not.toContain("0.0% over 0/0");
    expect(result.precision.resolution.conditional.assessed).toBe(0);
  });

  it("Scenario C: partially drawn and partially reviewed", () => {
    const { input, report } = build({ drawn: 12, reviewed: 5 });
    const result = computeMetrics(input);
    expect(report).toContain("| Population (eligible examples) | 24 |");
    expect(report).toContain("| Drawn sample | 12 |");
    expect(report).toContain("| Sampling coverage of population | 50.0% |");
    expect(report).toContain("| Human-review coverage of drawn sample | 41.7% |");
    expect(result.diagnostics.decided).toBe(5);
    // Unreviewed drawn examples are not silently counted as decisions.
    expect(result.precision.resolution.conditional.sampled).toBe(2);
    expect(result.precision.withholding.conditional.sampled).toBe(3);
  });

  it("Scenario D: all drawn examples reviewed", () => {
    const { input, report, drawnIds, reviewedIds } = build({ reviewed: 24 });
    expect(drawnIds).toHaveLength(24);
    expect(reviewedIds).toHaveLength(24);
    expect(report).toContain("| Sampling coverage of population | 100.0% |");
    expect(report).toContain("| Human-review coverage of drawn sample | 100.0% |");
    expect(report).toContain("| Human-reviewed decisions | 24 |");
  });

  it("does not present a conditional rate as population-level evidence", () => {
    const { report } = build();
    expect(report).toContain("Conditional performance coverage");
    expect(report).toContain("A rate here never means the population was reviewed.");
    expect(report).toContain("Conditional performance coverage is assessable / human-reviewed");
  });
});

describe("origin separation in the coverage report", () => {
  it("empty historical origins are refused, not silently replaced by fixture results", () => {
    const fixture = build({ population: 2, drawn: 2, reviewed: 1 });
    const fixtureOnly = {
      ...fixture.input,
      examples: fixture.input.examples.map((e) => ({ ...e, origin: "fixture" as const })),
      decisions: [],
    };
    expect(() => computeMetrics(fixtureOnly)).toThrow(/no examples for origins historical/);
  });

  it("origin filtering keeps the reported population and review count origin-specific", () => {
    const { input } = build({ population: 4, drawn: 4, reviewed: 4 });
    const fixture = input.examples[3]!;
    const withFixture = {
      ...input,
      examples: input.examples.map((e) =>
        e.exampleId === fixture.exampleId ? { ...e, origin: "fixture" as const } : e,
      ),
    };
    const historical = computeMetrics(withFixture);
    expect(historical.diagnostics.decided).toBe(3);
    const both = computeMetrics({ ...withFixture, origins: ["historical", "fixture"] });
    expect(both.diagnostics.decided).toBe(4);
    const historicalExamples = withFixture.examples.filter((e) => e.origin === "historical");
    const historicalCells = [...new Set(historicalExamples.map((e) => e.stratum))].map(
      (stratum) => {
        const group = historicalExamples.filter((e) => e.stratum === stratum);
        return {
          stratum,
          language: "en" as const,
          family: "speed",
          resolverStatus: group[0]!.resolverStatus,
          population: group.length,
          drawn: group.length,
          sampledExampleIds: group.map((e) => e.exampleId),
        };
      },
    );
    const ctx = metricsContextFor(
      {
        manifestVersion: "1.0.0",
        frameId: input.frameId,
        seed: input.seed,
        cutoff: input.cutoff,
        ceiling: 72,
        pilot: true,
        familyCount: 12,
        languageCount: 4,
        resolverStatusCount: 2,
        resolverVersion: "1.2.0",
        snapshotHash: SNAP,
        populationCount: 4,
        drawnCount: 3,
        cells: historicalCells,
        emptyCells: [],
        unsampledCells: [],
        coveredFraction: 1,
        concentration: [],
        topShare: 0,
        exclusions: [],
        examplesSha256: "a",
        predictionsSha256: "b",
      },
      historicalExamples,
    );
    expect(ctx.populationCount).toBe(3);
    expect(ctx.drawnCount).toBe(3);
    expect(ctx.samplingCoverage).toBe(1);
  });
});
