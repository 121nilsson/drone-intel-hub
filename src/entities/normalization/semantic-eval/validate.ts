/**
 * Phase 3.2 / S1 — validators and JSONL helpers. Pure: no I/O beyond parsing a string.
 *
 * Validation is strict on purpose. A silent coercion here would let an AI suggestion become a
 * human label, or let a mixed-protocol decision set be pooled into one metric. Every rejection
 * names the record and the field so the CLI can print an actionable reason.
 */

import { isValidCanonicalId } from "../canonical-manifest";
import type { SemanticResolutionResult } from "../semantic-result";
import {
  MAX_EXCERPT_CHARS,
  ORIGINS,
  PROTOCOL_VERSIONS,
  RESOLVER_STATUSES,
  SEMANTIC_EVAL_SCHEMA_VERSION,
  VERDICTS,
  parseStratumKey,
  type Decision,
  type EvalProtocolVersion,
  type Example,
  type ExampleContext,
  type ExampleSource,
  type Exclusion,
  type FrameRow,
  type PriorAnalystReview,
  type Language,
  type Origin,
  type Prediction,
  type StratumKey,
  type Suggestion,
  type Verdict,
} from "./types";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function fail(where: string, msg: string): never {
  throw new ValidationError(`${where}: ${msg}`);
}

/**
 * A parsed-but-unvalidated record. The explicit optional keys let the validators use dot access
 * under `noPropertyAccessFromIndexSignature`; every value stays `unknown` until checked.
 */
type KnownKey =
  | keyof Example
  | keyof Prediction
  | keyof Suggestion
  | keyof Decision
  | keyof Exclusion
  | keyof ExampleSource
  | keyof ExampleContext
  | keyof FrameRow
  | keyof PriorAnalystReview
  | keyof Suggestion["proposed"]
  | keyof SemanticResolutionResult;
type LooseRecord = { [K in KnownKey]?: unknown };

