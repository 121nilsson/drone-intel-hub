/**
 * E2 schema 1.2.0 validators. Strict and pure: unknown keys are rejected, nothing is coerced.
 * Errors are `ValidationError` from the 1.0.0/1.1.0 validators (same style, `Where: message`);
 * the chain and allocation checks return a list of messages instead of throwing.
 */

import { detectLanguagePreD0 } from "../../language-legacy";
import { sha256Hex } from "../../sha256";
import { ORIGINS, type Origin } from "../types";
import { ValidationError, canonicalJson } from "../validate";
import {
  ADJUDICATED_LANGUAGES,
  E2_ADJUDICATION_PROTOCOL_VERSIONS,
  E2_DECLARED_LANGUAGES,
  E2_MAX_EXCERPT_CHARS,
  E2_RESOLVER_LANGUAGE_RULE,
  E2_ROUTING_RULE,
  E2_ROUTING_RULE_SOURCE_COMMIT,
  E2_SCHEMA_VERSION,
  ROUTING_STRATA,
  type AdjudicatedLanguage,
  type E2Adjudication,
  type E2AdjudicationManifest,
  type E2DeclaredLanguage,
  type E2EvaluationManifest,
  type E2Example,
  type E2Exclusion,
  type E2IdenticalExcerptConflict,
  type E2PopulationManifest,
  type E2SampleManifest,
  type E2StratumAllocation,
  type RoutingStratum,
} from "./types";

type Obj = Record<string, unknown>;

const HEX64 = /^[0-9a-f]{64}$/;

function fail(where: string, msg: string): never {
  throw new ValidationError(`${where}: ${msg}`);
}

function obj(where: string, x: unknown, allowed: readonly string[]): Obj {
  if (typeof x !== "object" || x === null || Array.isArray(x)) fail(where, "expected an object");
  const o = x as Obj;
  for (const k of Object.keys(o)) {
    if (!allowed.includes(k)) fail(`${where}.${k}`, "unknown field");
  }
  return o;
}

function str(where: string, x: unknown, min = 1, max?: number): string {
  if (typeof x !== "string") fail(where, `expected a string, got ${typeof x}`);
  if (x.length < min) fail(where, `must be at least ${min} chars`);
  if (max !== undefined && x.length > max) fail(where, `must be at most ${max} chars`);
  return x;
}

function optStr(where: string, x: unknown): string | undefined {
  return x === undefined ? undefined : str(where, x);
}

function enumOf<T extends string>(where: string, x: unknown, values: readonly T[]): T {
  if (typeof x !== "string" || !values.includes(x as T)) {
    fail(where, `expected one of ${values.join(", ")}, got ${JSON.stringify(x)}`);
  }
  return x as T;
}

function hex64(where: string, x: unknown): string {
  const s = str(where, x);
  if (!HEX64.test(s)) fail(where, "must be a 64-char lowercase hex sha256");
  return s;
}

function nonNegInt(where: string, x: unknown): number {
  if (typeof x !== "number" || !Number.isInteger(x) || x < 0) {
    fail(where, `expected a non-negative integer, got ${JSON.stringify(x)}`);
  }
  return x;
}

function bool(where: string, x: unknown): boolean {
  if (typeof x !== "boolean") fail(where, "expected a boolean");
  return x;
}

function isoDate(where: string, x: unknown): string {
  const s = str(where, x);
  if (Number.isNaN(Date.parse(s))) fail(where, `not an ISO date: ${s}`);
  return s;
}

function schemaVersion(where: string, x: unknown): typeof E2_SCHEMA_VERSION {
  if (x !== E2_SCHEMA_VERSION) {
    fail(where, `expected ${E2_SCHEMA_VERSION}, got ${JSON.stringify(x)}`);
  }
  return E2_SCHEMA_VERSION;
}

