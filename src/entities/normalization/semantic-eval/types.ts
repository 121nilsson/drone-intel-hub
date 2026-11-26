/**
 * Phase 3.2 / S1–S5 — pure data contracts for the human-efficient semantic evaluation system.
 *
 * BOUNDARY: this directory is isolated evaluation infrastructure. It has no database, no file
 * I/O, no network, no legacy normaliser import, and no production consumer. The CLIs in scripts/
 * own every side effect; these types and the validators/metrics beside them are pure data.
 *
 * Four record kinds stay in separate files on disk and in memory and are never merged in place:
 * Example (raw, frozen), Prediction (resolver), Suggestion (AI), Decision (human). The human
 * verdict that matters is `Decision.blindVerdict`; `finalVerdict` is a diagnostic only.
 */

import type { LanguageDetectionReason } from "../language";
import type { SemanticResolutionResult } from "../semantic-result";

/**
 * Bumped on any breaking change to a record shape. Stored on every Example.
 *
 * 1.0.0 is the original shape and stays the default the sampler emits: directories written under
 * it (the committed fixtures) read and verify exactly as before.
 */
export const SEMANTIC_EVAL_SCHEMA_VERSION = "1.0.0";

/**
 * 1.1.0 adds language provenance (D0 of the v1.3.0 plan): `FrameRow.declaredLanguage`,
 * `Example.declaredLanguage/detectedLanguage/languageDetectionDecisive/languageDetectionReason`
 * and the `external_source` origin. Additive only. The sampler writes it only when asked
 * (`FreezeOptions.schemaVersion`); readers accept both versions.
 */
export const SEMANTIC_EVAL_SCHEMA_VERSION_1_1 = "1.1.0";
export const SUPPORTED_SCHEMA_VERSIONS: readonly string[] = [
  SEMANTIC_EVAL_SCHEMA_VERSION,
  SEMANTIC_EVAL_SCHEMA_VERSION_1_1,
];

/** How `Example.language` (the stratum language) is chosen in a 1.1.0 frame; stored in the manifest. */
export const LANGUAGE_STRATUM_RULE = "declared, else detected if decisive, else unknown";

/**
 * The one annotation protocol currently defined. A decision records the version it used.
 * Adding a second version is an explicit code change that must also add per-version reporting;
 * until then, any other version is invalid input and is rejected at import. The mixed-version
 * guard in checkDecisionSet stays generic so it becomes live when a real version is added.
 */
export const EVAL_PROTOCOL_VERSION = "protocol-v1";
export type EvalProtocolVersion = "protocol-v1";
export const PROTOCOL_VERSIONS: readonly EvalProtocolVersion[] = [EVAL_PROTOCOL_VERSION];

/** Provenance excerpts are capped so full frames stay out of git (D3). */
export const MAX_EXCERPT_CHARS = 300;

/** Sampling constants from the approved plan. A pilot is a ceiling, never a per-cell quota. */
export const PILOT_CEILING = 72;
export const FAMILY_COUNT = 12;
export const LANGUAGE_COUNT = 4;
export const RESOLVER_STATUS_COUNT = 2;
export const FRAME_CUTOFF = "2026-11-01T00:00:00Z";
export const SAMPLING_SEED = "drone-intel-hub-phase3-eval-20261115";

export type Language = "en" | "ru" | "uk" | "unknown";
export const LANGUAGES: readonly Language[] = ["en", "ru", "uk", "unknown"];

/** The resolver is run on the whole frame, so this is a known population quantity. */
export type ResolverStatus = "resolved" | "withheld";
export const RESOLVER_STATUSES: readonly ResolverStatus[] = ["resolved", "withheld"];

/** `external_source` (schema 1.1.0): not from the app's store, never counted as historical. */
export type Origin = "historical" | "fixture" | "adversarial_ai" | "external_source";
export const ORIGINS: readonly Origin[] = [
  "historical",
  "fixture",
  "adversarial_ai",
  "external_source",
];

/**
 * Protocol v1 verdicts. `insufficient_evidence` is a genuine answer, not a missing one: it is
 * reported as coverage loss and never silently dropped or treated as approval. `registry_gap` was
 * added to v1 after the first five-card pilot: the term is meaningful but has no id in the frozen
 * snapshot. It is a coverage finding, not a semantic one — never a resolution, never converted to
 * a canonical id, and never mislabelled as `unknown_term`. Existing v1 decisions stay valid.
 */
