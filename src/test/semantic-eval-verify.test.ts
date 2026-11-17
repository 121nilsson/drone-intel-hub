import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/entities/normalization/sha256";
import type {
  Decision,
  Example,
  Prediction,
  SamplingManifest,
} from "@/entities/normalization/semantic-eval/types";
import { drawSample } from "@/entities/normalization/semantic-eval/sampling";
import { toJsonl } from "@/entities/normalization/semantic-eval/validate";
import {
  verifyEvaluationInputs,
  type EvaluationInputs,
} from "@/entities/normalization/semantic-eval/verify";

const SNAP = sha256Hex("snapshot");
const ID = sha256Hex("example-1");

function example(over: Partial<Example> = {}): Example {
  return {
    exampleId: ID,
    sourceClusterId: sha256Hex("source"),
    evidenceClusterId: sha256Hex("evidence"),
    source: { id: "d1" },
    context: {},
    excerpt: "Evidence.",
    language: "en",
    rawKey: "max_speed",
    family: "speed",
    resolverStatus: "resolved",
    stratum: "en|speed|resolved",
    origin: "historical",
    isPilot: true,
    frameId: sha256Hex("frame"),
    schemaVersion: "1.0.0",
    ...over,
  };
}

function prediction(over: Partial<Prediction> = {}): Prediction {
  return {
    exampleId: ID,
    snapshotHash: SNAP,
    resolverVersion: "1.1.0",
    result: {
      status: "resolved",
      canonicalId: "speed.max",
      snapshotHash: SNAP,
      snapshotVersion: 1,
      rawKey: "max_speed",
      diagnostics: [],
    },
    ...over,
  };
}

function decision(): Decision {
  return {
    exampleId: ID,
    blindVerdict: "resolve",
    blindCanonicalId: "speed.max",
    blindNote: "",
    finalVerdict: "resolve",
    finalCanonicalId: "speed.max",
    revisedAfterReveal: false,
    reviewer: "r",
    reviewedAt: "2026-11-10T12:00:00.000Z",
    protocolVersion: "protocol-v1",
    status: "human_reviewed",
  };
}

function inputs(over: Partial<EvaluationInputs> = {}): EvaluationInputs {
  const examples = [example()];
  const predictions = [prediction()];
  const examplesText = toJsonl(examples);
  const predictionsText = toJsonl(predictions);
  const replay = drawSample(examples, { seed: "seed", ceiling: 72 });
  const manifest: SamplingManifest = {
    manifestVersion: "1.0.0",
    frameId: examples[0]!.frameId,
    seed: "seed",
    cutoff: "2026-11-01T00:00:00Z",
    ceiling: 72,
    familyCount: 12,
    languageCount: 4,
    resolverStatusCount: 2,
    resolverVersion: "1.1.0",
    snapshotHash: SNAP,
    populationCount: 1,
    drawnCount: 1,
    cells: [
      {
        stratum: "en|speed|resolved",
        language: "en",
        family: "speed",
        resolverStatus: "resolved",
        population: 1,
        drawn: 1,
        sampledExampleIds: [ID],
      },
    ],
    emptyCells: replay.emptyCells,
    unsampledCells: replay.unsampledCells,
    coveredFraction: replay.coveredFraction,
    concentration: [],
    topShare: 0,
    exclusions: [],
    examplesSha256: sha256Hex(examplesText),
    predictionsSha256: sha256Hex(predictionsText),
  };
  return {
    manifest,
    examples,
    predictions,
    decisions: [decision()],
    examplesText,
    predictionsText,
    ...over,
  };
}

describe("evaluation input verification", () => {
  it("accepts a frame, predictions and decisions that match the manifest", () => {
    expect(verifyEvaluationInputs(inputs())).toEqual([]);
  });

  it("rejects a missing or malformed manifest without falling back", () => {
    expect(verifyEvaluationInputs(inputs({ manifest: undefined }))[0]).toMatch(
      /missing required fields/,
    );
    expect(verifyEvaluationInputs(inputs({ manifest: { cells: [] } }))[0]).toMatch(
      /missing required fields/,
    );
  });

  it("detects file hash drift", () => {
    expect(verifyEvaluationInputs(inputs({ examplesText: `${toJsonl([example()])}\n` }))).toContain(
      "examples.jsonl does not match manifest.examplesSha256",
    );
    expect(verifyEvaluationInputs(inputs({ predictionsText: "{}" }))).toContain(
      "predictions.jsonl does not match manifest.predictionsSha256",
    );
  });

  it("detects a frame, snapshot, resolver-status or cell mismatch", () => {
    const base = inputs();
    expect(
      verifyEvaluationInputs({
        ...base,
        examples: [example({ frameId: sha256Hex("other") })],
      }),
    ).toContain("an example does not belong to manifest.frameId");
    expect(
      verifyEvaluationInputs({
        ...base,
        predictions: [prediction({ snapshotHash: sha256Hex("other") })],
      }),
    ).toContain(`prediction ${ID} uses a different snapshot or resolver version`);
    expect(
      verifyEvaluationInputs({
        ...base,
        examples: [example({ resolverStatus: "withheld", stratum: "en|speed|withheld" })],
      }),
    ).toContain(`example ${ID} resolverStatus does not match its prediction`);
  });

  it("detects a drawn sample that cannot be reproduced from the declared seed", () => {
    const base = inputs();
    const two = example({ exampleId: sha256Hex("example-2") });
    const examples = [base.examples[0]!, two];
    const predictions = [base.predictions[0]!, prediction({ exampleId: two.exampleId })];
    const examplesText = toJsonl(examples);
    const predictionsText = toJsonl(predictions);
    const original = base.manifest as SamplingManifest;
    const replay = drawSample(examples, { seed: original.seed, ceiling: 1 });
    const trueId = replay.cells[0]!.sampledExampleIds[0]!;
    const substitutedId =
      trueId === examples[0]!.exampleId ? two.exampleId : examples[0]!.exampleId;
    // Both ids are in the same cell, so every internal-consistency check still passes. The file
    // hashes also still match; only replaying the seed reveals the substituted id.
    const manifest: SamplingManifest = {
      ...original,
      ceiling: 1,
      populationCount: 2,
      drawnCount: 1,
      examplesSha256: sha256Hex(examplesText),
      predictionsSha256: sha256Hex(predictionsText),
      cells: [
        {
          ...original.cells[0]!,
          population: 2,
          sampledExampleIds: [substitutedId],
        },
      ],
    };
    const violations = verifyEvaluationInputs({
      ...base,
      manifest,
      examples,
      predictions,
      decisions: [],
      examplesText,
      predictionsText,
    });
    expect(violations).toContain(
      "replaying the seed does not reproduce the manifest's cells and drawn ids",
    );
  });

  it("detects decisions outside the drawn sample", () => {
    const outside = { ...decision(), exampleId: sha256Hex("not-drawn") };
    expect(verifyEvaluationInputs(inputs({ decisions: [outside] }))).toContain(
      `decision ${outside.exampleId} is outside the drawn sample`,
    );
  });
});
