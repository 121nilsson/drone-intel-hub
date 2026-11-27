/**
 * E2 pipeline, step d: run the resolver on the drawn sample and verify the whole record.
 *
 * Pure: it works on file TEXT (the caller reads and writes files) and an injected snapshot, so a
 * test can pass a stub that records its inputs. Nothing outside semantic-eval imports this
 * directory.
 *
 * Order of events in `runE2Evaluation`: the whole chain population -> sample -> adjudication is
 * verified from the frozen files first (`verifyE2Frozen`); only when that returns no error is
 * `resolve()` ever called. A refusal makes zero calls.
 *
 * Resolver input. The language comes only from `e2ResolverLanguage(declaredLanguage, final
 * adjudicated language)`. `routingStratum` is an allocation key: `e2ResolverInput` does not read
 * it, and nothing here detects a language.
 */

import { sha256Hex } from "../../sha256";
import type { ResolutionContextInput } from "../../semantic-resolver";
import type { Prediction } from "../types";
import { ValidationError, canonicalJson, toJsonl } from "../validate";
import { e2AdjudicationConflictFlags, e2AdjudicationsJsonl } from "./adjudication";
import { allocateE2 } from "./allocation";
import { drawE2Sample } from "./draw";
import { e2RowsJsonl } from "./population";
import { e2ResolverLanguage } from "./resolver-language";
import {
  E2_RESOLVER_LANGUAGE_RULE,
  E2_SCHEMA_VERSION,
  ROUTING_STRATA,
  type AdjudicatedLanguage,
  type E2Adjudication,
  type E2AdjudicationManifest,
  type E2EvaluationManifest,
  type E2Example,
  type E2PopulationManifest,
  type E2ResolverLanguage,
  type E2RunProvenance,
  type E2SampleManifest,
  type RoutingStratum,
} from "./types";
import {
  checkE2HashChain,
  e2ManifestHash,
  e2RoutingStratum,
  validateE2Adjudication,
  validateE2AdjudicationManifest,
  validateE2EvaluationManifest,
  validateE2Example,
  validateE2PopulationManifest,
  validateE2SampleManifest,
} from "./validate";

/** What the evaluation needs from a snapshot; `ReadonlySemanticSnapshot` satisfies it. */
export interface E2Snapshot {
  readonly contentHash: string;
  resolve(input: ResolutionContextInput): Prediction["result"];
}

/**
 * A Phase 3.2 `Prediction` plus the resolver language that was passed, for audit. `unknown` means
 * no language was passed to `resolve()`.
 */
export interface E2Prediction extends Prediction {
  readonly resolverLanguage: E2ResolverLanguage | "unknown";
}

/** The exact text of each file. A missing file is `undefined`. */
export interface E2RecordFiles {
  readonly populationJsonl?: string | undefined;
  readonly populationManifestText?: string | undefined;
  readonly sampleJsonl?: string | undefined;
  readonly sampleManifestText?: string | undefined;
  readonly adjudicationsJsonl?: string | undefined;
  readonly adjudicationManifestText?: string | undefined;
  readonly predictionsJsonl?: string | undefined;
  readonly evaluationManifestText?: string | undefined;
}

const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The resolver input of one example. Reads the raw fields, the context, the declared language and
 * the final adjudicated language, and nothing else (not the routing stratum, not the excerpt).
 */
export function e2ResolverInput(
  example: E2Example,
  finalAdjudicatedLanguage: AdjudicatedLanguage | undefined,
): ResolutionContextInput {
  const language = e2ResolverLanguage(example.declaredLanguage, finalAdjudicatedLanguage);
  return {
    rawKey: example.rawKey,
    ...(example.rawLabel !== undefined ? { rawLabel: example.rawLabel } : {}),
    ...(example.rawUnit !== undefined ? { rawUnit: example.rawUnit } : {}),
    ...(example.context.domain !== undefined ? { domain: example.context.domain } : {}),
    ...(example.context.systemClass !== undefined
      ? { systemClass: example.context.systemClass }
      : {}),
    ...(example.context.subsystem !== undefined ? { subsystem: example.context.subsystem } : {}),
    ...(language !== undefined ? { language } : {}),
  };
}

