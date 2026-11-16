/**
 * Phase 3.2 / S5 — required integrity check between the manifest and the evaluation inputs.
 * Pure: no I/O. The CLI reads the files and passes their exact text plus parsed records here.
 *
 * A metrics report is only meaningful if it describes the frame, snapshot and seeded sample the
 * manifest claims. Missing or inconsistent evidence aborts the report; there is no fallback to
 * the current resolver version or to an unverified sample.
 */

import { sha256Hex } from "../sha256";
import type { Decision, Example, Prediction, SamplingManifest } from "./types";
import { drawnIdsFromManifest } from "./validate";

export interface EvaluationInputs {
  readonly manifest: unknown;
  readonly examples: readonly Example[];
  readonly predictions: readonly Prediction[];
  readonly decisions: readonly Decision[];
  /** The exact bytes of the files the records were parsed from, for hash checks. */
  readonly examplesText: string;
  readonly predictionsText: string;
}

function asManifest(value: unknown): SamplingManifest | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const m = value as Record<string, unknown>;
  for (const key of [
    "frameId",
    "seed",
    "cutoff",
    "snapshotHash",
    "resolverVersion",
    "examplesSha256",
    "predictionsSha256",
  ] as const) {
    if (typeof m[key] !== "string" || (m[key] as string).length === 0) return undefined;
  }
  if (!Array.isArray(m["cells"])) return undefined;
  return value as SamplingManifest;
}

/** Returns every integrity violation; an empty array means the inputs can be reported on. */
export function verifyEvaluationInputs(input: EvaluationInputs): string[] {
  const errors: string[] = [];
  const manifest = asManifest(input.manifest);
  if (!manifest) return ["manifest is missing required fields (frameId, hashes, cells)"];

  if (sha256Hex(input.examplesText) !== manifest.examplesSha256) {
    errors.push("examples.jsonl does not match manifest.examplesSha256");
  }
  if (sha256Hex(input.predictionsText) !== manifest.predictionsSha256) {
    errors.push("predictions.jsonl does not match manifest.predictionsSha256");
  }
  if (input.examples.some((e) => e.frameId !== manifest.frameId)) {
    errors.push("an example does not belong to manifest.frameId");
  }
  if (input.examples.length !== manifest.populationCount) {
    errors.push(
      `population is ${input.examples.length}, manifest says ${manifest.populationCount}`,
    );
  }

  let drawn: Set<string>;
  try {
    drawn = drawnIdsFromManifest(manifest);
  } catch (e) {
    return [...errors, `invalid drawn sample in manifest: ${(e as Error).message}`];
  }
  if (drawn.size !== manifest.drawnCount) {
    errors.push(`drawn ids are ${drawn.size}, manifest says ${manifest.drawnCount}`);
  }
  const exampleIds = new Set(input.examples.map((e) => e.exampleId));
  if (exampleIds.size !== input.examples.length) errors.push("duplicate example ids in frame");
  for (const id of drawn) {
    if (!exampleIds.has(id)) errors.push(`drawn example ${id} is not in examples.jsonl`);
  }

  const predById = new Map(input.predictions.map((p) => [p.exampleId, p]));
  if (predById.size !== input.predictions.length) errors.push("duplicate prediction ids");
  if (input.predictions.length !== input.examples.length) {
    errors.push("predictions and examples have different lengths");
  }
  for (const e of input.examples) {
    const p = predById.get(e.exampleId);
    if (!p) {
      errors.push(`no prediction for example ${e.exampleId}`);
      continue;
    }
    if (
      p.snapshotHash !== manifest.snapshotHash ||
      p.resolverVersion !== manifest.resolverVersion
    ) {
      errors.push(`prediction ${e.exampleId} uses a different snapshot or resolver version`);
    }
    const predictedStatus = p.result.status === "resolved" ? "resolved" : "withheld";
    if (e.resolverStatus !== predictedStatus) {
      errors.push(`example ${e.exampleId} resolverStatus does not match its prediction`);
    }
  }

  const byCell = new Map<string, Example[]>();
  for (const e of input.examples) {
    byCell.set(e.stratum, [...(byCell.get(e.stratum) ?? []), e]);
  }
  const manifestCells = new Set(manifest.cells.map((c) => c.stratum));
  for (const stratum of byCell.keys()) {
    if (!manifestCells.has(stratum)) errors.push(`cell ${stratum} is not in the manifest`);
  }
  for (const cell of manifest.cells) {
    const group = byCell.get(cell.stratum) ?? [];
    if (group.length !== cell.population) {
      errors.push(
        `cell ${cell.stratum} population is ${group.length}, manifest says ${cell.population}`,
      );
    }
    if (cell.sampledExampleIds.length !== cell.drawn) {
      errors.push(
        `cell ${cell.stratum} drawn is ${cell.sampledExampleIds.length}, manifest says ${cell.drawn}`,
      );
    }
    const groupIds = new Set(group.map((e) => e.exampleId));
    for (const id of cell.sampledExampleIds) {
      if (!groupIds.has(id)) errors.push(`sampled id ${id} is not in cell ${cell.stratum}`);
    }
  }

  for (const d of input.decisions) {
    if (!drawn.has(d.exampleId)) errors.push(`decision ${d.exampleId} is outside the drawn sample`);
  }
  return errors;
}
