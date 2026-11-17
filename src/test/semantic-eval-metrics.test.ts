import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/entities/normalization/sha256";
import {
  TARGETS,
  computeMetrics,
  metricsContextFor,
  renderMetricsReport,
  requiredSampleSize,
  type MetricsInput,
} from "@/entities/normalization/semantic-eval/metrics";
import {
  EVAL_PROTOCOL_VERSION,
  SEMANTIC_EVAL_SCHEMA_VERSION,
  type Decision,
  type SamplingManifest,
  type Example,
  type Prediction,
  type Verdict,
} from "@/entities/normalization/semantic-eval/types";

const SNAP = sha256Hex("snapshot");

function unit(
  i: number,
  status: "resolved" | "withheld" = "resolved",
  over: Partial<Example> = {},
): { example: Example; prediction: Prediction } {
  const exampleId = sha256Hex(`metric-${i}`);
  const family = over.family ?? "speed";
  const language = over.language ?? "en";
  return {
    example: {
      exampleId,
      sourceClusterId: sha256Hex(`source-${i % 7}`),
      evidenceClusterId: sha256Hex(`evidence-${i}`),
      source: { id: `dispatch-${i}` },
      context: {},
      excerpt: `Evidence ${i}.`,
      language,
      rawKey: "max_speed",
      family,
      resolverStatus: status,
      stratum: `${language}|${family}|${status}`,
      origin: "historical",
      isPilot: true,
      frameId: sha256Hex("frame"),
      schemaVersion: SEMANTIC_EVAL_SCHEMA_VERSION,
      ...over,
    },
    prediction: {
      exampleId,
      snapshotHash: SNAP,
      resolverVersion: "1.1.0",
      result: {
        status: status === "resolved" ? "resolved" : "unresolved_unknown",
        ...(status === "resolved" ? { canonicalId: "speed.max" } : {}),
        snapshotHash: SNAP,
        snapshotVersion: 1,
        rawKey: "max_speed",
        diagnostics: [],
      },
    },
  };
}

function decision(exampleId: string, verdict: Verdict, canonicalId?: string): Decision {
  return {
    exampleId,
    blindVerdict: verdict,
    ...(canonicalId !== undefined ? { blindCanonicalId: canonicalId } : {}),
    blindNote: "",
    finalVerdict: verdict,
    ...(canonicalId !== undefined ? { finalCanonicalId: canonicalId } : {}),
    revisedAfterReveal: false,
    reviewer: "maintainer",
    reviewedAt: "2026-11-10T12:00:00.000Z",
    protocolVersion: EVAL_PROTOCOL_VERSION,
    status: "human_reviewed",
  };
}

function input(over: Partial<MetricsInput> = {}): MetricsInput {
  return {
    examples: [],
    predictions: [],
    decisions: [],
    frameId: sha256Hex("frame"),
    seed: "seed",
    cutoff: "2026-11-01T00:00:00Z",
    snapshotHash: SNAP,
    resolverVersion: "1.1.0",
    manifestHash: sha256Hex("manifest"),
    pilot: true,
    ...over,
  };
}

describe("sample-size reality", () => {
  it("matches the hand-computed zero-error requirements", () => {
    expect(requiredSampleSize(0.99)).toBe(299);
    expect(requiredSampleSize(0.95)).toBe(59);
    expect(requiredSampleSize(0.98)).toBe(149);
  });

  it("gives about an 11.7% bound for 24 sampled and 0 errors", () => {
    const units = Array.from({ length: 1000 }, (_, i) => unit(i, "resolved"));
    const decisions = units
      .slice(0, 24)
      .map((u) => decision(u.example.exampleId, "resolve", "speed.max"));
    const result = computeMetrics(
      input({
        examples: units.map((u) => u.example),
        predictions: units.map((u) => u.prediction),
        decisions,
      }),
    );
    const rate = result.precision.resolution.bound.upperRate;
    expect(rate).toBeGreaterThan(0.1);
    expect(rate).toBeLessThan(0.14);
    expect(result.precision.resolution.evidence).toBe("exploratory");
  });

  it("uses a caller-supplied alpha for bounds and the sample-size sentence", () => {
    const units = Array.from({ length: 1000 }, (_, i) => unit(i, "resolved"));
    const decisions = units
      .slice(0, 24)
      .map((u) => decision(u.example.exampleId, "resolve", "speed.max"));
    const base = input({
      examples: units.map((u) => u.example),
      predictions: units.map((u) => u.prediction),
      decisions,
    });
    const loose = computeMetrics(base);
    const strict = computeMetrics({ ...base, alpha: 0.01 });
    expect(strict.precision.resolution.bound.upperCount!).toBeGreaterThan(
      loose.precision.resolution.bound.upperCount!,
    );
    const report = renderMetricsReport({ ...base, alpha: 0.01 }, strict);
    expect(report).toContain("99% one-sided error bound of 1 - 0.01^(1/n)");
    expect(() => computeMetrics({ ...base, alpha: 1.5 })).toThrow(/alpha must lie/);
  });
});

