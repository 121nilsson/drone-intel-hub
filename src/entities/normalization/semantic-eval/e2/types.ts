/**
 * E2 pipeline, step a: schema 1.2.0 types, rule constants and the resolver-language rule.
 *
 * BOUNDARY: pure data, like the rest of semantic-eval. Nothing outside semantic-eval may import
 * this directory. Schema 1.2.0 is a separate pipeline: the 1.0.0 and 1.1.0 types, validators and
 * `SUPPORTED_SCHEMA_VERSIONS` do not know it, and a 1.2.0 record goes only through `./validate`.
 *
 * Detection (D0) is deliberately NOT stored on a 1.2.0 example. The routing stratum is the only
 * derived language-like field, it is an allocation key, and no rule reads a detector result. This
 * is the simpler of the two allowed options; a later schema may add optional provenance.
 */

import type { Origin } from "../types";

export const E2_SCHEMA_VERSION = "1.2.0";

/**
 * The language adjudication protocol (docs/semantic-resolver-v1.3.0-e2-adjudication-protocol.md).
 * It is its own version string: the 1.0.0 decision protocol (`protocol-v1`) is a different thing.
 */
export const E2_ADJUDICATION_PROTOCOL_VERSION = "e2-lang-1";
export type E2AdjudicationProtocolVersion = "e2-lang-1";
export const E2_ADJUDICATION_PROTOCOL_VERSIONS: readonly E2AdjudicationProtocolVersion[] = [
  E2_ADJUDICATION_PROTOCOL_VERSION,
];

/** Commit of the pre-D0 language rule that defines the routing stratum. */
export const E2_ROUTING_RULE_SOURCE_COMMIT = "7aea9a6";

export const E2_ROUTING_RULE =
  "pre-D0 detectLanguage (commit 7aea9a6) applied to the stored excerpt (<= 300 characters); " +
  "an evaluation allocation key only, not production routing and not a language claim";

export const E2_RESOLVER_LANGUAGE_RULE =
  "resolver language = declaredLanguage when present (en, ru or uk); otherwise " +
  "adjudicatedLanguage when it is en, ru or uk; otherwise unknown (adjudicated mixed and " +
  "unknown, or no adjudication, give unknown); detectedLanguage is never an input";

/** Allocation key only: never resolver input, never called a language stratum. */
export type RoutingStratum = "en" | "ru" | "uk" | "unknown";
export const ROUTING_STRATA: readonly RoutingStratum[] = ["en", "ru", "uk", "unknown"];

/** Declared language in 1.2.0: en, ru or uk, or absent. `unknown` is invalid; absent = undeclared. */
export type E2DeclaredLanguage = "en" | "ru" | "uk";
export const E2_DECLARED_LANGUAGES: readonly E2DeclaredLanguage[] = ["en", "ru", "uk"];

/** Established by blind human review before the freeze. Its own type; never widens `Language`. */
export type AdjudicatedLanguage = "en" | "ru" | "uk" | "mixed" | "unknown";
export const ADJUDICATED_LANGUAGES: readonly AdjudicatedLanguage[] = [
  "en",
  "ru",
  "uk",
  "mixed",
  "unknown",
];

/** What the resolver is given; `undefined` means unknown. */
export type E2ResolverLanguage = "en" | "ru" | "uk";

/** Provenance excerpts keep the freeze's rule: at most 300 characters, 299 plus an ellipsis. */
export const E2_MAX_EXCERPT_CHARS = 300;

export interface E2ExampleSource {
  readonly id: string;
  readonly url?: string | undefined;
  readonly publishedAt?: string | undefined;
}

export interface E2ExampleContext {
  readonly domain?: string | undefined;
  readonly systemClass?: string | undefined;
  readonly subsystem?: string | undefined;
}

/** A frozen E2 population row. `excerpt` is the stored (truncated) excerpt the routing key used. */
export interface E2Example {
  readonly exampleId: string;
  readonly sourceClusterId: string;
  readonly evidenceClusterId: string;
  readonly source: E2ExampleSource;
  readonly excerpt: string;
  readonly routingStratum: RoutingStratum;
  readonly declaredLanguage?: E2DeclaredLanguage | undefined;
  readonly rawKey: string;
  readonly rawLabel?: string | undefined;
  readonly rawValue?: string | undefined;
  readonly rawUnit?: string | undefined;
  readonly context: E2ExampleContext;
  readonly family: string;
  readonly origin: Origin;
  readonly frameId: string;
  readonly schemaVersion: typeof E2_SCHEMA_VERSION;
}

/**
 * One reviewer's adjudication of an example, optionally with a second reviewer.
 *
 * A disagreement (two reviewers, different languages) is never resolved by order. It is valid only
 * with `disagreement: true`, an explicit `resolvedBy` (who made the call) and an explicit
 * `finalAdjudicatedLanguage`. Without a disagreement `resolvedBy` must be absent and the final
 * value must equal the agreed value.
 */