/** One prediction per example, in the order given. */
export function e2Predictions(
  sampleRows: readonly E2Example[],
  adjudications: ReadonlyMap<string, AdjudicatedLanguage>,
  snapshot: E2Snapshot,
  resolverVersion: string,
): E2Prediction[] {
  return sampleRows.map((example) => {
    const final = adjudications.get(example.exampleId);
    const result = snapshot.resolve(e2ResolverInput(example, final));
    return {
      exampleId: example.exampleId,
      result,
      snapshotHash: result.snapshotHash,
      resolverVersion,
      resolverLanguage: e2ResolverLanguage(example.declaredLanguage, final) ?? "unknown",
    };
  });
}

/** Canonical predictions file: one canonical JSON object per line, sorted by exampleId. */
export function e2PredictionsJsonl(predictions: readonly E2Prediction[]): string {
  return toJsonl([...predictions].sort((a, b) => byCodeUnits(a.exampleId, b.exampleId)));
}

function parseLines<T>(text: string, validate: (v: unknown) => T, what: string, errors: string[]) {
  const out: T[] = [];
  text.split("\n").forEach((line, i) => {
    if (line.trim().length === 0) return;
    try {
      out.push(validate(JSON.parse(line)));
    } catch (e) {
      errors.push(`${what}: line ${i + 1}: ${(e as Error).message}`);
    }
  });
  return out;
}

function parseManifest<T>(
  text: string | undefined,
  validate: (v: unknown) => T,
  what: string,
  errors: string[],
): T | undefined {
  if (text === undefined) {
    errors.push(`${what}: file is missing`);
    return undefined;
  }
  try {
    return validate(JSON.parse(text));
  } catch (e) {
    errors.push(`${what}: ${(e as Error).message}`);
    return undefined;
  }
}

function requireText(text: string | undefined, what: string, errors: string[]) {
  if (text === undefined) errors.push(`${what}: file is missing`);
  return text;
}

export interface E2FrozenRecord {
  readonly populationManifest: E2PopulationManifest;
  readonly populationRows: readonly E2Example[];
  readonly sampleManifest: E2SampleManifest;
  readonly sampleRows: readonly E2Example[];
  readonly adjudicationManifest: E2AdjudicationManifest;
  readonly adjudications: readonly E2Adjudication[];
  /** exampleId -> finalAdjudicatedLanguage. */
  readonly finalLanguages: ReadonlyMap<string, AdjudicatedLanguage>;
}

/**
 * Verifies population -> sample -> adjudication from the frozen files. Never calls a resolver.
 * Returns the errors and, when there are none, the parsed record.
 */