function isObject(x: unknown): x is LooseRecord {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

const HEX64 = /^[0-9a-f]{64}$/;

function str(where: string, x: unknown, opts: { min?: number; max?: number } = {}): string {
  if (typeof x !== "string") fail(where, `expected a string, got ${typeof x}`);
  if (opts.min !== undefined && x.length < opts.min)
    fail(where, `must be at least ${opts.min} chars`);
  if (opts.max !== undefined && x.length > opts.max)
    fail(where, `must be at most ${opts.max} chars`);
  return x;
}

function enumOf<T extends string>(where: string, x: unknown, values: readonly T[]): T {
  if (typeof x !== "string" || !values.includes(x as T)) {
    fail(where, `expected one of ${values.join(", ")}, got ${JSON.stringify(x)}`);
  }
  return x as T;
}

function optionalStr(where: string, x: unknown): string | undefined {
  if (x === undefined) return undefined;
  return str(where, x);
}

function canonicalId(where: string, x: unknown): string {
  const id = str(where, x, { min: 1 });
  if (!isValidCanonicalId(id)) fail(where, `not a canonical concept id: ${id}`);
  return id;
}

function verdict(where: string, x: unknown): Verdict {
  return enumOf(where, x, VERDICTS);
}

function protocol(where: string, x: unknown): EvalProtocolVersion {
  return enumOf(where, x, PROTOCOL_VERSIONS);
}

function checkCanonicalPair(where: string, v: Verdict, id: string | undefined): void {
  if (v === "resolve") {
    if (id === undefined) fail(where, "verdict resolve requires a canonical_id");
    canonicalId(`${where}.canonical_id`, id);
  } else if (id !== undefined) {
    fail(where, `canonical_id is not allowed for verdict ${v}`);
  }
}

function isoDate(where: string, x: unknown): string {
  const s = str(where, x, { min: 1 });
  if (Number.isNaN(Date.parse(s))) fail(where, `not an ISO date: ${s}`);
  return s;
}

// ─── Record validators ─────────────────────────────────────────────────────

export function validateExample(value: unknown): Example {
  const w = "Example";
  if (!isObject(value)) fail(w, "expected an object");
  const o = value;
  const exampleId = str(`${w}.exampleId`, o.exampleId);
  if (!HEX64.test(exampleId)) fail(`${w}.exampleId`, "must be a 64-char lowercase hex sha256");
  if (!isObject(o.source)) fail(`${w}.source`, "expected an object");
  const source = {
    id: str(`${w}.source.id`, o.source.id, { min: 1 }),
    ...(o.source.url !== undefined ? { url: str(`${w}.source.url`, o.source.url) } : {}),
    ...(o.source.publishedAt !== undefined
      ? { publishedAt: isoDate(`${w}.source.publishedAt`, o.source.publishedAt) }
      : {}),
  };
  const excerpt = str(`${w}.excerpt`, o.excerpt, { min: 1, max: MAX_EXCERPT_CHARS });
  const language = enumOf<Language>(`${w}.language`, o.language, ["en", "ru", "uk", "unknown"]);
  const family = str(`${w}.family`, o.family, { min: 1 });
  const resolverStatus = enumOf(`${w}.resolverStatus`, o.resolverStatus, RESOLVER_STATUSES);
  const stratum = str(`${w}.stratum`, o.stratum, { min: 1 });
  const parsed = parseStratumKey(stratum);
  if (!parsed) fail(`${w}.stratum`, `malformed cell id: ${stratum}`);
  const expected: StratumKey = { language, family, resolverStatus };
  for (const k of ["language", "family", "resolverStatus"] as const) {
    if (parsed[k] !== expected[k]) {
      fail(`${w}.stratum`, `${k} is ${parsed[k]} but the record says ${expected[k]}`);
    }
  }
  if (!isObject(o.context)) fail(`${w}.context`, "expected an object");
  const context = {
    ...(o.context.domain !== undefined
      ? { domain: str(`${w}.context.domain`, o.context.domain) }
      : {}),
    ...(o.context.systemClass !== undefined
      ? { systemClass: str(`${w}.context.systemClass`, o.context.systemClass) }
      : {}),
    ...(o.context.subsystem !== undefined
      ? { subsystem: str(`${w}.context.subsystem`, o.context.subsystem) }
      : {}),
  };
  let priorAnalystReview: Example["priorAnalystReview"];
  if (o.priorAnalystReview !== undefined) {
    if (!isObject(o.priorAnalystReview)) fail(`${w}.priorAnalystReview`, "expected an object");
    priorAnalystReview = {
      claimId: str(`${w}.priorAnalystReview.claimId`, o.priorAnalystReview.claimId, { min: 1 }),
      verdict: str(`${w}.priorAnalystReview.verdict`, o.priorAnalystReview.verdict, { min: 1 }),
    };
  }
  if (typeof o.isPilot !== "boolean") fail(`${w}.isPilot`, "expected a boolean");
  const schemaVersion = str(`${w}.schemaVersion`, o.schemaVersion, { min: 1 });
  if (schemaVersion !== SEMANTIC_EVAL_SCHEMA_VERSION) {
    fail(`${w}.schemaVersion`, `expected ${SEMANTIC_EVAL_SCHEMA_VERSION}, got ${schemaVersion}`);
  }
  return {
    exampleId,
    sourceClusterId: str(`${w}.sourceClusterId`, o.sourceClusterId, { min: 1 }),
    evidenceClusterId: str(`${w}.evidenceClusterId`, o.evidenceClusterId, { min: 1 }),
    source,
    excerpt,
    language,
    rawKey: str(`${w}.rawKey`, o.rawKey, { min: 1 }),
    ...(o.rawLabel !== undefined ? { rawLabel: optionalStr(`${w}.rawLabel`, o.rawLabel) } : {}),
    ...(o.rawValue !== undefined ? { rawValue: optionalStr(`${w}.rawValue`, o.rawValue) } : {}),
    ...(o.rawUnit !== undefined ? { rawUnit: optionalStr(`${w}.rawUnit`, o.rawUnit) } : {}),
    context,
    ...(priorAnalystReview !== undefined ? { priorAnalystReview } : {}),
    family,
    stratum,
    resolverStatus,
    origin: enumOf<Origin>(`${w}.origin`, o.origin, ORIGINS),
    isPilot: o.isPilot,
    frameId: str(`${w}.frameId`, o.frameId, { min: 1 }),
    schemaVersion,
  };
}

export function validatePrediction(value: unknown): Prediction {
  const w = "Prediction";
  if (!isObject(value)) fail(w, "expected an object");
  const o = value;
  const exampleId = str(`${w}.exampleId`, o.exampleId);
  if (!HEX64.test(exampleId)) fail(`${w}.exampleId`, "must be a 64-char lowercase hex sha256");
  if (!isObject(o.result)) fail(`${w}.result`, "expected a SemanticResolutionResult");
  const r = o.result;
  const snapshotHash = str(`${w}.snapshotHash`, o.snapshotHash);
  if (!HEX64.test(snapshotHash))
    fail(`${w}.snapshotHash`, "must be a 64-char lowercase hex sha256");
  if (r.snapshotHash !== snapshotHash) {
    fail(`${w}.snapshotHash`, "does not match result.snapshotHash");
  }
  const status = str(`${w}.result.status`, r.status, { min: 1 });
  if (status === "resolved") {
    if (typeof r.canonicalId !== "string" || !isValidCanonicalId(r.canonicalId)) {
      fail(`${w}.result.canonicalId`, "a resolved result needs a valid canonical id");
    }
  } else if (r.canonicalId !== undefined) {
    fail(`${w}.result.canonicalId`, "must be undefined when status is not resolved");
  }
  return {
    exampleId,
    result: r as unknown as Prediction["result"],
    snapshotHash,
    resolverVersion: str(`${w}.resolverVersion`, o.resolverVersion, { min: 1 }),
  };
}

export function validateSuggestion(value: unknown): Suggestion {
  const w = "Suggestion";
  if (!isObject(value)) fail(w, "expected an object");
  const o = value;
  const exampleId = str(`${w}.exampleId`, o.exampleId);
  if (!HEX64.test(exampleId)) fail(`${w}.exampleId`, "must be a 64-char lowercase hex sha256");
  // The single most important guard in this module: an AI record is never a human one.
  if ("status" in o && o.status !== "suggested") {
    fail(`${w}.status`, `only "suggested" is allowed, got ${JSON.stringify(o.status)}`);
  }
  if (!isObject(o.proposed)) fail(`${w}.proposed`, "expected an object");
  const p = o.proposed;
  const v = verdict(`${w}.proposed.verdict`, p.verdict);
  const id = optionalStr(`${w}.proposed.canonical_id`, p.canonicalId);
  checkCanonicalPair(`${w}.proposed`, v, id);
  let candidates: readonly string[] | undefined;
  if (p.candidates !== undefined) {
    if (!Array.isArray(p.candidates)) fail(`${w}.proposed.candidates`, "expected an array");
    candidates = p.candidates.map((c, i) => canonicalId(`${w}.proposed.candidates[${i}]`, c));
    if (new Set(candidates).size !== candidates.length) {
      fail(`${w}.proposed.candidates`, "must be unique");
    }
  }
  if (!Array.isArray(o.missingInfo) || !o.missingInfo.every((x) => typeof x === "string")) {
    fail(`${w}.missingInfo`, "expected an array of strings");
  }
  return {
    exampleId,
    model: str(`${w}.model`, o.model, { min: 1 }),
    promptHash: str(`${w}.promptHash`, o.promptHash, { min: 1 }),
    proposed: {
      verdict: v,
      ...(id !== undefined ? { canonicalId: id } : {}),
      ...(candidates !== undefined ? { candidates } : {}),
    },
    rationale: str(`${w}.rationale`, o.rationale),
    missingInfo: o.missingInfo as string[],
    status: "suggested",
  };
}

export function validateDecision(value: unknown): Decision {
  const w = "Decision";
  if (!isObject(value)) fail(w, "expected an object");
  const o = value;
  const exampleId = str(`${w}.exampleId`, o.exampleId);
  if (!HEX64.test(exampleId)) fail(`${w}.exampleId`, "must be a 64-char lowercase hex sha256");
  if (o.status !== "human_reviewed") {
    fail(`${w}.status`, `expected "human_reviewed", got ${JSON.stringify(o.status)}`);
  }
  const blindVerdict = verdict(`${w}.blindVerdict`, o.blindVerdict);
  const finalVerdict = verdict(`${w}.finalVerdict`, o.finalVerdict);
  const blindCanonicalId = optionalStr(`${w}.blindCanonicalId`, o.blindCanonicalId);
  const finalCanonicalId = optionalStr(`${w}.finalCanonicalId`, o.finalCanonicalId);
  checkCanonicalPair(`${w}.blind`, blindVerdict, blindCanonicalId);
  checkCanonicalPair(`${w}.final`, finalVerdict, finalCanonicalId);
  if (typeof o.revisedAfterReveal !== "boolean") {
    fail(`${w}.revisedAfterReveal`, "expected a boolean");
  }
  const actuallyRevised = blindVerdict !== finalVerdict || blindCanonicalId !== finalCanonicalId;
  if (o.revisedAfterReveal !== actuallyRevised) {
    fail(`${w}.revisedAfterReveal`, "does not match the blind/final verdicts");
  }
  const revisionReason = optionalStr(`${w}.revisionReason`, o.revisionReason);
  if (actuallyRevised && (revisionReason === undefined || revisionReason.length === 0)) {
    fail(`${w}.revisionReason`, "required when the verdict changed after reveal");
  }
  if (!actuallyRevised && revisionReason !== undefined) {
    fail(`${w}.revisionReason`, "must be absent when nothing was revised");
  }
  let supersedes: string | undefined;
  if (o.supersedes !== undefined) {
    supersedes = str(`${w}.supersedes`, o.supersedes);
    if (!HEX64.test(supersedes)) fail(`${w}.supersedes`, "must be a 64-char lowercase hex sha256");
    if (supersedes === exampleId) fail(`${w}.supersedes`, "cannot supersede itself");
  }
  return {
    exampleId,
    blindVerdict,
    ...(blindCanonicalId !== undefined ? { blindCanonicalId } : {}),
    blindNote: str(`${w}.blindNote`, o.blindNote),
    finalVerdict,
    ...(finalCanonicalId !== undefined ? { finalCanonicalId } : {}),
    revisedAfterReveal: o.revisedAfterReveal,
    ...(revisionReason !== undefined ? { revisionReason } : {}),
    reviewer: str(`${w}.reviewer`, o.reviewer, { min: 1 }),
    reviewedAt: isoDate(`${w}.reviewedAt`, o.reviewedAt),
    protocolVersion: protocol(`${w}.protocolVersion`, o.protocolVersion),
    status: "human_reviewed",
    ...(supersedes !== undefined ? { supersedes } : {}),
  };
}

export function validateFrameRow(value: unknown): FrameRow {
  const w = "FrameRow";
  if (!isObject(value)) fail(w, "expected an object");
  const o = value;
  const occurrenceIndex = o.occurrenceIndex;
  if (
    occurrenceIndex !== undefined &&
    (!Number.isSafeInteger(occurrenceIndex) || (occurrenceIndex as number) < 0)
  ) {
    fail(`${w}.occurrenceIndex`, "must be a non-negative integer");
  }
  const publishedAt = optionalStr(`${w}.publishedAt`, o.publishedAt);
  if (publishedAt !== undefined) isoDate(`${w}.publishedAt`, publishedAt);
  const language = o.language;
  if (language !== undefined)
    enumOf<Language>(`${w}.language`, language, ["en", "ru", "uk", "unknown"]);
  const origin = o.origin;
  if (origin !== undefined) enumOf<Origin>(`${w}.origin`, origin, ORIGINS);
  return {
    sourceId: str(`${w}.sourceId`, o.sourceId, { min: 1 }),
    rawKey: str(`${w}.rawKey`, o.rawKey, { min: 1 }),
    excerpt: str(`${w}.excerpt`, o.excerpt, { min: 1 }),
    ...(o.url !== undefined ? { url: str(`${w}.url`, o.url) } : {}),
    ...(o.contentHash !== undefined ? { contentHash: str(`${w}.contentHash`, o.contentHash) } : {}),
    ...(publishedAt !== undefined ? { publishedAt } : {}),
    ...(o.rawLabel !== undefined ? { rawLabel: optionalStr(`${w}.rawLabel`, o.rawLabel) } : {}),
    ...(o.rawValue !== undefined ? { rawValue: optionalStr(`${w}.rawValue`, o.rawValue) } : {}),
    ...(o.rawUnit !== undefined ? { rawUnit: optionalStr(`${w}.rawUnit`, o.rawUnit) } : {}),
    ...(occurrenceIndex !== undefined ? { occurrenceIndex: occurrenceIndex as number } : {}),
    ...(o.domain !== undefined ? { domain: optionalStr(`${w}.domain`, o.domain) } : {}),
    ...(o.systemClass !== undefined
      ? { systemClass: optionalStr(`${w}.systemClass`, o.systemClass) }
      : {}),
    ...(o.subsystem !== undefined ? { subsystem: optionalStr(`${w}.subsystem`, o.subsystem) } : {}),
    ...(language !== undefined ? { language: language as Language } : {}),
    ...(o.claimId !== undefined ? { claimId: str(`${w}.claimId`, o.claimId, { min: 1 }) } : {}),
    ...(o.priorAnalystVerdict !== undefined
      ? { priorAnalystVerdict: str(`${w}.priorAnalystVerdict`, o.priorAnalystVerdict) }
      : {}),
    ...(origin !== undefined ? { origin: origin as Origin } : {}),
  };
}

export function validateExclusion(value: unknown): Exclusion {
  const w = "Exclusion";
  if (!isObject(value)) fail(w, "expected an object");
  const count = value.count;
  if (!Number.isSafeInteger(count) || (count as number) < 0) {
    fail(`${w}.count`, "must be a non-negative integer");
  }
  return { reason: str(`${w}.reason`, value.reason, { min: 1 }), count: count as number };
}

// ─── JSONL ─────────────────────────────────────────────────────────────────

/** Parse and validate a JSONL file's text. Blank lines are ignored; every other line must pass. */
export function parseJsonl<T>(text: string, validate: (v: unknown) => T, label: string): T[] {
  const out: T[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      fail(`${label} line ${i + 1}`, `invalid JSON: ${(e as Error).message}`);
    }
    try {
      out.push(validate(parsed));
    } catch (e) {
      if (e instanceof ValidationError) fail(`${label} line ${i + 1}`, e.message);
      throw e;
    }
  }
  return out;
}