describe("primary metrics", () => {
  const resolved = Array.from({ length: 100 }, (_, i) => unit(i, "resolved"));
  const withheld = Array.from({ length: 100 }, (_, i) => unit(100 + i, "withheld"));
  const all = [...resolved, ...withheld];

  it("counts a wrong canonical id as a resolution error", () => {
    const decisions = [
      ...resolved.slice(0, 10).map((u) => decision(u.example.exampleId, "resolve", "speed.max")),
      decision(resolved[10]!.example.exampleId, "resolve", "range.max"),
      ...withheld.slice(0, 10).map((u) => decision(u.example.exampleId, "unknown_term")),
    ];
    const result = computeMetrics(
      input({
        examples: all.map((u) => u.example),
        predictions: all.map((u) => u.prediction),
        decisions,
      }),
    );
    expect(result.precision.resolution.bound.upperCount).toBeGreaterThanOrEqual(1);
    expect(result.precision.withholding.bound.upperCount).toBeGreaterThanOrEqual(0);
    expect(result.precision.resolution.evidence).not.toBe("passed");
  });

  it("counts insufficient_evidence against the resolver but excludes it from the conditional view", () => {
    const decisions = [
      ...resolved.slice(0, 23).map((u) => decision(u.example.exampleId, "resolve", "speed.max")),
      decision(resolved[23]!.example.exampleId, "insufficient_evidence"),
      ...withheld.slice(0, 10).map((u) => decision(u.example.exampleId, "withhold_context")),
    ];
    const result = computeMetrics(
      input({
        examples: all.map((u) => u.example),
        predictions: all.map((u) => u.prediction),
        decisions,
      }),
    );
    const worst = result.precision.resolution;
    expect(worst.bound.upperCount).toBeGreaterThanOrEqual(1);
    expect(worst.conditional.assessed).toBe(23);
    expect(worst.conditional.sampled).toBe(24);
    expect(worst.conditional.coverageRate).toBeCloseTo(23 / 24);
    expect(worst.conditional.mayBeOptimistic).toBe(true);
    expect(result.diagnostics.unassessable).toBe(1);
  });

  it("keeps fixture-origin examples out of historical metrics unless explicitly included", () => {
    const historical = unit(1000, "resolved");
    const fixture = unit(1001, "resolved", { origin: "fixture" });
    const base = input({
      examples: [historical.example, fixture.example],
      predictions: [historical.prediction, fixture.prediction],
      decisions: [
        decision(historical.example.exampleId, "resolve", "speed.max"),
        decision(fixture.example.exampleId, "withhold_context"),
      ],
    });
    const defaultMetrics = computeMetrics(base);
    expect(defaultMetrics.diagnostics.decided).toBe(1);
    expect(defaultMetrics.precision.resolution.bound.upperCount).toBe(0);

    const explicit = computeMetrics({ ...base, origins: ["historical", "fixture"] });
    expect(explicit.diagnostics.decided).toBe(2);
    expect(explicit.precision.resolution.bound.upperCount).toBeGreaterThanOrEqual(1);
  });

  it("does not count an insufficient_evidence verdict twice in conditional recall", () => {
    const w1 = unit(600, "withheld");
    const w2 = unit(601, "withheld");
    const r1 = unit(602, "resolved");
    const result = computeMetrics(
      input({
        examples: [w1.example, w2.example, r1.example],
        predictions: [w1.prediction, w2.prediction, r1.prediction],
        decisions: [
          decision(w1.example.exampleId, "withhold_context"),
          decision(w2.example.exampleId, "insufficient_evidence"),
          decision(r1.example.exampleId, "resolve", "speed.max"),
        ],
      }),
    );
    // One valid true negative in W, no negatives hidden in R: the conditional figure is 1.
    // `insufficient_evidence` is already excluded from `errors` in W by the classifier.
    expect(result.recall.conditional.pointEstimate).toBe(1);
    expect(result.recall.pointEstimate).toBe(1);
  });

  it("weights recall point estimates by N_h/n_h across cells with different sampling fractions", () => {
    const wA = Array.from({ length: 10 }, (_, i) => unit(700 + i, "withheld", { family: "speed" }));
    const wB = Array.from({ length: 90 }, (_, i) => unit(800 + i, "withheld", { family: "range" }));
    const rAll = Array.from({ length: 10 }, (_, i) => unit(900 + i, "resolved"));
    const examples = [...wA, ...wB, ...rAll];
    const decisions = [
      ...wA.map((u) => decision(u.example.exampleId, "withhold_context")),
      ...wB.slice(0, 9).map((u) => decision(u.example.exampleId, "withhold_context")),
      ...rAll.map((u, i) =>
        i === 0
          ? decision(u.example.exampleId, "unknown_term")
          : decision(u.example.exampleId, "resolve", "speed.max"),
      ),
    ];
    const result = computeMetrics(
      input({
        examples: examples.map((u) => u.example),
        predictions: examples.map((u) => u.prediction),
        decisions,
      }),
    );
    // TN_W = (10/10)*10 + (90/9)*9 = 100; FN_R = (10/10)*1 = 1.
    // The unweighted sample counts would give 19/(19+1) = 95%.
    expect(result.recall.pointEstimate).toBeCloseTo(100 / 101);
    expect(result.recall.conditional.pointEstimate).toBeCloseTo(100 / 101);
  });

  it("bounds withholding recall componentwise from R and W", () => {
    const decisions = [
      ...resolved.slice(0, 8).map((u) => decision(u.example.exampleId, "resolve", "speed.max")),
      ...resolved.slice(8, 10).map((u) => decision(u.example.exampleId, "unknown_term")),
      ...withheld.slice(0, 9).map((u) => decision(u.example.exampleId, "withhold_context")),
      decision(withheld[9]!.example.exampleId, "resolve", "speed.max"),
    ];
    const result = computeMetrics(
      input({
        examples: all.map((u) => u.example),
        predictions: all.map((u) => u.prediction),
        decisions,
      }),
    );
    const recall = result.recall;
    expect(recall.components.nR).toBe(100);
    expect(recall.components.nW).toBe(100);
    expect(recall.components.uFnR).toBeGreaterThanOrEqual(2);
    expect(recall.components.lTnW).toBeLessThanOrEqual(100);
    expect(recall.components.lTnW).toBe(100 - recall.components.upperNonNegW!);
    expect(recall.conservativeLower).toBeCloseTo(
      recall.components.lTnW! / (recall.components.lTnW! + recall.components.uFnR!),
    );
    expect(recall.target).toBe(0.98);
  });

  it("refuses a bound when a non-empty cell has no draw", () => {
    const units = [...resolved.slice(0, 5), unit(500, "resolved", { family: "range" })];
    const decisions = units
      .filter((u) => u.example.family === "speed")
      .map((u) => decision(u.example.exampleId, "resolve", "speed.max"));
    const result = computeMetrics(
      input({
        examples: units.map((u) => u.example),
        predictions: units.map((u) => u.prediction),
        decisions,
      }),
    );
    expect(result.precision.resolution.bound.available).toBe(false);
    expect(result.precision.resolution.bound.reason).toMatch(
      /bound not available: uncovered non-empty stratum/,
    );
    expect(result.recall.refusal).toMatch(/bound not available/);
  });

  it("refuses mixed protocol versions before computing any bound", () => {
    // A cast simulates a future protocol version; today's import rejects any other version.
    const decisions = [
      decision(resolved[0]!.example.exampleId, "resolve", "speed.max"),
      {
        ...decision(resolved[1]!.example.exampleId, "resolve", "speed.max"),
        protocolVersion: "protocol-future" as Decision["protocolVersion"],
      },
    ];
    expect(() =>
      computeMetrics(
        input({
          examples: all.map((u) => u.example),
          predictions: all.map((u) => u.prediction),
          decisions,
        }),
      ),
    ).toThrow(/bound not available:.*mixed protocol/);
  });

  it("refuses decisions outside the seeded sample", () => {
    // The example is in the frame and eligible by origin, but was not drawn.
    const outside = unit(9999, "resolved");
    expect(() =>
      computeMetrics(
        input({
          examples: [...all.map((u) => u.example), outside.example],
          predictions: [...all.map((u) => u.prediction), outside.prediction],
          decisions: [decision(outside.example.exampleId, "resolve", "speed.max")],
          sampledExampleIds: [resolved[0]!.example.exampleId],
        }),
      ),
    ).toThrow(/outside the seeded sample/);
  });
});