export function verifyE2Frozen(files: E2RecordFiles): {
  readonly errors: string[];
  readonly record?: E2FrozenRecord;
} {
  const errors: string[] = [];
  const populationManifest = parseManifest(
    files.populationManifestText,
    validateE2PopulationManifest,
    "population manifest",
    errors,
  );
  const sampleManifest = parseManifest(
    files.sampleManifestText,
    validateE2SampleManifest,
    "sample manifest",
    errors,
  );
  const adjudicationManifest = parseManifest(
    files.adjudicationManifestText,
    validateE2AdjudicationManifest,
    "adjudication manifest",
    errors,
  );
  const populationText = requireText(files.populationJsonl, "population.jsonl", errors);
  const sampleText = requireText(files.sampleJsonl, "sample.jsonl", errors);
  const adjudicationText = requireText(files.adjudicationsJsonl, "adjudications.jsonl", errors);
  if (
    populationManifest === undefined ||
    sampleManifest === undefined ||
    adjudicationManifest === undefined ||
    populationText === undefined ||
    sampleText === undefined ||
    adjudicationText === undefined
  ) {
    return { errors };
  }

  // Links.
  errors.push(
    ...checkE2HashChain({
      population: populationManifest,
      sample: sampleManifest,
      adjudication: adjudicationManifest,
    }),
  );

  // Population.
  if (sha256Hex(populationText) !== populationManifest.populationRowsSha256) {
    errors.push("population: population.jsonl SHA-256 does not match the manifest");
  }
  const populationRows = parseLines(populationText, validateE2Example, "population", errors);
  if (populationRows.length !== populationManifest.populationCount) {
    errors.push(
      `population: ${populationRows.length} rows but the manifest says ${populationManifest.populationCount}`,
    );
  }
  if (e2RowsJsonl(populationRows) !== populationText) {
    errors.push("population: the file is not the canonical, sorted encoding of its rows");
  }
  const counts = Object.fromEntries(ROUTING_STRATA.map((s) => [s, 0])) as Record<
    RoutingStratum,
    number
  >;
  const ids = new Set<string>();
  const clusters = new Set<string>();
  for (const e of populationRows) {
    if (ids.has(e.exampleId)) errors.push(`population: duplicate exampleId ${e.exampleId}`);
    ids.add(e.exampleId);
    if (clusters.has(e.evidenceClusterId)) {
      errors.push(`population: ${e.exampleId} repeats evidenceClusterId ${e.evidenceClusterId}`);
    }
    clusters.add(e.evidenceClusterId);
    const expected = e2RoutingStratum(e.excerpt);
    if (e.routingStratum !== expected) {
      errors.push(
        `population: ${e.exampleId} has routingStratum ${e.routingStratum}, its stored excerpt gives ${expected}`,
      );
    }
    counts[e.routingStratum]++;
    if (e.frameId !== populationManifest.frameId) {
      errors.push(`population: ${e.exampleId} has a frameId that differs from the manifest`);
    }
  }
  for (const s of ROUTING_STRATA) {
    if (counts[s] !== populationManifest.stratumCounts[s]) {
      errors.push(
        `population: stratum ${s} has ${counts[s]} rows but the manifest says ${populationManifest.stratumCounts[s]}`,
      );
    }
  }
  const stratumSum = ROUTING_STRATA.reduce((sum, s) => sum + counts[s], 0);
  if (stratumSum !== populationRows.length) {
    errors.push("population: the strata do not partition the rows");
  }
  const frameId = sha256Hex(
    populationRows
      .map((e) => e.exampleId)
      .sort(byCodeUnits)
      .join("|"),
  );
  if (frameId !== populationManifest.frameId) {
    errors.push("population: frameId is not the hash of the row ids");
  }
  const reasons = new Set<string>();
  let previous = "";
  for (const x of populationManifest.exclusions) {
    if (!Number.isSafeInteger(x.count) || x.count < 1) {
      errors.push(`population: exclusion ${x.reason} has an invalid count ${x.count}`);
    }
    if (reasons.has(x.reason)) errors.push(`population: exclusion ${x.reason} is listed twice`);
    if (x.reason < previous) errors.push("population: exclusions are not sorted by reason");
    reasons.add(x.reason);
    previous = x.reason;
  }

  // Sample.
  if (sha256Hex(sampleText) !== sampleManifest.drawnRowsSha256) {
    errors.push("sample: sample.jsonl SHA-256 does not match the manifest");
  }
  const sampleRows = parseLines(sampleText, validateE2Example, "sample", errors);
  if (e2RowsJsonl(sampleRows) !== sampleText) {
    errors.push("sample: the file is not the canonical, sorted encoding of its rows");
  }
  const sampleIds = sampleRows.map((e) => e.exampleId);
  if (canonicalJson(sampleIds) !== canonicalJson(sampleManifest.drawnExampleIds)) {
    errors.push("sample: the rows' ids differ from the manifest's drawnExampleIds");
  }
  const populationById = new Map(populationRows.map((e) => [e.exampleId, e]));
  for (const e of sampleRows) {
    const p = populationById.get(e.exampleId);
    if (p === undefined) errors.push(`sample: ${e.exampleId} is not in the population`);
    else if (canonicalJson(p) !== canonicalJson(e)) {
      errors.push(`sample: ${e.exampleId} differs from its population row`);
    }
  }
  {
    try {
      const allocation = allocateE2(
        populationManifest.stratumCounts,
        sampleManifest.n,
        sampleManifest.m,
      );
      if (allocation.n !== sampleManifest.n) {
        errors.push(
          `sample: allocation gives n ${allocation.n}, the manifest says ${sampleManifest.n}`,
        );
      }
      if (canonicalJson(allocation.strata) !== canonicalJson(sampleManifest.strata)) {
        errors.push("sample: n_h, census, pi and w differ from allocateE2(N_h, n, m)");
      }
      if (allocation.redistributionRounds !== sampleManifest.redistributionRounds) {
        errors.push("sample: redistributionRounds differ from allocateE2");
      }
      const redrawn = drawE2Sample(
        { rows: populationRows, manifest: populationManifest },
        allocation,
        sampleManifest.seed,
      );
      if (canonicalJson(redrawn.manifest.drawnExampleIds) !== canonicalJson(sampleIds)) {
        errors.push("sample: the draw with the recorded seed gives different ids");
      }
      if (e2RowsJsonl(redrawn.rows) !== sampleText) {
        errors.push("sample: the draw with the recorded seed gives different rows");
      }
    } catch (e) {
      errors.push(`sample: cannot reproduce the allocation and draw: ${(e as Error).message}`);
    }
  }

  // Adjudication.
  if (sha256Hex(adjudicationText) !== adjudicationManifest.adjudicationSha256) {
    errors.push("adjudication: adjudications.jsonl SHA-256 does not match the manifest");
  }
  const adjudications = parseLines(
    adjudicationText,
    validateE2Adjudication,
    "adjudication",
    errors,
  );
  if (e2AdjudicationsJsonl(adjudications) !== adjudicationText) {
    errors.push("adjudication: the file is not the canonical, sorted encoding of its records");
  }
  const seen = new Set<string>();
  const final = new Map<string, AdjudicatedLanguage>();
  for (const a of adjudications) {
    if (seen.has(a.exampleId)) errors.push(`adjudication: ${a.exampleId} appears twice`);
    seen.add(a.exampleId);
    final.set(a.exampleId, a.finalAdjudicatedLanguage);
    if (!sampleIds.includes(a.exampleId)) {
      errors.push(`adjudication: ${a.exampleId} is not in the drawn sample`);
    }
  }
  for (const id of sampleIds) {
    if (!seen.has(id)) errors.push(`adjudication: drawn example ${id} has no adjudication`);
  }
  const disagreements = adjudications.filter((a) => a.disagreement).length;
  if (disagreements !== adjudicationManifest.disagreementCount) {
    errors.push(
      `adjudication: ${disagreements} disagreement(s) in the records, the manifest says ${adjudicationManifest.disagreementCount}`,
    );
  }
  if (
    adjudications.some((a) => a.secondReviewerId !== undefined) !==
    adjudicationManifest.secondReviewerUsed
  ) {
    errors.push("adjudication: secondReviewerUsed does not match the records");
  }
  const flags = e2AdjudicationConflictFlags(sampleRows, final);
  if (
    canonicalJson(flags.declaredAdjudicatedExampleIds) !==
      canonicalJson(adjudicationManifest.flaggedDeclaredAdjudicatedExampleIds) ||
    adjudicationManifest.flaggedDeclaredAdjudicatedConflictCount !==
      flags.declaredAdjudicatedExampleIds.length
  ) {
    errors.push(
      "adjudication: flagged declared/adjudicated conflicts do not match the frozen sample and records",
    );
  }
  if (
    canonicalJson(flags.identicalExcerptConflicts) !==
      canonicalJson(adjudicationManifest.flaggedIdenticalExcerptConflicts) ||
    adjudicationManifest.flaggedIdenticalExcerptConflictCount !==
      flags.identicalExcerptConflicts.length
  ) {
    errors.push(
      "adjudication: flagged identical-excerpt conflicts do not match the frozen sample and records",
    );
  }

  if (errors.length > 0) return { errors };
  return {
    errors,
    record: {
      populationManifest,
      populationRows,
      sampleManifest,
      sampleRows,
      adjudicationManifest,
      adjudications,
      finalLanguages: final,
    },
  };
}

