/**
 * Phase 3.2 / S5 — required integrity check between the manifest and the evaluation inputs.
 * Pure: no I/O. The CLI reads the files and passes their exact text plus parsed records here.
 *
 * A metrics report is only meaningful if it describes the frame, snapshot and seeded sample the
 * manifest claims. Missing or inconsistent evidence aborts the report; there is no fallback to
 * the current resolver version or to an unverified sample.
 */

import {
  LANGUAGE_DETECTOR_VERSION,
  LANGUAGE_REASON_OUTCOMES,
  detectLanguageWithEvidence,
  type LanguageDetection,
} from "../language";
import { sha256Hex } from "../sha256";
import { drawSample } from "./sampling";
import {
  LANGUAGE_STRATUM_RULE,
  PILOT_CEILING,
  SEMANTIC_EVAL_SCHEMA_VERSION_1_1,
  type Decision,
  type Example,
  type Prediction,
  type SamplingManifest,
} from "./types";
import { canonicalJson, drawnIdsFromManifest } from "./validate";

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
  if (typeof m["pilot"] !== "boolean") return undefined;
  if (!Number.isSafeInteger(m["ceiling"]) || (m["ceiling"] as number) < 0) return undefined;
  if (!Array.isArray(m["cells"])) return undefined;
  return value as SamplingManifest;
}

/**
 * The detector implementations this verifier can replay, by the version a manifest is stamped
 * with. Historical replay uses the stamped version's implementation, never the current one in its
 * place. Only the current detector is kept: no committed frame is stamped with an older version.
 * Add a frozen copy here before a frame stamped with an older version has to be replayed.
 */
export const LANGUAGE_DETECTORS_BY_VERSION: Readonly<
  Record<string, (text: string) => LanguageDetection>
> = { [LANGUAGE_DETECTOR_VERSION]: detectLanguageWithEvidence };

/**
 * Whether the stored language detections were reproduced. `replayed`: every stored excerpt was run
 * through the stamped detector version (mismatches are errors). `not_replayed`: that version is not
 * available, so the stored fields were checked for consistency only and nothing was reproduced.
 * `not_applicable`: a schema 1.0.0 frame, which records no detection.
 */
export type LanguageReplay =
  | { readonly status: "not_applicable" }
  | { readonly status: "replayed"; readonly detectorVersion: string }
  | { readonly status: "not_replayed"; readonly detectorVersion: string; readonly reason: string };

/** One line for a report or a log; says plainly when nothing was reproduced. */
export function describeLanguageReplay(r: LanguageReplay): string {
  switch (r.status) {
    case "not_applicable":
      return "language replay: not applicable (schema 1.0.0 records no detection)";
    case "replayed":
      return `language replay: performed with detector ${r.detectorVersion}; every stored detection was reproduced`;
    case "not_replayed":
      return `language replay: NOT PERFORMED, ${r.reason}; stored detections were checked for consistency only and are not reproduced`;
  }
}

/**
 * Language provenance of a frame. Schema 1.0.0 directories are read as they always were: nothing is
 * checked here. A 1.1.0 directory must be uniform, stamped, and internally consistent, and every
 * stored excerpt is re-detected with the detector version the manifest is stamped with, never with
 * the current one in its place. When that version is not available, `replay` says so and a warning
 * is raised: an older frame stays verifiable for consistency after a detector bump, but the result
 * never claims that its detections were reproduced.
 */