function stage<S extends string>(where: string, x: unknown, expected: S): S {
  if (x !== expected) fail(where, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(x)}`);
  return expected;
}

/** The excerpt as the freeze stores it: 300 characters at most (299 plus an ellipsis). */
export function e2StoredExcerpt(excerpt: string): string {
  return excerpt.length > E2_MAX_EXCERPT_CHARS ? `${excerpt.slice(0, 299)}…` : excerpt;
}

/** The routing stratum of a row: the pre-D0 rule applied to its stored excerpt. Allocation key only. */
export function e2RoutingStratum(excerpt: string): RoutingStratum {
  return detectLanguagePreD0(e2StoredExcerpt(excerpt));
}

/** SHA-256 of a manifest's canonical JSON: the link the next stage carries. */
export function e2ManifestHash(manifest: unknown): string {
  return sha256Hex(canonicalJson(manifest));
}

// ─── Example row ───────────────────────────────────────────────────────────

const EXAMPLE_KEYS = [
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
] as const;

export function validateE2Example(value: unknown): E2Example {
  const w = "E2Example";
  const o = obj(w, value, EXAMPLE_KEYS);
  const exampleId = hex64(`${w}.exampleId`, o["exampleId"]);
  const src = obj(`${w}.source`, o["source"], ["id", "url", "publishedAt"]);
  const url = optStr(`${w}.source.url`, src["url"]);
  const publishedAt =
    src["publishedAt"] === undefined
      ? undefined
      : isoDate(`${w}.source.publishedAt`, src["publishedAt"]);
  const excerpt = str(`${w}.excerpt`, o["excerpt"], 1, E2_MAX_EXCERPT_CHARS);
  const routingStratum = enumOf(`${w}.routingStratum`, o["routingStratum"], ROUTING_STRATA);
  const expected = e2RoutingStratum(excerpt);
  if (routingStratum !== expected) {
    fail(
      `${w}.routingStratum`,
      `is ${routingStratum} but the routing rule gives ${expected} for the stored excerpt`,
    );
  }
  const declared: E2DeclaredLanguage | undefined =
    o["declaredLanguage"] === undefined
      ? undefined
      : enumOf(`${w}.declaredLanguage`, o["declaredLanguage"], E2_DECLARED_LANGUAGES);
  const ctx = obj(`${w}.context`, o["context"], ["domain", "systemClass", "subsystem"]);
  const origin = enumOf<Origin>(`${w}.origin`, o["origin"], ORIGINS);
  const rawLabel = optStr(`${w}.rawLabel`, o["rawLabel"]);
  const rawValue = optStr(`${w}.rawValue`, o["rawValue"]);
  const rawUnit = optStr(`${w}.rawUnit`, o["rawUnit"]);
  const domain = optStr(`${w}.context.domain`, ctx["domain"]);
  const systemClass = optStr(`${w}.context.systemClass`, ctx["systemClass"]);
  const subsystem = optStr(`${w}.context.subsystem`, ctx["subsystem"]);
  return {
    exampleId,
    sourceClusterId: str(`${w}.sourceClusterId`, o["sourceClusterId"]),
    evidenceClusterId: str(`${w}.evidenceClusterId`, o["evidenceClusterId"]),
    source: {
      id: str(`${w}.source.id`, src["id"]),
      ...(url !== undefined ? { url } : {}),
      ...(publishedAt !== undefined ? { publishedAt } : {}),
    },
    excerpt,
    routingStratum,
    ...(declared !== undefined ? { declaredLanguage: declared } : {}),
    rawKey: str(`${w}.rawKey`, o["rawKey"]),
    ...(rawLabel !== undefined ? { rawLabel } : {}),
    ...(rawValue !== undefined ? { rawValue } : {}),
    ...(rawUnit !== undefined ? { rawUnit } : {}),
    context: {
      ...(domain !== undefined ? { domain } : {}),
      ...(systemClass !== undefined ? { systemClass } : {}),
      ...(subsystem !== undefined ? { subsystem } : {}),
    },
    family: str(`${w}.family`, o["family"]),
    origin,
    frameId: str(`${w}.frameId`, o["frameId"]),
    schemaVersion: schemaVersion(`${w}.schemaVersion`, o["schemaVersion"]),
  };
}

// ─── Adjudication record ───────────────────────────────────────────────────

export function validateE2Adjudication(value: unknown): E2Adjudication {
  const w = "E2Adjudication";
  const o = obj(w, value, [
    "exampleId",
    "reviewerId",
    "protocolVersion",
    "reviewerLanguage",
    "secondReviewerId",
    "secondReviewerLanguage",
    "finalAdjudicatedLanguage",
    "disagreement",
    "resolvedBy",
    "note",
  ]);
  const exampleId = hex64(`${w}.exampleId`, o["exampleId"]);
  const reviewerId = str(`${w}.reviewerId`, o["reviewerId"]);
  const protocolVersion = enumOf(
    `${w}.protocolVersion`,
    o["protocolVersion"],
    E2_ADJUDICATION_PROTOCOL_VERSIONS,
  );
  const first = enumOf<AdjudicatedLanguage>(
    `${w}.reviewerLanguage`,
    o["reviewerLanguage"],
    ADJUDICATED_LANGUAGES,
  );
  const secondId = optStr(`${w}.secondReviewerId`, o["secondReviewerId"]);
  const second: AdjudicatedLanguage | undefined =
    o["secondReviewerLanguage"] === undefined
      ? undefined
      : enumOf(`${w}.secondReviewerLanguage`, o["secondReviewerLanguage"], ADJUDICATED_LANGUAGES);
  if ((secondId === undefined) !== (second === undefined)) {
    fail(w, "secondReviewerId and secondReviewerLanguage must be given together or not at all");
  }
  if (secondId !== undefined && secondId.length === 0) fail(`${w}.secondReviewerId`, "empty");
  if (secondId !== undefined && secondId === reviewerId) {
    fail(w, "the second reviewer must differ from the first");
  }
  const final = enumOf<AdjudicatedLanguage>(
    `${w}.finalAdjudicatedLanguage`,
    o["finalAdjudicatedLanguage"],
    ADJUDICATED_LANGUAGES,
  );
  const disagreement = bool(`${w}.disagreement`, o["disagreement"]);
  const resolvedBy = optStr(`${w}.resolvedBy`, o["resolvedBy"]);
  const note = optStr(`${w}.note`, o["note"]);
  const differs = second !== undefined && second !== first;
  if (disagreement !== differs) {
    fail(
      `${w}.disagreement`,
      differs
        ? "the reviewers differ, so disagreement must be true (never resolved implicitly by order)"
        : "disagreement is true but the reviewers do not differ",
    );
  }
  if (disagreement) {
    if (resolvedBy === undefined || resolvedBy.length === 0) {
      fail(
        `${w}.resolvedBy`,
        "a disagreement needs an explicit resolution: resolvedBy names who set finalAdjudicatedLanguage",
      );
    }
  } else {
    if (resolvedBy !== undefined) fail(`${w}.resolvedBy`, "only allowed with a disagreement");
    if (final !== first) {
      fail(
        `${w}.finalAdjudicatedLanguage`,
        `reviewers agree on ${first} but the final is ${final}`,
      );
    }
  }
  return {
    exampleId,
    reviewerId,
    protocolVersion,
    reviewerLanguage: first,
    ...(secondId !== undefined ? { secondReviewerId: secondId } : {}),
    ...(second !== undefined ? { secondReviewerLanguage: second } : {}),
    finalAdjudicatedLanguage: final,
    disagreement,
    ...(resolvedBy !== undefined ? { resolvedBy } : {}),
    ...(note !== undefined ? { note } : {}),
  };
}

// ─── Stage manifests ───────────────────────────────────────────────────────

function exclusion(where: string, x: unknown): E2Exclusion {
  const o = obj(where, x, ["reason", "count"]);
  return {
    reason: str(`${where}.reason`, o["reason"]),
    count: nonNegInt(`${where}.count`, o["count"]),
  };
}

export function validateE2PopulationManifest(value: unknown): E2PopulationManifest {
  const w = "E2PopulationManifest";
  const o = obj(w, value, [
    "stage",
    "schemaVersion",
    "routingRule",
    "routingRuleSourceCommit",
    "cutoff",
    "frameId",
    "rawExportSha256",
    "populationRowsSha256",
    "populationCount",
    "stratumCounts",
    "exclusions",
  ]);
  stage(`${w}.stage`, o["stage"], "population");
  if (o["routingRule"] !== E2_ROUTING_RULE) fail(`${w}.routingRule`, "must equal E2_ROUTING_RULE");
  if (o["routingRuleSourceCommit"] !== E2_ROUTING_RULE_SOURCE_COMMIT) {
    fail(`${w}.routingRuleSourceCommit`, `must be ${E2_ROUTING_RULE_SOURCE_COMMIT}`);
  }
  const sc = obj(`${w}.stratumCounts`, o["stratumCounts"], ROUTING_STRATA);
  const counts = {} as Record<RoutingStratum, number>;
  let sum = 0;
  for (const s of ROUTING_STRATA) {
    if (sc[s] === undefined) fail(`${w}.stratumCounts.${s}`, "missing");
    counts[s] = nonNegInt(`${w}.stratumCounts.${s}`, sc[s]);
    sum += counts[s];
  }
  const populationCount = nonNegInt(`${w}.populationCount`, o["populationCount"]);
  if (sum !== populationCount) {
    fail(
      `${w}.stratumCounts`,
      `counts sum to ${sum} but populationCount is ${populationCount} (every row is in exactly one stratum)`,
    );
  }
  if (!Array.isArray(o["exclusions"])) fail(`${w}.exclusions`, "expected an array");
  return {
    stage: "population",
    schemaVersion: schemaVersion(`${w}.schemaVersion`, o["schemaVersion"]),
    routingRule: E2_ROUTING_RULE,
    routingRuleSourceCommit: E2_ROUTING_RULE_SOURCE_COMMIT,
    cutoff: isoDate(`${w}.cutoff`, o["cutoff"]),
    frameId: str(`${w}.frameId`, o["frameId"]),
    rawExportSha256: hex64(`${w}.rawExportSha256`, o["rawExportSha256"]),
    populationRowsSha256: hex64(`${w}.populationRowsSha256`, o["populationRowsSha256"]),
    populationCount,
    stratumCounts: counts,
    exclusions: (o["exclusions"] as unknown[]).map((e, i) => exclusion(`${w}.exclusions[${i}]`, e)),
  };
}

/** Exact rational strings for pi and w; null for an empty stratum or a zero draw. */
function ratio(a: number, b: number): string | null {
  return a === 0 || b === 0 ? null : `${a}/${b}`;
}

/**
 * Checks per-stratum allocation: n_h <= N_h, census iff n_h = N_h, pi = "n_h/N_h", w = "N_h/n_h"
 * (exact strings), every non-empty stratum drawn from (n_h >= 1, so w exists), one entry per
 * routing stratum, and sum n_h = n. Returns messages; empty means consistent.
 */
export function checkE2Allocation(strata: readonly E2StratumAllocation[], n: number): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  let sum = 0;
  for (const s of strata) {
    const w = `stratum ${s.stratum}`;
    if (seen.has(s.stratum)) errors.push(`${w}: listed twice`);
    seen.add(s.stratum);
    sum += s.sampleCount;
    if (s.sampleCount > s.populationCount) {
      errors.push(`${w}: n_h ${s.sampleCount} exceeds N_h ${s.populationCount}`);
    }
    if (s.census !== (s.sampleCount === s.populationCount)) {
      errors.push(
        `${w}: census flag ${s.census} is inconsistent with n_h ${s.sampleCount} and N_h ${s.populationCount}`,
      );
    }
    if (s.populationCount > 0 && s.sampleCount === 0) {
      errors.push(`${w}: a non-empty stratum needs n_h >= 1 so that w_h exists`);
    }
    const pi = ratio(s.sampleCount, s.populationCount);
    const wt = ratio(s.populationCount, s.sampleCount);
    if (s.pi !== pi)
      errors.push(`${w}: pi is ${JSON.stringify(s.pi)}, expected ${JSON.stringify(pi)}`);
    if (s.w !== wt)
      errors.push(`${w}: w is ${JSON.stringify(s.w)}, expected ${JSON.stringify(wt)}`);
  }
  for (const k of ROUTING_STRATA) {
    if (!seen.has(k)) errors.push(`stratum ${k}: missing`);
  }
  if (sum !== n) errors.push(`sum of n_h is ${sum} but n is ${n}`);
  return errors;
}

export function validateE2SampleManifest(value: unknown): E2SampleManifest {
  const w = "E2SampleManifest";
  const o = obj(w, value, [
    "stage",
    "schemaVersion",
    "populationManifestSha256",
    "seed",
    "n",
    "m",
    "strata",
    "redistributionRounds",
    "drawnExampleIds",
    "drawnRowsSha256",
  ]);
  stage(`${w}.stage`, o["stage"], "sample");
  const n = nonNegInt(`${w}.n`, o["n"]);
  const m = nonNegInt(`${w}.m`, o["m"]);
  if (!Array.isArray(o["strata"])) fail(`${w}.strata`, "expected an array");
  const strata: E2StratumAllocation[] = (o["strata"] as unknown[]).map((x, i) => {
    const p = `${w}.strata[${i}]`;
    const s = obj(p, x, ["stratum", "populationCount", "sampleCount", "census", "pi", "w"]);
    const ratioField = (k: "pi" | "w"): string | null => {
      const v = s[k];
      if (v === null) return null;
      const t = str(`${p}.${k}`, v);
      if (!/^[1-9][0-9]*\/[1-9][0-9]*$/.test(t)) fail(`${p}.${k}`, `not a rational "a/b": ${t}`);
      return t;
    };
    return {
      stratum: enumOf(`${p}.stratum`, s["stratum"], ROUTING_STRATA),
      populationCount: nonNegInt(`${p}.populationCount`, s["populationCount"]),
      sampleCount: nonNegInt(`${p}.sampleCount`, s["sampleCount"]),
      census: bool(`${p}.census`, s["census"]),
      pi: ratioField("pi"),
      w: ratioField("w"),
    };
  });
  const problems = checkE2Allocation(strata, n);
  if (problems.length > 0) fail(`${w}.strata`, problems.join("; "));
  if (!Array.isArray(o["drawnExampleIds"])) fail(`${w}.drawnExampleIds`, "expected an array");
  const ids = (o["drawnExampleIds"] as unknown[]).map((x, i) =>
    hex64(`${w}.drawnExampleIds[${i}]`, x),
  );
  if (new Set(ids).size !== ids.length) fail(`${w}.drawnExampleIds`, "contains duplicates");
  if (ids.length !== n) fail(`${w}.drawnExampleIds`, `has ${ids.length} ids but n is ${n}`);
  return {
    stage: "sample",
    schemaVersion: schemaVersion(`${w}.schemaVersion`, o["schemaVersion"]),
    populationManifestSha256: hex64(`${w}.populationManifestSha256`, o["populationManifestSha256"]),
    seed: str(`${w}.seed`, o["seed"]),
    n,
    m,
    strata,
    redistributionRounds: nonNegInt(`${w}.redistributionRounds`, o["redistributionRounds"]),
    drawnExampleIds: ids,
    drawnRowsSha256: hex64(`${w}.drawnRowsSha256`, o["drawnRowsSha256"]),
  };
}

function conflictIds(where: string, x: unknown): readonly string[] {
  if (!Array.isArray(x)) fail(where, "expected an array");
  const out = (x as unknown[]).map((v, i) => hex64(`${where}[${i}]`, v));
  for (let i = 1; i < out.length; i++) {
    if (out[i - 1]! >= out[i]!) fail(where, "ids must be unique and sorted");
  }
  return out;
}

function identicalExcerptConflicts(
  where: string,
  x: unknown,
): readonly E2IdenticalExcerptConflict[] {
  if (!Array.isArray(x)) fail(where, "expected an array");
  const seenExcerpts = new Set<string>();
  const seenIds = new Set<string>();
  const out = (x as unknown[]).map((v, i) => {
    const p = `${where}[${i}]`;
    const o = obj(p, v, ["excerptSha256", "exampleIds"]);
    const excerptSha256 = hex64(`${p}.excerptSha256`, o["excerptSha256"]);
    if (seenExcerpts.has(excerptSha256)) fail(`${p}.excerptSha256`, "listed twice");
    seenExcerpts.add(excerptSha256);
    const exampleIds = conflictIds(`${p}.exampleIds`, o["exampleIds"]);
    if (exampleIds.length < 2) fail(`${p}.exampleIds`, "a conflict needs at least two examples");
    for (const id of exampleIds) {
      if (seenIds.has(id)) fail(`${p}.exampleIds`, `${id} appears in more than one conflict`);
      seenIds.add(id);
    }
    return { excerptSha256, exampleIds };
  });
  for (let i = 1; i < out.length; i++) {
    if (out[i - 1]!.excerptSha256 >= out[i]!.excerptSha256) {
      fail(where, "groups must be sorted by excerptSha256");
    }
  }
  return out;
}

export function validateE2AdjudicationManifest(value: unknown): E2AdjudicationManifest {
  const w = "E2AdjudicationManifest";
  const o = obj(w, value, [
    "stage",
    "schemaVersion",
    "sampleManifestSha256",
    "adjudicationSha256",
    "protocolVersion",
    "reviewerIds",
    "secondReviewerUsed",
    "disagreementCount",
    "flaggedDeclaredAdjudicatedConflictCount",
    "flaggedDeclaredAdjudicatedExampleIds",
    "flaggedIdenticalExcerptConflictCount",
    "flaggedIdenticalExcerptConflicts",
    "frozenAt",
  ]);
  stage(`${w}.stage`, o["stage"], "adjudication");
  if (!Array.isArray(o["reviewerIds"])) fail(`${w}.reviewerIds`, "expected an array");
  const reviewerIds = (o["reviewerIds"] as unknown[]).map((x, i) =>
    str(`${w}.reviewerIds[${i}]`, x),
  );
  if (new Set(reviewerIds).size !== reviewerIds.length)
    fail(`${w}.reviewerIds`, "contains duplicates");
  const secondReviewerUsed = bool(`${w}.secondReviewerUsed`, o["secondReviewerUsed"]);
  if (reviewerIds.length !== (secondReviewerUsed ? 2 : 1)) {
    fail(
      `${w}.reviewerIds`,
      `secondReviewerUsed is ${secondReviewerUsed}, so exactly ${secondReviewerUsed ? 2 : 1} reviewer id(s) are expected`,
    );
  }
  const disagreementCount = nonNegInt(`${w}.disagreementCount`, o["disagreementCount"]);
  if (!secondReviewerUsed && disagreementCount !== 0) {
    fail(`${w}.disagreementCount`, "must be 0 without a second reviewer");
  }
  const flaggedDeclaredAdjudicatedExampleIds = conflictIds(
    `${w}.flaggedDeclaredAdjudicatedExampleIds`,
    o["flaggedDeclaredAdjudicatedExampleIds"],
  );
  const flaggedIdenticalExcerptConflicts = identicalExcerptConflicts(
    `${w}.flaggedIdenticalExcerptConflicts`,
    o["flaggedIdenticalExcerptConflicts"],
  );
  const flaggedDeclaredAdjudicatedConflictCount = nonNegInt(
    `${w}.flaggedDeclaredAdjudicatedConflictCount`,
    o["flaggedDeclaredAdjudicatedConflictCount"],
  );
  const flaggedIdenticalExcerptConflictCount = nonNegInt(
    `${w}.flaggedIdenticalExcerptConflictCount`,
    o["flaggedIdenticalExcerptConflictCount"],
  );
  if (flaggedDeclaredAdjudicatedConflictCount !== flaggedDeclaredAdjudicatedExampleIds.length) {
    fail(
      `${w}.flaggedDeclaredAdjudicatedConflictCount`,
      `is ${flaggedDeclaredAdjudicatedConflictCount} but ${flaggedDeclaredAdjudicatedExampleIds.length} ids are flagged`,
    );
  }
  if (flaggedIdenticalExcerptConflictCount !== flaggedIdenticalExcerptConflicts.length) {
    fail(
      `${w}.flaggedIdenticalExcerptConflictCount`,
      `is ${flaggedIdenticalExcerptConflictCount} but ${flaggedIdenticalExcerptConflicts.length} groups are flagged`,
    );
  }
  return {
    stage: "adjudication",
    schemaVersion: schemaVersion(`${w}.schemaVersion`, o["schemaVersion"]),
    sampleManifestSha256: hex64(`${w}.sampleManifestSha256`, o["sampleManifestSha256"]),
    adjudicationSha256: hex64(`${w}.adjudicationSha256`, o["adjudicationSha256"]),
    protocolVersion: enumOf(
      `${w}.protocolVersion`,
      o["protocolVersion"],
      E2_ADJUDICATION_PROTOCOL_VERSIONS,
    ),
    reviewerIds,
    secondReviewerUsed,
    disagreementCount,
    flaggedDeclaredAdjudicatedConflictCount,
    flaggedDeclaredAdjudicatedExampleIds,
    flaggedIdenticalExcerptConflictCount,
    flaggedIdenticalExcerptConflicts,
    frozenAt: isoDate(`${w}.frozenAt`, o["frozenAt"]),
  };
}

export function validateE2EvaluationManifest(value: unknown): E2EvaluationManifest {
  const w = "E2EvaluationManifest";
  const o = obj(w, value, [
    "stage",
    "schemaVersion",
    "adjudicationManifestSha256",
    "populationManifestSha256",
    "adjudicationRowsSha256",
    "evaluatedAt",
    "frozenArtifactsCommit",
    "resolverLanguageRule",
    "snapshotHash",
    "resolverVersion",
    "predictionsSha256",
  ]);
  stage(`${w}.stage`, o["stage"], "evaluation");
  if (o["resolverLanguageRule"] !== E2_RESOLVER_LANGUAGE_RULE) {
    fail(`${w}.resolverLanguageRule`, "must equal E2_RESOLVER_LANGUAGE_RULE");
  }
  const commit = str(`${w}.frozenArtifactsCommit`, o["frozenArtifactsCommit"]);
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit)) {
    fail(`${w}.frozenArtifactsCommit`, "expected a 40- or 64-char lowercase hex commit id");
  }
  return {
    stage: "evaluation",
    schemaVersion: schemaVersion(`${w}.schemaVersion`, o["schemaVersion"]),
    adjudicationManifestSha256: hex64(
      `${w}.adjudicationManifestSha256`,
      o["adjudicationManifestSha256"],
    ),
    populationManifestSha256: hex64(`${w}.populationManifestSha256`, o["populationManifestSha256"]),
    adjudicationRowsSha256: hex64(`${w}.adjudicationRowsSha256`, o["adjudicationRowsSha256"]),
    evaluatedAt: isoDate(`${w}.evaluatedAt`, o["evaluatedAt"]),
    frozenArtifactsCommit: commit,
    resolverLanguageRule: E2_RESOLVER_LANGUAGE_RULE,
    snapshotHash: str(`${w}.snapshotHash`, o["snapshotHash"]),
    resolverVersion: str(`${w}.resolverVersion`, o["resolverVersion"]),
    predictionsSha256: hex64(`${w}.predictionsSha256`, o["predictionsSha256"]),
  };
}

// ─── Hash chain ────────────────────────────────────────────────────────────

export interface E2ManifestChain {
  readonly population: E2PopulationManifest;
  readonly sample?: E2SampleManifest | undefined;
  readonly adjudication?: E2AdjudicationManifest | undefined;
  readonly evaluation?: E2EvaluationManifest | undefined;
}

/**
 * Checks the links population <- sample <- adjudication <- evaluation: each later stage must carry
 * the SHA-256 of the previous stage's canonical JSON. Also cross-checks that the sample's N_h equal
 * the population's counts and that n <= N. A later stage may only be present if every earlier one
 * is. Returns messages; empty means the chain holds.
 */
export function checkE2HashChain(chain: E2ManifestChain): string[] {
  const errors: string[] = [];
  const { population, sample, adjudication, evaluation } = chain;
  if (sample === undefined && (adjudication !== undefined || evaluation !== undefined)) {
    errors.push("chain: a later stage is present without the sample manifest");
  }
  if (adjudication === undefined && evaluation !== undefined) {
    errors.push("chain: the evaluation manifest is present without the adjudication manifest");
  }
  if (sample !== undefined) {
    if (sample.populationManifestSha256 !== e2ManifestHash(population)) {
      errors.push("chain: sample.populationManifestSha256 does not match the population manifest");
    }
    if (sample.n > population.populationCount) {
      errors.push(
        `chain: n ${sample.n} exceeds the population count ${population.populationCount}`,
      );
    }
    for (const s of sample.strata) {
      const expected = population.stratumCounts[s.stratum];
      if (s.populationCount !== expected) {
        errors.push(
          `chain: stratum ${s.stratum} has N_h ${s.populationCount} in the sample but ${expected} in the population`,
        );
      }
    }
  }
  if (adjudication !== undefined && sample !== undefined) {
    if (adjudication.sampleManifestSha256 !== e2ManifestHash(sample)) {
      errors.push("chain: adjudication.sampleManifestSha256 does not match the sample manifest");
    }
  }
  if (evaluation !== undefined && adjudication !== undefined) {
    if (evaluation.adjudicationManifestSha256 !== e2ManifestHash(adjudication)) {
      errors.push(
        "chain: evaluation.adjudicationManifestSha256 does not match the adjudication manifest",
      );
    }
    // An instant is not proof of order, but an evaluation that claims to predate the freeze is
    // impossible. Commit provenance and the direct artifact hashes are checked in evaluate.ts.
    if (Date.parse(evaluation.evaluatedAt) < Date.parse(adjudication.frozenAt)) {
      errors.push(
        `chain: evaluation evaluatedAt ${evaluation.evaluatedAt} precedes adjudication frozenAt ${adjudication.frozenAt}`,
      );
    }
  }
  return errors;
}