export interface E2EvaluationRun {
  readonly predictions: readonly E2Prediction[];
  readonly predictionsJsonl: string;
  readonly manifest: E2EvaluationManifest;
  /** Pretty manifest text as written to disk. */
  readonly manifestText: string;
}

export function e2EvaluationManifestText(m: E2EvaluationManifest): string {
  return `${JSON.stringify(m, null, 2)}\n`;
}

/**
 * Runs the resolver on the drawn sample. Refuses (throws `ValidationError`) before any `resolve()`
 * call when the frozen chain is missing, invalid or tampered. `files` must not carry predictions.
 */
export function runE2Evaluation(
  files: E2RecordFiles,
  snapshot: E2Snapshot,
  resolverVersion: string,
  provenance: E2RunProvenance,
): E2EvaluationRun {
  const frozen = verifyE2Frozen(files);
  if (frozen.record === undefined) {
    throw new ValidationError(`refusing to run: ${frozen.errors.join("; ")}`);
  }
  const { record } = frozen;
  if (files.populationManifestText === undefined || files.adjudicationsJsonl === undefined) {
    throw new ValidationError("refusing to run: frozen artifact text is missing");
  }
  // Check provenance before any resolve() call: an impossible ordering or an unparsable reference
  // must never produce predictions that look like a valid evaluation.
  const evaluatedMs = Date.parse(provenance.evaluatedAt);
  if (Number.isNaN(evaluatedMs)) {
    throw new ValidationError(`refusing to run: invalid evaluatedAt ${provenance.evaluatedAt}`);
  }
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(provenance.frozenArtifactsCommit)) {
    throw new ValidationError("refusing to run: invalid frozenArtifactsCommit");
  }
  if (evaluatedMs < Date.parse(record.adjudicationManifest.frozenAt)) {
    throw new ValidationError(
      `refusing to run: evaluation evaluatedAt ${provenance.evaluatedAt} precedes adjudication frozenAt ${record.adjudicationManifest.frozenAt}`,
    );
  }
  const predictions = e2Predictions(
    record.sampleRows,
    record.finalLanguages,
    snapshot,
    resolverVersion,
  );
  const predictionsJsonl = e2PredictionsJsonl(predictions);
  const manifest = validateE2EvaluationManifest({
    stage: "evaluation",
    schemaVersion: E2_SCHEMA_VERSION,
    adjudicationManifestSha256: e2ManifestHash(record.adjudicationManifest),
    populationManifestSha256: sha256Hex(files.populationManifestText),
    adjudicationRowsSha256: sha256Hex(files.adjudicationsJsonl),
    evaluatedAt: provenance.evaluatedAt,
    frozenArtifactsCommit: provenance.frozenArtifactsCommit,
    resolverLanguageRule: E2_RESOLVER_LANGUAGE_RULE,
    snapshotHash: snapshot.contentHash,
    resolverVersion,
    predictionsSha256: sha256Hex(predictionsJsonl),
  });
  const chain = checkE2HashChain({
    population: record.populationManifest,
    sample: record.sampleManifest,
    adjudication: record.adjudicationManifest,
    evaluation: manifest,
  });
  if (chain.length > 0) throw new ValidationError(`hash chain: ${chain.join("; ")}`);
  return {
    predictions,
    predictionsJsonl,
    manifest,
    manifestText: e2EvaluationManifestText(manifest),
  };
}