export type Verdict =
  | "resolve"
  | "withhold_context"
  | "withhold_ambiguous"
  | "registry_gap"
  | "unknown_term"
  | "insufficient_evidence";
export const VERDICTS: readonly Verdict[] = [
  "resolve",
  "withhold_context",
  "withhold_ambiguous",
  "registry_gap",
  "unknown_term",
  "insufficient_evidence",
];

/** A verdict withholds (a true negative case) when it is not a resolution and not unassessable. */
export function isWithholdingVerdict(v: Verdict): boolean {
  return v === "withhold_context" || v === "withhold_ambiguous" || v === "unknown_term";
}

/**
 * A verdict for which no semantic correctness can be credited either way: the excerpt cannot
 * support a call (`insufficient_evidence`) or the concept is absent from the frozen registry
 * (`registry_gap`). Both are counted against the resolver in the worst-case view so neither can
 * inflate a bound; `registry_gap` is reported separately as a registry-coverage finding.
 */
export function isUnassessableVerdict(v: Verdict): boolean {
  return v === "insufficient_evidence" || v === "registry_gap";
}

/** Evidence labels are never "passed"/"failed" — a pilot is exploratory evidence only. */
export type EvidenceLabel =
  "exploratory" | "target_not_demonstrated" | "target_demonstrated" | "target_violated";

export interface StratumKey {
  readonly language: Language;
  readonly family: string;
  readonly resolverStatus: ResolverStatus;
}

/** A cell id is stable and human-readable; it contains the resolver status by design. */
export function stratumKey(k: StratumKey): string {
  return `${k.language}|${k.family}|${k.resolverStatus}`;
}

export function parseStratumKey(key: string): StratumKey | undefined {
  const parts = key.split("|");
  if (parts.length !== 3) return undefined;
  const [language, family, resolverStatus] = parts as [string, string, string];
  if (!LANGUAGES.includes(language as Language)) return undefined;
  if (family.length === 0) return undefined;
  if (!RESOLVER_STATUSES.includes(resolverStatus as ResolverStatus)) return undefined;
  return {
    language: language as Language,
    family,
    resolverStatus: resolverStatus as ResolverStatus,
  };
}

// ─── Record kinds ──────────────────────────────────────────────────────────

export interface ExampleSource {
  readonly id: string;
  readonly url?: string | undefined;
  readonly publishedAt?: string | undefined;
}

export interface ExampleContext {
  readonly domain?: string | undefined;
  readonly systemClass?: string | undefined;
  readonly subsystem?: string | undefined;
}

/**
 * A pre-existing analyst verdict is REFERENCE CONTEXT ONLY. It is never a label, never a second
 * vote, and is not shown in the blind review step.
 */
export interface PriorAnalystReview {
  readonly claimId: string;
  readonly verdict: string;
}

/** RAW: the frozen, versioned unit that the frame, the resolver and the reviewer all refer to. */
export interface Example {
  readonly exampleId: string;
  readonly sourceClusterId: string;
  readonly evidenceClusterId: string;
  readonly source: ExampleSource;
  readonly excerpt: string;
  /**
   * The stratum language. Schema 1.0.0: the frame row's `language` or else detection, as before.
   * Schema 1.1.0: `declaredLanguage` if present, else `detectedLanguage` if decisive, else
   * `unknown` (LANGUAGE_STRATUM_RULE).
   */
  readonly language: Language;
  /** 1.1.0: language stated by a trustworthy source. Never written from detection. */
  readonly declaredLanguage?: Language | undefined;
  /** 1.1.0: what detection said about the excerpt, kept even when a declared language wins. */
  readonly detectedLanguage?: Language | undefined;
  /** 1.1.0: whether detection was decisive. A non-decisive result never reaches the resolver. */
  readonly languageDetectionDecisive?: boolean | undefined;
  readonly languageDetectionReason?: LanguageDetectionReason | undefined;
  readonly rawKey: string;
  readonly rawLabel?: string | undefined;
  readonly rawValue?: string | undefined;
  readonly rawUnit?: string | undefined;
  readonly context: ExampleContext;
  readonly priorAnalystReview?: PriorAnalystReview | undefined;
  readonly family: string;
  readonly stratum: string;
  readonly resolverStatus: ResolverStatus;
  readonly origin: Origin;
  readonly isPilot: boolean;
  readonly frameId: string;
  readonly schemaVersion: string;
}

/** RESOLVER: a full result stamped with the snapshot that produced it. */
export interface Prediction {
  readonly exampleId: string;
  readonly result: SemanticResolutionResult;
  readonly snapshotHash: string;
  readonly resolverVersion: string;
}