export function verifyLanguageProvenance(
  manifest: Pick<SamplingManifest, "languageRule" | "languageDetectorVersion">,
  examples: readonly Example[],
): {
  readonly errors: string[];
  readonly warnings: string[];
  readonly replay: LanguageReplay;
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const versions = new Set(examples.map((e) => e.schemaVersion));
  const provenance = examples.filter((e) => e.schemaVersion === SEMANTIC_EVAL_SCHEMA_VERSION_1_1);
  if (provenance.length === 0) return { errors, warnings, replay: { status: "not_applicable" } };
  if (versions.size > 1) {
    errors.push(
      `examples mix schema versions (${[...versions].sort().join(", ")}); one frame, one schema`,
    );
  }
  const stamped = manifest.languageDetectorVersion;
  if (typeof stamped !== "string" || stamped.length === 0) {
    errors.push("schema 1.1.0 manifest has no languageDetectorVersion");
  }
  if (typeof manifest.languageRule !== "string" || manifest.languageRule.length === 0) {
    errors.push("schema 1.1.0 manifest has no languageRule");
  } else if (manifest.languageRule !== LANGUAGE_STRATUM_RULE) {
    errors.push(
      `manifest languageRule "${manifest.languageRule}" is not the rule this verifier knows ("${LANGUAGE_STRATUM_RULE}")`,
    );
  }
  const hasStamp = typeof stamped === "string" && stamped.length > 0;
  const detector = hasStamp ? LANGUAGE_DETECTORS_BY_VERSION[stamped] : undefined;
  for (const e of provenance) {
    const reason = e.languageDetectionReason;
    const outcome = reason === undefined ? undefined : LANGUAGE_REASON_OUTCOMES[reason];
    if (
      e.detectedLanguage === undefined ||
      e.languageDetectionDecisive === undefined ||
      outcome === undefined
    ) {
      errors.push(`example ${e.exampleId} lacks its language provenance fields`);
      continue;
    }
    if (
      e.languageDetectionDecisive !== outcome.decisive ||
      !outcome.languages.includes(e.detectedLanguage)
    ) {
      errors.push(`example ${e.exampleId} has contradictory language provenance (${reason})`);
    }
    if (detector) {
      const d = detector(e.excerpt);
      if (
        d.language !== e.detectedLanguage ||
        d.decisive !== e.languageDetectionDecisive ||
        d.reason !== reason
      ) {
        errors.push(
          `example ${e.exampleId} does not re-detect from its stored excerpt: stored ${e.detectedLanguage}/${e.languageDetectionDecisive}/${reason}, detector ${stamped} gives ${d.language}/${d.decisive}/${d.reason}`,
        );
      }
    }
  }
  let replay: LanguageReplay;
  if (detector && hasStamp) {
    replay = { status: "replayed", detectorVersion: stamped };
  } else {
    replay = {
      status: "not_replayed",
      detectorVersion: hasStamp ? stamped : "(none)",
      reason: hasStamp
        ? `detector ${stamped} is not available to this verifier (current ${LANGUAGE_DETECTOR_VERSION})`
        : "the manifest names no detector version",
    };
    // A missing stamp is already an error above; an unavailable version is a warning.
    if (hasStamp) warnings.push(describeLanguageReplay(replay));
  }
  return { errors, warnings, replay };
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
  // S5 is the independent check: it does not trust S2 to have enforced the pilot ceiling.
  if (manifest.ceiling > PILOT_CEILING && manifest.pilot) {
    errors.push(
      `manifest ceiling ${manifest.ceiling} exceeds the pilot ceiling of ${PILOT_CEILING} but pilot mode is still declared`,
    );
  }
  if (input.examples.some((e) => (manifest.pilot ? !e.isPilot : e.isPilot))) {
    errors.push("example isPilot flags do not match the manifest's pilot status");
  }
  if (input.examples.some((e) => e.frameId !== manifest.frameId)) {
    errors.push("an example does not belong to manifest.frameId");
  }
  if (input.examples.length !== manifest.populationCount) {
    errors.push(
      `population is ${input.examples.length}, manifest says ${manifest.populationCount}`,
    );
  }

  errors.push(...verifyLanguageProvenance(manifest, input.examples).errors);

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

  // Internal consistency is not enough: a tampered manifest can swap drawn ids inside the same
  // cells and still pass every check above. Re-run the declared SRS and require an exact match.
  const replay = drawSample(input.examples, {
    seed: manifest.seed,
    ceiling: manifest.ceiling,
  });
  if (replay.drawnCount !== manifest.drawnCount) {
    errors.push(
      `replaying the seed draws ${replay.drawnCount}, manifest says ${manifest.drawnCount}`,
    );
  }
  if (replay.coveredFraction !== manifest.coveredFraction) {
    errors.push("replayed covered fraction does not match the manifest");
  }
  if (
    canonicalJson(
      replay.cells.map((c) => ({
        stratum: c.stratum,
        population: c.population,
        drawn: c.drawn,
        sampledExampleIds: c.sampledExampleIds,
      })),
    ) !==
    canonicalJson(
      manifest.cells.map((c) => ({
        stratum: c.stratum,
        population: c.population,
        drawn: c.drawn,
        sampledExampleIds: c.sampledExampleIds,
      })),
    )
  ) {
    errors.push("replaying the seed does not reproduce the manifest's cells and drawn ids");
  }
  if (
    canonicalJson([...replay.emptyCells].sort()) !== canonicalJson([...manifest.emptyCells].sort())
  ) {
    errors.push("replayed empty cells do not match the manifest");
  }
  if (
    canonicalJson([...replay.unsampledCells].sort()) !==
    canonicalJson([...manifest.unsampledCells].sort())
  ) {
    errors.push("replayed unsampled cells do not match the manifest");
  }
  const replayIds = replay.cells.flatMap((c) => c.sampledExampleIds);
  if (new Set(replayIds).size !== replayIds.length)
    errors.push("replayed sample has duplicate ids");
  if (new Set(replay.cells.map((c) => c.stratum)).size !== replay.cells.length) {
    errors.push("replayed sample has duplicate strata");
  }
  if (replayIds.length !== replay.drawnCount) {
    errors.push("replayed cell draw counts do not sum to drawnCount");
  }

  for (const d of input.decisions) {
    if (!drawn.has(d.exampleId)) errors.push(`decision ${d.exampleId} is outside the drawn sample`);
  }
  return errors;
}