function validateE2Prediction(v: unknown): E2Prediction {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("not an object");
  const o = v as Record<string, unknown>;
  const lang = o["resolverLanguage"];
  if (
    typeof o["exampleId"] !== "string" ||
    typeof o["snapshotHash"] !== "string" ||
    typeof o["resolverVersion"] !== "string" ||
    typeof o["result"] !== "object" ||
    o["result"] === null ||
    (lang !== "en" && lang !== "ru" && lang !== "uk" && lang !== "unknown")
  ) {
    throw new Error("not an E2 prediction");
  }
  return v as E2Prediction;
}

/**
 * Recomputes everything from the frozen files and the manifests; returns every error found (an
 * empty list means the record reproduces). The resolver is replayed only when the frozen chain
 * verified and the snapshot is the one the manifest names.
 */
export function verifyE2Record(
  files: E2RecordFiles,
  snapshot: E2Snapshot,
  resolverVersion: string,
): string[] {
  const { errors, record } = verifyE2Frozen(files);
  const evaluation = parseManifest(
    files.evaluationManifestText,
    validateE2EvaluationManifest,
    "evaluation manifest",
    errors,
  );
  const predictionsText = requireText(files.predictionsJsonl, "predictions.jsonl", errors);
  if (record === undefined || evaluation === undefined || predictionsText === undefined) {
    return errors;
  }

  errors.push(
    ...checkE2HashChain({
      population: record.populationManifest,
      sample: record.sampleManifest,
      adjudication: record.adjudicationManifest,
      evaluation,
    }),
  );
  if (
    files.populationManifestText !== undefined &&
    sha256Hex(files.populationManifestText) !== evaluation.populationManifestSha256
  ) {
    errors.push("population: population-manifest.json SHA-256 does not match the manifest");
  }
  if (
    files.adjudicationsJsonl !== undefined &&
    sha256Hex(files.adjudicationsJsonl) !== evaluation.adjudicationRowsSha256
  ) {
    errors.push("adjudication: adjudications.jsonl SHA-256 does not match the manifest");
  }
  if (sha256Hex(predictionsText) !== evaluation.predictionsSha256) {
    errors.push("predictions: predictions.jsonl SHA-256 does not match the manifest");
  }
  const predictions = parseLines(predictionsText, validateE2Prediction, "predictions", errors);
  const byId = new Map<string, E2Prediction>();
  for (const p of predictions) {
    if (byId.has(p.exampleId)) errors.push(`predictions: ${p.exampleId} appears twice`);
    byId.set(p.exampleId, p);
    if (p.snapshotHash !== evaluation.snapshotHash) {
      errors.push(
        `predictions: ${p.exampleId} carries a different snapshot hash than the manifest`,
      );
    }
    if (p.resolverVersion !== evaluation.resolverVersion) {
      errors.push(
        `predictions: ${p.exampleId} carries a different resolver version than the manifest`,
      );
    }
  }
  for (const e of record.sampleRows) {
    const p = byId.get(e.exampleId);
    if (p === undefined) {
      errors.push(`predictions: drawn example ${e.exampleId} has no prediction`);
      continue;
    }
    const expected =
      e2ResolverLanguage(e.declaredLanguage, record.finalLanguages.get(e.exampleId)) ?? "unknown";
    if (p.resolverLanguage !== expected) {
      errors.push(
        `predictions: ${e.exampleId} recorded resolver language ${p.resolverLanguage}, the frozen values give ${expected}`,
      );
    }
  }
  const drawn = new Set(record.sampleRows.map((e) => e.exampleId));
  for (const id of byId.keys()) {
    if (!drawn.has(id)) errors.push(`predictions: ${id} is not a drawn example`);
  }

  if (evaluation.snapshotHash !== snapshot.contentHash) {
    errors.push(
      `snapshot: the manifest names ${evaluation.snapshotHash} but the replay snapshot is ${snapshot.contentHash}; replay refused`,
    );
  } else if (evaluation.resolverVersion !== resolverVersion) {
    errors.push(
      `snapshot: the manifest names resolver version ${evaluation.resolverVersion} but the replay uses ${resolverVersion}; replay refused`,
    );
  } else if (errors.length === 0) {
    const replay = e2PredictionsJsonl(
      e2Predictions(record.sampleRows, record.finalLanguages, snapshot, resolverVersion),
    );
    if (replay !== predictionsText) {
      errors.push("predictions: replaying the resolver gives different predictions");
    }
  }
  return errors;
}