/** AI: a suggestion only. Its status can never be `human_reviewed`. */
export interface Suggestion {
  readonly exampleId: string;
  readonly model: string;
  readonly promptHash: string;
  readonly proposed: {
    readonly verdict: Verdict;
    readonly canonicalId?: string | undefined;
    readonly candidates?: readonly string[] | undefined;
  };
  readonly rationale: string;
  readonly missingInfo: readonly string[];
  readonly status: "suggested";
}

/** HUMAN: blind verdict is the primary label; final verdict/revision are diagnostics only. */
export interface Decision {
  readonly exampleId: string;
  readonly blindVerdict: Verdict;
  readonly blindCanonicalId?: string | undefined;
  readonly blindNote: string;
  readonly finalVerdict: Verdict;
  readonly finalCanonicalId?: string | undefined;
  /** Description of a gap or other annotation introduced only after reveal; blank means none. */
  readonly finalNote?: string | undefined;
  readonly revisedAfterReveal: boolean;
  readonly revisionReason?: string | undefined;
  readonly reviewer: string;
  readonly reviewedAt: string;
  readonly protocolVersion: EvalProtocolVersion;
  readonly status: "human_reviewed";
}

// ─── Frame input and manifest ──────────────────────────────────────────────

/**
 * One raw extracted attribute before the frame is frozen. The occurrence locator is what makes
 * two occurrences of the same attribute in one text get two distinct exampleIds.
 */
export interface FrameRow {
  readonly sourceId: string;
  readonly url?: string | undefined;
  readonly publishedAt?: string | undefined;
  readonly rawKey: string;
  readonly rawLabel?: string | undefined;
  readonly rawValue?: string | undefined;
  readonly rawUnit?: string | undefined;
  readonly excerpt: string;
  /** Dispatch SimHash, when the frame exporter has it; used for source-cluster reporting. */
  readonly contentHash?: string | undefined;
  /** Occurrence index of this attribute within the source text; defaults to 0. */
  readonly occurrenceIndex?: number | undefined;
  readonly domain?: string | undefined;
  readonly systemClass?: string | undefined;
  readonly subsystem?: string | undefined;
  /**
   * LEGACY (schema 1.0.0): derived once from the excerpt and frozen; derived by the sampler when
   * absent. Overloaded: it holds both declared and detected language. A 1.1.0 frame reads it as an
   * author declaration (the committed fixture frames set it by hand) and prefers
   * `declaredLanguage` when both are present.
   */
  readonly language?: Language | undefined;
  /** Language stated by a trustworthy source or its metadata; never filled in by detection. */
  readonly declaredLanguage?: Language | undefined;
  readonly claimId?: string | undefined;
  readonly priorAnalystVerdict?: string | undefined;
  readonly origin?: Origin | undefined;
}

export interface Exclusion {
  readonly reason: string;
  readonly count: number;
}

export interface CellStat {
  readonly stratum: string;
  readonly language: Language;
  readonly family: string;
  readonly resolverStatus: ResolverStatus;
  readonly population: number;
  readonly drawn: number;
  readonly sampledExampleIds: readonly string[];
}

export interface SamplingManifest {
  readonly manifestVersion: string;
  readonly frameId: string;
  readonly seed: string;
  readonly cutoff: string;
  readonly ceiling: number;
  /** False only when the sampler explicitly left pilot mode (ceiling above 72). */
  readonly pilot: boolean;
  readonly familyCount: number;
  readonly languageCount: number;
  readonly resolverStatusCount: number;
  readonly resolverVersion: string;
  readonly snapshotHash: string;
  readonly populationCount: number;
  readonly drawnCount: number;
  readonly cells: readonly CellStat[];
  /** Persisted so the metrics report never has to invent coverage or concentration figures. */
  readonly emptyCells: readonly string[];
  readonly unsampledCells: readonly string[];
  /** Share of the population lying in cells that received at least one draw. */
  readonly coveredFraction: number;
  readonly concentration: readonly SourceConcentration[];
  readonly topShare: number;
  readonly exclusions: readonly Exclusion[];
  readonly examplesSha256: string;
  readonly predictionsSha256: string;
  /** Schema 1.1.0 frames only: the stratum language rule (LANGUAGE_STRATUM_RULE). */
  readonly languageRule?: string | undefined;
}

export interface SourceConcentration {
  readonly sourceClusterId: string;
  readonly units: number;
}