/** Deterministic JSONL: one compact JSON object per line, trailing newline, stable field order. */
export function toJsonl(records: readonly unknown[]): string {
  if (records.length === 0) return "";
  return `${records.map((r) => canonicalJson(r)).join("\n")}\n`;
}

/** Stable stringify (keys sorted recursively), so hashing a record never depends on field order. */
export function canonicalJson(value: unknown): string {
  // undefined is not JSON. Skipping it on objects and folding it to null in arrays keeps JSONL
  // valid and makes an omitted optional field equal an explicitly-undefined one on round-trip.
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

/** True when two records describe the same human decision (used by the round-trip tests). */
export function sameDecision(a: Decision, b: Decision): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

// ─── Decision-set checks ───────────────────────────────────────────────────

/**
 * Reject duplicate active decisions and mixed protocols before metrics ever see them. Metrics
 * never silently pool different protocol versions.
 */
export function checkDecisionSet(
  decisions: readonly Decision[],
  options: { allowMixedProtocol?: boolean } = {},
): void {
  const seen = new Set<string>();
  for (const d of decisions) {
    if (seen.has(d.exampleId)) {
      fail("Decision set", `more than one active decision for example ${d.exampleId}`);
    }
    seen.add(d.exampleId);
  }
  const versions = new Set(decisions.map((d) => d.protocolVersion));
  if (versions.size > 1 && options.allowMixedProtocol !== true) {
    fail(
      "Decision set",
      `mixed protocol versions (${[...versions].sort().join(", ")}); pass --allow-mixed-protocol to include them separately`,
    );
  }
}

/** Diagnostic only: how often exposure to resolver/AI changed a reviewer's mind. */
export function blindVsFinalChangeRate(decisions: readonly Decision[]): number {
  if (decisions.length === 0) return 0;
  return decisions.filter((d) => d.revisedAfterReveal).length / decisions.length;
}

/** Diagnostic only: agreement between blind human verdict and the AI suggestion. */
export function aiAgreementRate(
  decisions: readonly Decision[],
  suggestions: readonly Suggestion[],
): number {
  if (decisions.length === 0) return 0;
  const byId = new Map(suggestions.map((s) => [s.exampleId, s]));
  let comparable = 0;
  let agree = 0;
  for (const d of decisions) {
    const s = byId.get(d.exampleId);
    if (!s) continue;
    comparable++;
    if (s.proposed.verdict === d.blindVerdict && s.proposed.canonicalId === d.blindCanonicalId) {
      agree++;
    }
  }
  return comparable === 0 ? 0 : agree / comparable;
}