describe("origin-specific report context", () => {
  it("derives coverage, cells and concentration from the selected origins only", () => {
    const historical = unit(1, "resolved", { family: "speed" });
    const fixture = unit(2, "resolved", { family: "range", origin: "fixture" });
    const manifest: SamplingManifest = {
      manifestVersion: "1.0.0",
      frameId: "f",
      seed: "s",
      cutoff: "2026-11-01T00:00:00Z",
      ceiling: 72,
      pilot: true,
      familyCount: 12,
      languageCount: 4,
      resolverStatusCount: 2,
      resolverVersion: "1.1.0",
      snapshotHash: SNAP,
      populationCount: 2,
      drawnCount: 2,
      cells: [
        {
          stratum: historical.example.stratum,
          language: "en",
          family: "speed",
          resolverStatus: "resolved",
          population: 1,
          drawn: 1,
          sampledExampleIds: [historical.example.exampleId],
        },
        {
          stratum: fixture.example.stratum,
          language: "en",
          family: "range",
          resolverStatus: "resolved",
          population: 1,
          drawn: 1,
          sampledExampleIds: [fixture.example.exampleId],
        },
      ],
      emptyCells: [],
      unsampledCells: [],
      coveredFraction: 1,
      concentration: [],
      topShare: 0,
      exclusions: [],
      examplesSha256: "a",
      predictionsSha256: "b",
    };
    const context = metricsContextFor(manifest, [historical.example]);
    expect(context.cells).toEqual([
      { stratum: historical.example.stratum, population: 1, drawn: 1 },
    ]);
    expect(context.coveredFraction).toBe(1);
    expect(context.concentration).toHaveLength(1);
    expect(context.emptyCells).toContain(fixture.example.stratum);
  });
});

describe("report", () => {
  it("prints evidence labels, scope, diagnostics and the refusal rule, never 'passed'", () => {
    const units = Array.from({ length: 10 }, (_, i) => unit(i, "resolved"));
    const decisions = units.map((u) => decision(u.example.exampleId, "resolve", "speed.max"));
    const inp = input({
      examples: units.map((u) => u.example),
      predictions: units.map((u) => u.prediction),
      decisions,
    });
    const report = renderMetricsReport(inp, computeMetrics(inp));
    expect(report).toContain("Exploratory evidence");
    expect(report).toContain("target 99.0%");
    expect(report).toContain("Evidence label");
    expect(report).toContain("Blind-vs-final change rate");
    expect(report).toContain("AI-agreement rate");
    expect(report).toContain("100% hard blocker");
    expect(report).toContain("11.7%");
    expect(report).not.toMatch(/\bpassed\b/i);
    expect(TARGETS.resolutionPrecision).toBe(0.99);
  });
});