export interface E2Adjudication {
  readonly exampleId: string;
  readonly reviewerId: string;
  readonly protocolVersion: E2AdjudicationProtocolVersion;
  readonly reviewerLanguage: AdjudicatedLanguage;
  readonly secondReviewerId?: string | undefined;
  readonly secondReviewerLanguage?: AdjudicatedLanguage | undefined;
  readonly finalAdjudicatedLanguage: AdjudicatedLanguage;
  readonly disagreement: boolean;
  readonly resolvedBy?: string | undefined;
  readonly note?: string | undefined;
}

// ─── Stage manifests (a hash chain; a frozen stage is never rewritten) ─────

export interface E2Exclusion {
  readonly reason: string;
  readonly count: number;
}

/** Stage 1. Every population row is in exactly one routing stratum, so Σ N_h = N. */
export interface E2PopulationManifest {
  readonly stage: "population";
  readonly schemaVersion: typeof E2_SCHEMA_VERSION;
  readonly routingRule: string;
  readonly routingRuleSourceCommit: string;
  readonly cutoff: string;
  readonly frameId: string;
  /** SHA-256 of the exact bytes of the read-only population export, before any freeze or dedupe. */
  readonly rawExportSha256: string;
  readonly populationRowsSha256: string;
  readonly populationCount: number;
  readonly stratumCounts: Readonly<Record<RoutingStratum, number>>;
  readonly exclusions: readonly E2Exclusion[];
}

/**
 * Per-stratum allocation. `pi` and `w` are exact rational strings in the unreduced form
 * `"<n_h>/<N_h>"` and `"<N_h>/<n_h>"` (no floating point); the validator rebuilds and compares
 * the strings. An empty stratum (N_h = 0) has n_h = 0, `census: true` and `pi`/`w` null.
 */
export interface E2StratumAllocation {
  readonly stratum: RoutingStratum;
  readonly populationCount: number;
  readonly sampleCount: number;
  readonly census: boolean;
  readonly pi: string | null;
  readonly w: string | null;
}

/** Stage 2. */
export interface E2SampleManifest {
  readonly stage: "sample";
  readonly schemaVersion: typeof E2_SCHEMA_VERSION;
  readonly populationManifestSha256: string;
  readonly seed: string;
  readonly n: number;
  readonly m: number;
  readonly strata: readonly E2StratumAllocation[];
  readonly redistributionRounds: number;
  readonly drawnExampleIds: readonly string[];
  readonly drawnRowsSha256: string;
}

/** One group of drawn rows whose identical excerpts received different final languages. */
export interface E2IdenticalExcerptConflict {
  readonly excerptSha256: string;
  readonly exampleIds: readonly string[];
}

/**
 * Stage 3. `disagreementCount` counts reviewer disagreements that WERE explicitly resolved in this
 * freeze. The flagged fields below are different: they are conflicts the tool only reports, never
 * resolves. Declared language keeps precedence for resolver input, and an identical-excerpt conflict
 * is left for explicit human review; original annotations are preserved either way.
 */
export interface E2AdjudicationManifest {
  readonly stage: "adjudication";
  readonly schemaVersion: typeof E2_SCHEMA_VERSION;
  readonly sampleManifestSha256: string;
  readonly adjudicationSha256: string;
  readonly protocolVersion: E2AdjudicationProtocolVersion;
  readonly reviewerIds: readonly string[];
  readonly secondReviewerUsed: boolean;
  readonly disagreementCount: number;
  readonly flaggedDeclaredAdjudicatedConflictCount: number;
  readonly flaggedDeclaredAdjudicatedExampleIds: readonly string[];
  readonly flaggedIdenticalExcerptConflictCount: number;
  readonly flaggedIdenticalExcerptConflicts: readonly E2IdenticalExcerptConflict[];
  readonly frozenAt: string;
}

/**
 * Stage 4. `evaluatedAt` is the actual evaluation time, and `frozenArtifactsCommit` names the commit
 * in which the frozen artifacts are recorded; an independent reviewer verifies both against git
 * history and the recorded artifact hashes. A timestamp alone is not proof of execution order.
 */
export interface E2EvaluationManifest {
  readonly stage: "evaluation";
  readonly schemaVersion: typeof E2_SCHEMA_VERSION;
  readonly adjudicationManifestSha256: string;
  /** Direct hash of the exact population-manifest file text, for independent verification. */
  readonly populationManifestSha256: string;
  /** Direct hash of the exact adjudications.jsonl text, for independent verification. */
  readonly adjudicationRowsSha256: string;
  readonly evaluatedAt: string;
  readonly frozenArtifactsCommit: string;
  readonly resolverLanguageRule: string;
  readonly snapshotHash: string;
  readonly resolverVersion: string;
  readonly predictionsSha256: string;
}

/** Supplied at run time: the CLI owns the clock and the operator-supplied commit reference. */
export interface E2RunProvenance {
  readonly evaluatedAt: string;
  readonly frozenArtifactsCommit: string;
}
