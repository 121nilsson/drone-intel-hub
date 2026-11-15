/**
 * Structured output types for the Phase 3 Hybrid Semantic Resolver.
 *
 * These types are pure data contracts: browser-safe, server-safe, no imports from
 * server-only or database modules.
 *
 * BOUNDARY: This file is owned by entities/normalization. It may be imported by
 * shared/contracts (upward in FSD), never by features or routes.
 */

/**
 * Categorical outcome of a semantic resolution attempt.
 *
 * "resolved" is the only state in which canonicalId is defined.
 * All unresolved states carry canonicalId: undefined and must be handled
 * explicitly by callers — no silent identity-fallback is ever returned.
 */
export type SemanticResolutionStatus =
  | "resolved" // Successfully matched an approved Class 1, 2, or 3 rule
  | "unresolved_context" // Class 2 rule matched name, but context guards failed or were missing
  | "unresolved_conflict" // Multiple mutually incompatible rules matched with equal precedence
  | "unresolved_ambiguous" // Matched an approved Class 4 ambiguous entry
  | "unresolved_unknown" // Term is completely unindexed in the active snapshot
  | "unresolved_deprecated"; // Matched rule is marked deprecated without a valid superseding target

/** The specific rule mechanism that produced the resolution. */
export type SemanticMatchType =
  | "canonical_identity" // Exact match against CANONICAL_CONCEPTS manifest (Gate 0)
  | "literal_synonym" // Exact normalized-key match (Gate 1 / Gate 3)
  | "token_bounded" // Normalized key match plus whole-token label match
  | "context_guard"; // Class 2 context-conditioned match (Gate 2)

/** Audit record for a single context guard evaluated during Class 2 resolution. */
export interface GuardEvaluationAudit {
  readonly guardName: string;
  readonly expected: string | readonly string[];
  readonly actual: string | undefined;
  readonly satisfied: boolean;
}

/**
 * Complete, structured result of a single semantic resolution attempt.
 *
 * Key invariants:
 *   - canonicalId is defined IF AND ONLY IF status === "resolved".
 *   - snapshotHash and snapshotVersion identify exactly which snapshot was
 *     used so any result can be reproduced deterministically.
 *   - rawKey is always preserved unconditionally.
 *   - diagnostics is always a (possibly empty) readonly array — never undefined.
 */
export interface SemanticResolutionResult {
  /** The validated canonical semantic concept. Defined IF AND ONLY IF status === "resolved". */
  readonly canonicalId?: string | undefined;

  /** Comprehensive categorical outcome of the resolution attempt. */
  readonly status: SemanticResolutionStatus;

  /** Operational classification of the matched alias (if any). */
  readonly aliasClass?:
    "class1_synonym" | "class2_context" | "class3_qualified" | "class4_ambiguous" | undefined;

  /** The specific rule mechanism that produced the resolution. */
  readonly matchType?: SemanticMatchType | undefined;

  /** Unique identifier of the matched rule in the active snapshot (if any). */
  readonly matchedRuleId?: string | undefined;

  /** Candidate concepts of a known-ambiguous term. Defined only for "unresolved_ambiguous". */
  readonly candidateCanonicalIds?: readonly string[] | undefined;

  /** Detailed audit log of context guards evaluated for Class 2 rules. */
  readonly guardAudit?: readonly GuardEvaluationAudit[] | undefined;

  /** Immutable content hash of the snapshot used for this resolution. */
  readonly snapshotHash: string;

  /** Monotonic version counter of the snapshot used for this resolution. */
  readonly snapshotVersion: number;

  /** Original raw key, preserved unconditionally. */
  readonly rawKey: string;

  /** Original raw label, preserved unconditionally (if supplied). */
  readonly rawLabel?: string | undefined;

  /** Explanatory notes or diagnostic error messages. Never undefined. */
  readonly diagnostics: readonly string[];
}
