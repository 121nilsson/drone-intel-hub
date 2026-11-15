/**
 * Phase 3 Hybrid Semantic Resolver — Isolated Pure Implementation
 *
 * This module provides a deterministic, in-memory, database-free semantic
 * resolver for Drone Intel Hub attribute names.
 *
 * SAFETY INVARIANTS:
 *   1. This resolver NEVER calls semanticKeyFor() — not even as a fallback.
 *      Unknown terms return status:"unresolved_unknown", canonicalId:undefined.
 *   2. Resolution is a pure function of (input, snapshot). Zero DB I/O.
 *   3. Snapshots are opaque: internal lookup maps are inaccessible to callers.
 *   4. All returned result objects are deeply frozen.
 *   5. Discriminated union ensures Class 1-3 always carry canonicalId, and
 *      Class 4 always carries candidateCanonicalIds (validated at compilation).
 *
 * BROWSER-SAFE: No imports from server-only or DB modules.
 */

import {
  CANONICAL_CONCEPTS,
  CANONICAL_MANIFEST_VERSION,
  isValidCanonicalId,
} from "./canonical-manifest";
import { sha256Hex } from "./sha256";
import { CANONICAL_UNIT, canonicalUnitFor, type Dimension } from "./units";
import type { GuardEvaluationAudit, SemanticResolutionResult } from "./semantic-result";

// ─── Public contracts ──────────────────────────────────────────────────────

export type { GuardEvaluationAudit, SemanticResolutionResult };

export type AliasLanguage = "all" | "en" | "uk" | "ru" | "sv" | "fa" | "zh";

export interface ContextGuards {
  /** systemClass values that satisfy this guard (any match is sufficient). */
  readonly systemClasses?: readonly string[];
  /** domain values that satisfy this guard. */
  readonly domains?: readonly string[];
  /** subsystem values that satisfy this guard. */
  readonly subsystems?: readonly string[];
  /** Physical dimension the caller's rawUnit must classify to (units.ts). */
  readonly unitDimension?: Dimension;
}

interface BaseAliasDefinition {
  readonly ruleId: string;
  readonly language: AliasLanguage;
  readonly rawKey: string;
  readonly labelTokens?: readonly string[];
  readonly rationale: string;
  readonly author: string;
}

/** Class 1, 2, and 3 rules: Must point to a valid canonicalId; cannot have candidate lists. */
export interface Class1_3AliasDefinition extends BaseAliasDefinition {
  readonly aliasClass: "class1_synonym" | "class2_context" | "class3_qualified";
  readonly canonicalId: string;
  readonly candidateCanonicalIds?: never;
  readonly contextGuards?: ContextGuards;
}

/** Class 4 rules: Known ambiguous term; must NOT have canonicalId; must provide candidate targets. */
export interface Class4AliasDefinition extends BaseAliasDefinition {
  readonly aliasClass: "class4_ambiguous";
  readonly canonicalId?: never;
  readonly candidateCanonicalIds: readonly string[];
  readonly contextGuards?: never;
}

/** Discriminated union strictly mirroring database table CHECK constraints. */
export type SemanticAliasDefinition = Class1_3AliasDefinition | Class4AliasDefinition;

/** Caller-supplied context for a resolution attempt. */
export interface ResolutionContextInput {
  readonly rawKey: string;
  readonly rawLabel?: string | undefined;
  readonly rawUnit?: string | undefined;
  readonly systemClass?: string | undefined;
  readonly domain?: string | undefined;
  readonly subsystem?: string | undefined;
  readonly language?: string | undefined;
}

/**
 * Opaque handle to a compiled, immutable semantic snapshot.
 * Internal lookup structures are not exposed; only resolve() is public.
 */
export interface ReadonlySemanticSnapshot {
  readonly snapshotId: string;
  readonly version: number;
  readonly contentHash: string;
  readonly manifestVersion: string;
  /** True when this snapshot was compiled from the hardcoded code seed only. */
  readonly isDegradedSeedOnly: boolean;
  readonly activatedAt: string;
  resolve(input: ResolutionContextInput): SemanticResolutionResult;
}

// ─── Key and label normalisation ───────────────────────────────────────────

/**
 * Version of the resolver engine. Bound into every snapshot content hash, so
 * changing normalisation or gate logic changes the hash. Bump on any change to
 * normalizeAliasKey, label matching, or gate order.
 */
export const SEMANTIC_RESOLVER_VERSION = "1.1.0";

const TRAILING_UNIT = /_(km|kmh|kg|m)$/;

/**
 * Deterministic alias key normaliser. Pure, bounded, and Unicode-aware.
 *
 * Policy:
 *   - NFKC first, so full-width / compatibility forms fold before anything else.
 *   - camelCase boundaries become delimiters, then lowercase.
 *   - Every run of non-letter/non-number characters (spaces, hyphens, dots,
 *     slashes, underscores, ...) is ONE delimiter "_". Delimiters are never
 *     deleted, so "air craft", "air-craft" and "air_craft" agree, and none of
 *     them collides with "aircraft".
 *   - Only the unambiguous unit artifacts _km, _kmh, _kg, _m are stripped.
 *     "_min", "_w" and "_l" are NOT stripped: "range_min" means minimum range.
 *   - Letters and numbers of every script are preserved (\p{L}, \p{N}).
 *   - The original term is never altered; callers keep rawKey beside the result.
 *
 * Gate 0 does NOT use this function, so canonical IDs keep their dots.
 */
export function normalizeAliasKey(key: string): string {
  const folded = key
    .normalize("NFKC")
    .trim()
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1_$2")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");

  let current = folded;
  for (;;) {
    const next = current.replace(TRAILING_UNIT, "");
    if (next === current || next === "") return current;
    current = next;
  }
}

/** Alias for backward-compatibility with earlier draft references. */
export const normalizeAttributeKey = normalizeAliasKey;

/** Whole-word tokens of a free-text label, normalised like alias keys. */
function labelTokenSet(label: string | undefined): ReadonlySet<string> {
  if (!label) return new Set();
  return new Set(
    label
      .normalize("NFKC")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 0),
  );
}

/** Tokens required by a rule, normalised the same way. Rejects regex-like tokens. */
function compileLabelTokens(ruleId: string, tokens: readonly string[]): readonly string[] {
  const out: string[] = [];
  for (const raw of tokens) {
    if (/\.[*+]|[\\^$|()[\]{}?]/.test(raw)) {
      throw new Error(
        `Snapshot compilation error: Rule '${ruleId}' has a regex-like label token '${raw}'`,
      );
    }
    for (const t of labelTokenSet(raw)) out.push(t);
  }
  if (out.length === 0) {
    throw new Error(`Snapshot compilation error: Rule '${ruleId}' has empty labelTokens`);
  }
  return Object.freeze([...new Set(out)].sort());
}

function labelTokensMatch(required: readonly string[], label: string | undefined): boolean {
  const present = labelTokenSet(label);
  return required.every((t) => present.has(t));
}

// ─── Internal compiled snapshot structure ──────────────────────────────────

interface CompiledGuards {
  readonly systemClasses?: readonly string[];
  readonly domains?: readonly string[];
  readonly subsystems?: readonly string[];
  readonly unitDimension?: Dimension;
}

interface EntryBase {
  readonly ruleId: string;
  readonly language: AliasLanguage;
}

interface CompiledDirect extends EntryBase {
  readonly kind: "direct";
  readonly canonicalId: string;
  readonly labelTokens?: readonly string[];
  readonly aliasClass: "class1_synonym" | "class3_qualified";
}

interface CompiledClass2 extends EntryBase {
  readonly kind: "context";
  readonly canonicalId: string;
  readonly contextGuards: CompiledGuards;
  readonly labelTokens?: readonly string[];
}

interface CompiledClass4 extends EntryBase {
  readonly kind: "ambiguous";
  readonly candidates: readonly string[];
}

type CompiledEntry = CompiledDirect | CompiledClass2 | CompiledClass4;

/** Every entry for a normalized key; language scoping is applied at resolve time. */
type CompiledLookups = ReadonlyMap<string, readonly CompiledEntry[]>;

const LANGUAGES: ReadonlySet<string> = new Set(["all", "en", "uk", "ru", "sv", "fa", "zh"]);

function scopesOverlap(a: AliasLanguage, b: AliasLanguage): boolean {
  return a === "all" || b === "all" || a === b;
}

/** A rule applies to a caller whose language is unknown only if it is language-neutral. */
function appliesToLanguage(rule: AliasLanguage, caller: string | undefined): boolean {
  return rule === "all" || (caller !== undefined && caller.trim().toLowerCase() === rule);
}

function freezeList(values: readonly string[] | undefined): readonly string[] | undefined {
  return values && values.length > 0 ? Object.freeze([...values]) : undefined;
}

function compileGuards(ruleId: string, guards: ContextGuards | undefined): CompiledGuards {
  const systemClasses = freezeList(guards?.systemClasses);
  const domains = freezeList(guards?.domains);
  const subsystems = freezeList(guards?.subsystems);
  const unitDimension = guards?.unitDimension;
  if (unitDimension !== undefined && !Object.hasOwn(CANONICAL_UNIT, unitDimension)) {
    throw new Error(
      `Snapshot compilation error: Class 2 rule '${ruleId}' has unknown unitDimension '${String(unitDimension)}'`,
    );
  }
  if (!systemClasses && !domains && !subsystems && unitDimension === undefined) {
    throw new Error(
      `Snapshot compilation error: Class 2 rule '${ruleId}' has no effective context guard`,
    );
  }
  return Object.freeze({
    ...(systemClasses ? { systemClasses } : {}),
    ...(domains ? { domains } : {}),
    ...(subsystems ? { subsystems } : {}),
    ...(unitDimension !== undefined ? { unitDimension } : {}),
  });
}

/**
 * Validates and copies rules into private structures. The caller's rule
 * objects and arrays are never retained, so mutating them after compilation
 * cannot change resolution. Class 2 candidates are sorted by ruleId, so the
 * outcome depends only on the rule set, never on its input order (matching the
 * order-independent content hash).
 */
function buildLookups(rules: readonly SemanticAliasDefinition[]): CompiledLookups {
  const byKey = new Map<string, CompiledEntry[]>();
  const seenRuleIds = new Set<string>();

  const add = (nk: string, entry: CompiledEntry): void => {
    const list = byKey.get(nk) ?? [];
    for (const other of list) {
      const bothContext = other.kind === "context" && entry.kind === "context";
      if (!bothContext && scopesOverlap(other.language, entry.language)) {
        throw new Error(
          `Snapshot compilation error: Rule '${entry.ruleId}' collides on normalized key '${nk}' with rule '${other.ruleId}'`,
        );
      }
    }
    list.push(entry);
    byKey.set(nk, list);
  };

  for (const rule of rules) {
    if (!rule.ruleId || seenRuleIds.has(rule.ruleId)) {
      throw new Error(
        `Snapshot compilation error: missing or duplicate ruleId '${String(rule.ruleId)}'`,
      );
    }
    seenRuleIds.add(rule.ruleId);

    if (!LANGUAGES.has(rule.language)) {
      throw new Error(
        `Snapshot compilation error: Rule '${rule.ruleId}' has unknown language '${String(rule.language)}'`,
      );
    }
    const nk = normalizeAliasKey(rule.rawKey);
    if (nk === "") {
      throw new Error(
        `Snapshot compilation error: Rule '${rule.ruleId}' has an empty normalized key`,
      );
    }
    const common = { ruleId: rule.ruleId, language: rule.language };

    if (rule.aliasClass === "class4_ambiguous") {
      if (rule.candidateCanonicalIds.length === 0) {
        throw new Error(
          `Snapshot compilation error: Class 4 rule '${rule.ruleId}' has no candidates`,
        );
      }
      for (const cand of rule.candidateCanonicalIds) {
        if (!isValidCanonicalId(cand)) {
          throw new Error(
            `Snapshot compilation error: Class 4 rule '${rule.ruleId}' specifies invalid canonical candidate '${cand}'`,
          );
        }
      }
      add(
        nk,
        Object.freeze({
          ...common,
          kind: "ambiguous" as const,
          candidates: Object.freeze([...rule.candidateCanonicalIds]),
        }),
      );
      continue;
    }

    if (!isValidCanonicalId(rule.canonicalId)) {
      throw new Error(
        `Snapshot compilation error: Rule '${rule.ruleId}' specifies invalid canonicalId '${rule.canonicalId}'`,
      );
    }
    const labelTokens = rule.labelTokens
      ? compileLabelTokens(rule.ruleId, rule.labelTokens)
      : undefined;

    if (rule.aliasClass === "class2_context") {
      add(
        nk,
        Object.freeze({
          ...common,
          kind: "context" as const,
          canonicalId: rule.canonicalId,
          contextGuards: compileGuards(rule.ruleId, rule.contextGuards),
          ...(labelTokens ? { labelTokens } : {}),
        }),
      );
      continue;
    }

    if (rule.contextGuards !== undefined) {
      throw new Error(
        `Snapshot compilation error: Rule '${rule.ruleId}' is ${rule.aliasClass} and must not carry context guards`,
      );
    }
    add(
      nk,
      Object.freeze({
        ...common,
        kind: "direct" as const,
        canonicalId: rule.canonicalId,
        aliasClass: rule.aliasClass,
        ...(labelTokens ? { labelTokens } : {}),
      }),
    );
  }

  for (const [k, list] of byKey) {
    const sorted = [...list].sort((a, b) =>
      a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0,
    );
    byKey.set(k, Object.freeze(sorted) as unknown as CompiledEntry[]);
  }
  return byKey;
}

// ─── Content addressing ────────────────────────────────────────────────────

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

const MANIFEST_HASH = sha256Hex(canonicalJson(CANONICAL_CONCEPTS));
const UNIT_TABLE_HASH = sha256Hex(canonicalJson(CANONICAL_UNIT));

/**
 * SHA-256 over resolver version, manifest version and hash, the canonical unit
 * table, and every rule (all fields, sorted by ruleId). Resolution is a pure
 * function of this digest's inputs plus the caller's context, and does not
 * depend on rule input order. Core-registry metadata is bound in Phase 3.3.
 */
function computeContentHash(rules: readonly SemanticAliasDefinition[]): string {
  const sorted = [...rules].sort((a, b) =>
    a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0,
  );
  return sha256Hex(
    canonicalJson({
      resolverVersion: SEMANTIC_RESOLVER_VERSION,
      manifestVersion: CANONICAL_MANIFEST_VERSION,
      manifestHash: MANIFEST_HASH,
      unitTableHash: UNIT_TABLE_HASH,
      rules: sorted,
    }),
  );
}

// ─── Guard evaluation ──────────────────────────────────────────────────────

const DIMENSION_BY_CANONICAL_UNIT: ReadonlyMap<string, Dimension> = new Map(
  (Object.keys(CANONICAL_UNIT) as Dimension[]).map((d) => [CANONICAL_UNIT[d], d]),
);

/** Physical dimension of a raw unit string, or undefined when it cannot be classified. */
function dimensionOfUnit(rawUnit: string | undefined): Dimension | undefined {
  if (!rawUnit || rawUnit.trim() === "") return undefined;
  const canonical = canonicalUnitFor(rawUnit);
  return canonical === undefined ? undefined : DIMENSION_BY_CANONICAL_UNIT.get(canonical);
}

/**
 * Evaluates EVERY declared guard (no short-circuit) so the audit records how
 * each one fared; the rule passes only if all are satisfied.
 */
function evaluateGuards(
  guards: CompiledGuards,
  ctx: ResolutionContextInput,
): { passed: boolean; audit: GuardEvaluationAudit[] } {
  const audit: GuardEvaluationAudit[] = [];
  const lists: Array<[string, readonly string[] | undefined, string | undefined]> = [
    ["systemClasses", guards.systemClasses, ctx.systemClass],
    ["domains", guards.domains, ctx.domain],
    ["subsystems", guards.subsystems, ctx.subsystem],
  ];
  for (const [guardName, expected, actual] of lists) {
    if (!expected) continue;
    audit.push({
      guardName,
      expected,
      actual,
      satisfied: actual !== undefined && expected.includes(actual),
    });
  }
  if (guards.unitDimension !== undefined) {
    const actual = dimensionOfUnit(ctx.rawUnit);
    audit.push({
      guardName: "unitDimension",
      expected: guards.unitDimension,
      actual,
      satisfied: actual === guards.unitDimension,
    });
  }
  return { passed: audit.every((a) => a.satisfied), audit };
}

// ─── Result builder ────────────────────────────────────────────────────────

/** Deep-frozen copy: no result shares a mutable reference with snapshot state. */
function frozenResult(r: SemanticResolutionResult): SemanticResolutionResult {
  return Object.freeze({
    ...r,
    candidateCanonicalIds: r.candidateCanonicalIds
      ? Object.freeze([...r.candidateCanonicalIds])
      : undefined,
    guardAudit: r.guardAudit
      ? Object.freeze(
          r.guardAudit.map((g) =>
            Object.freeze({
              ...g,
              expected:
                typeof g.expected === "string" ? g.expected : Object.freeze([...g.expected]),
            }),
          ),
        )
      : undefined,
    diagnostics: Object.freeze([...r.diagnostics]),
  });
}

function resolveWithLookups(
  input: ResolutionContextInput,
  lookups: CompiledLookups,
  snapshotHash: string,
  snapshotVersion: number,
): SemanticResolutionResult {
  const base = {
    snapshotHash,
    snapshotVersion,
    rawKey: input.rawKey,
    rawLabel: input.rawLabel,
  };

  // ── Gate 0: Exact canonical manifest identity ──────────────────────────
  const trimmedLower = input.rawKey.trim().toLowerCase();
  if (isValidCanonicalId(trimmedLower)) {
    return frozenResult({
      ...base,
      canonicalId: trimmedLower,
      status: "resolved",
      matchType: "canonical_identity",
      diagnostics: [],
    });
  }

  const nk = normalizeAliasKey(input.rawKey);
  const diagnostics: string[] = [];

  // Language scoping: only rules whose language is "all" or equals the caller's.
  const applicable = (lookups.get(nk) ?? []).filter((e) =>
    appliesToLanguage(e.language, input.language),
  );
  const direct = applicable.find((e): e is CompiledDirect => e.kind === "direct");
  const contexts = applicable.filter((e): e is CompiledClass2 => e.kind === "context");
  const ambiguous = applicable.find((e): e is CompiledClass4 => e.kind === "ambiguous");

  // ── Gates 1 and 3: direct Class 1 synonym / Class 3 qualified concept ──
  if (direct) {
    if (!direct.labelTokens || labelTokensMatch(direct.labelTokens, input.rawLabel)) {
      return frozenResult({
        ...base,
        canonicalId: direct.canonicalId,
        status: "resolved",
        aliasClass: direct.aliasClass,
        matchType: direct.labelTokens ? "token_bounded" : "literal_synonym",
        matchedRuleId: direct.ruleId,
        diagnostics: [],
      });
    }
    diagnostics.push(`Rule '${direct.ruleId}' matched the key but its label tokens were absent.`);
  }

  // ── Gate 2: Class 2 context-conditioned synonym ────────────────────────
  if (contexts.length > 0) {
    const passing: Array<{ entry: CompiledClass2; audit: GuardEvaluationAudit[] }> = [];
    let guardAuditForFail: GuardEvaluationAudit[] = [];

    for (const entry of contexts) {
      const { passed, audit } = evaluateGuards(entry.contextGuards, input);
      if (!passed) {
        guardAuditForFail = audit;
      } else if (!entry.labelTokens || labelTokensMatch(entry.labelTokens, input.rawLabel)) {
        passing.push({ entry, audit });
      } else {
        diagnostics.push(`Rule '${entry.ruleId}' guards passed but its label tokens were absent.`);
      }
    }

    if (passing.length > 0) {
      const ids = [...new Set(passing.map((p) => p.entry.canonicalId))];
      if (ids.length > 1) {
        return frozenResult({
          ...base,
          status: "unresolved_conflict",
          aliasClass: "class2_context",
          diagnostics: [
            `Conflicting Class 2 rules resolved to different concepts: ${ids.join(", ")}`,
          ],
        });
      }
      // contexts are sorted by ruleId, so "first" is the same for any input order.
      const first = passing[0]!;
      return frozenResult({
        ...base,
        canonicalId: first.entry.canonicalId,
        status: "resolved",
        aliasClass: "class2_context",
        matchType: first.entry.labelTokens ? "token_bounded" : "context_guard",
        matchedRuleId: first.entry.ruleId,
        guardAudit: first.audit,
        diagnostics: [],
      });
    }

    return frozenResult({
      ...base,
      status: "unresolved_context",
      aliasClass: "class2_context",
      guardAudit: guardAuditForFail,
      diagnostics: [
        ...diagnostics,
        ...guardAuditForFail
          .filter((g) => !g.satisfied)
          .map(
            (g) => `Context guard '${g.guardName}' failed: actual was ${g.actual ?? "undefined"}`,
          ),
      ],
    });
  }

  // ── Gate 4: Class 4 known ambiguous ────────────────────────────────────
  if (ambiguous) {
    return frozenResult({
      ...base,
      status: "unresolved_ambiguous",
      aliasClass: "class4_ambiguous",
      matchedRuleId: ambiguous.ruleId,
      candidateCanonicalIds: ambiguous.candidates,
      diagnostics: [
        `Term '${nk}' is known ambiguous: candidate interpretations: ${ambiguous.candidates.join(", ")}`,
      ],
    });
  }

  // ── Gate 5: Unknown terminology — hard stop ────────────────────────────
  return frozenResult({
    ...base,
    status: "unresolved_unknown",
    diagnostics: [
      ...diagnostics,
      `Term '${nk}' is not indexed in the active snapshot (v${snapshotVersion}).`,
    ],
  });
}

// ─── Snapshot compiler ─────────────────────────────────────────────────────

/**
 * Compiles rules into an opaque, immutable snapshot. The content hash is
 * computed here from the rules and code-owned versions; it cannot be supplied.
 */
export function compileSemanticSnapshot(
  rules: readonly SemanticAliasDefinition[],
  options: {
    snapshotId?: string;
    version?: number;
    isDegradedSeedOnly?: boolean;
    activatedAt?: string;
  } = {},
): ReadonlySemanticSnapshot {
  const lookups = buildLookups(rules);
  const contentHash = computeContentHash(rules);
  const snapshotId = options.snapshotId ?? `snap-${contentHash.slice(0, 12)}`;
  const version = options.version ?? 0;
  const isDegradedSeedOnly = options.isDegradedSeedOnly ?? true;
  const activatedAt = options.activatedAt ?? new Date().toISOString();

  return Object.freeze({
    snapshotId,
    version,
    contentHash,
    manifestVersion: CANONICAL_MANIFEST_VERSION,
    isDegradedSeedOnly,
    activatedAt,
    resolve(input: ResolutionContextInput): SemanticResolutionResult {
      return resolveWithLookups(input, lookups, contentHash, version);
    },
  });
}

// ─── Code seed snapshot ────────────────────────────────────────────────────

const CODE_SEED_RULES: readonly SemanticAliasDefinition[] = Object.freeze([
  // ── Class 1: Speed ───────────────────────────────────────────────────────
  {
    ruleId: "seed-speed-max-en-1",
    canonicalId: "speed.max",
    aliasClass: "class1_synonym",
    language: "all",
    rawKey: "top_speed",
    rationale: "Universal unambiguous synonym for maximum speed.",
    author: "phase3-seed",
  },
  {
    ruleId: "seed-speed-max-en-2",
    canonicalId: "speed.max",
    aliasClass: "class1_synonym",
    language: "all",
    rawKey: "maximum_speed",
    rationale: "Direct English synonym for maximum speed.",
    author: "phase3-seed",
  },
  {
    ruleId: "seed-speed-max-en-3",
    canonicalId: "speed.max",
    aliasClass: "class1_synonym",
    language: "all",
    rawKey: "max_speed",
    rationale: "Abbreviated English synonym for maximum speed.",
    author: "phase3-seed",
  },
  {
    ruleId: "seed-speed-max-en-4",
    canonicalId: "speed.max",
    aliasClass: "class1_synonym",
    language: "all",
    rawKey: "vmax",
    rationale: "Aeronautical abbreviation for maximum airspeed.",
    author: "phase3-seed",
  },

  // ── Class 3: Speed — qualified distinct concepts ──────────────────────────
  {
    ruleId: "seed-speed-cruise-en-1",
    canonicalId: "speed.cruise",
    aliasClass: "class3_qualified",
    language: "all",
    rawKey: "cruising_speed",
    rationale: "Cruise speed is distinct from max speed; must not collapse into speed.max.",
    author: "phase3-seed",
  },
  {
    ruleId: "seed-speed-cruise-en-2",
    canonicalId: "speed.cruise",
    aliasClass: "class3_qualified",
    language: "all",
    rawKey: "cruise_speed",
    rationale: "Cruise speed is distinct from max speed; must not collapse into speed.max.",
    author: "phase3-seed",
  },
  {
    ruleId: "seed-speed-cruise-en-3",
    canonicalId: "speed.cruise",
    aliasClass: "class3_qualified",
    language: "all",
    rawKey: "speed_cruise",
    rationale: "Inverted word-order variant of cruise speed.",
    author: "phase3-seed",
  },

  // ── Class 1: Range ────────────────────────────────────────────────────────
  {
    ruleId: "seed-range-max-en-1",
    canonicalId: "range.max",
    aliasClass: "class1_synonym",
    language: "all",
    rawKey: "max_range",
    rationale: "Direct synonym for maximum range.",
    author: "phase3-seed",
  },
  {
    ruleId: "seed-range-max-en-2",
    canonicalId: "range.max",
    aliasClass: "class1_synonym",
    language: "all",
    rawKey: "maximum_range",
    rationale: "Direct synonym for maximum range.",
    author: "phase3-seed",
  },

  // ── Class 3: Range — combat radius ───────────────────────────────────────
  {
    ruleId: "seed-range-combatradius-en-1",
    canonicalId: "range.combat_radius",
    aliasClass: "class3_qualified",
    language: "all",
    rawKey: "combat_radius",
    rationale:
      "Combat radius is an outbound-only mission distance, distinct from max/operational range.",
    author: "phase3-seed",
  },

  // ── Class 1: Altitude ─────────────────────────────────────────────────────
  {
    ruleId: "seed-altitude-max-en-1",
    canonicalId: "altitude.max",
    aliasClass: "class1_synonym",
    language: "all",
    rawKey: "max_altitude",
    rationale: "Direct synonym for maximum altitude / absolute ceiling.",
    author: "phase3-seed",
  },
  {
    ruleId: "seed-altitude-max-en-2",
    canonicalId: "altitude.max",
    aliasClass: "class1_synonym",
    language: "all",
    rawKey: "maximum_altitude",
    rationale: "Direct synonym for maximum altitude.",
    author: "phase3-seed",
  },
  {
    ruleId: "seed-altitude-max-en-3",
    canonicalId: "altitude.max",
    aliasClass: "class1_synonym",
    language: "all",
    rawKey: "operational_altitude",
    rationale:
      "In OSINT reporting this almost always refers to the operational ceiling, not a service ceiling.",
    author: "phase3-seed",
  },

  // ── Class 3: Altitude — service ceiling ──────────────────────────────────
  {
    ruleId: "seed-altitude-svc-en-1",
    canonicalId: "altitude.service_ceiling",
    aliasClass: "class3_qualified",
    language: "all",
    rawKey: "service_ceiling",
    rationale: "Service ceiling is the aeronautical ceiling, distinct from absolute max altitude.",
    author: "phase3-seed",
  },

  // ── Class 1: Payload & Weight ─────────────────────────────────────────────
  {
    ruleId: "seed-payload-capacity-en-1",
    canonicalId: "payload.capacity",
    aliasClass: "class1_synonym",
    language: "all",
    rawKey: "payload_capacity",
    rationale: "Direct synonym for payload carrying capacity.",
    author: "phase3-seed",
  },
  {
    ruleId: "seed-payload-capacity-en-2",
    canonicalId: "payload.capacity",
    aliasClass: "class1_synonym",
    language: "all",
    rawKey: "max_payload",
    rationale: "Maximum payload is payload capacity.",
    author: "phase3-seed",
  },

  // ── Class 3: Payload — warhead ────────────────────────────────────────────
  {
    ruleId: "seed-payload-warhead-en-1",
    canonicalId: "payload.warhead",
    aliasClass: "class3_qualified",
    language: "all",
    rawKey: "warhead_weight",
    rationale:
      "Warhead mass is a specific explosive-charge measurement, distinct from general payload capacity.",
    author: "phase3-seed",
  },
  {
    ruleId: "seed-payload-warhead-en-2",
    canonicalId: "payload.warhead",
    aliasClass: "class3_qualified",
    language: "all",
    rawKey: "warhead_mass",
    rationale: "Warhead mass synonym.",
    author: "phase3-seed",
  },

  // ── Class 1: Weight ───────────────────────────────────────────────────────
  {
    ruleId: "seed-weight-mtow-en-1",
    canonicalId: "weight.mtow",
    aliasClass: "class1_synonym",
    language: "all",
    rawKey: "mtow",
    rationale: "MTOW is the ICAO abbreviation for maximum takeoff weight.",
    author: "phase3-seed",
  },
  {
    ruleId: "seed-weight-mtow-en-2",
    canonicalId: "weight.mtow",
    aliasClass: "class1_synonym",
    language: "all",
    rawKey: "max_takeoff_weight",
    rationale: "Maximum takeoff weight — standard English form of MTOW.",
    author: "phase3-seed",
  },
  {
    ruleId: "seed-weight-total-en-1",
    canonicalId: "weight.total",
    aliasClass: "class1_synonym",
    language: "all",
    rawKey: "total_weight",
    rationale: "Stated total/gross system weight.",
    author: "phase3-seed",
  },

  // ── Class 1: Dimensions ───────────────────────────────────────────────────
  {
    ruleId: "seed-dim-wingspan-en-1",
    canonicalId: "dimension.wingspan",
    aliasClass: "class1_synonym",
    language: "all",
    rawKey: "wingspan",
    rationale: "Direct match — wing span is unambiguous.",
    author: "phase3-seed",
  },
  {
    ruleId: "seed-dim-wingspan-en-2",
    canonicalId: "dimension.wingspan",
    aliasClass: "class1_synonym",
    language: "all",
    rawKey: "wing_span",
    rationale: "Hyphenated/spaced variant of wingspan.",
    author: "phase3-seed",
  },

  // ── Class 2: Dimension.width — context-conditioned on Sea domain ──────────
  {
    ruleId: "seed-dim-width-beam-sea",
    canonicalId: "dimension.width",
    aliasClass: "class2_context",
    language: "all",
    rawKey: "beam",
    contextGuards: { domains: ["Sea"] },
    rationale:
      "In naval architecture 'beam' unambiguously means hull width. On non-Sea platforms the term is polysemous.",
    author: "phase3-seed",
  },

  // ── Class 2: bare weight — only with a mass unit ──────────────────────────
  {
    ruleId: "seed-weight-total-mass-unit",
    canonicalId: "weight.total",
    aliasClass: "class2_context",
    language: "all",
    rawKey: "weight",
    contextGuards: { unitDimension: "mass" },
    rationale:
      "Bare 'weight' is a stated total weight only when its unit is a mass; an angle or ratio unit fails safe.",
    author: "phase3-seed",
  },

  // ── Class 1: Power ────────────────────────────────────────────────────────
  {
    ruleId: "seed-power-rf-en-1",
    canonicalId: "power.rf",
    aliasClass: "class1_synonym",
    language: "all",
    rawKey: "jamming_power",
    rationale: "Jamming power unambiguously refers to RF transmitter output power.",
    author: "phase3-seed",
  },
  {
    ruleId: "seed-power-engine-en-1",
    canonicalId: "power.engine",
    aliasClass: "class1_synonym",
    language: "all",
    rawKey: "engine_power",
    rationale: "Engine power unambiguously refers to propulsion output.",
    author: "phase3-seed",
  },

  // ── Class 1: Endurance ────────────────────────────────────────────────────
  {
    ruleId: "seed-endurance-flight-en-1",
    canonicalId: "endurance.flight",
    aliasClass: "class1_synonym",
    language: "all",
    rawKey: "flight_endurance",
    rationale: "Direct synonym for flight endurance.",
    author: "phase3-seed",
  },
  {
    ruleId: "seed-endurance-flight-en-2",
    canonicalId: "endurance.flight",
    aliasClass: "class1_synonym",
    language: "all",
    rawKey: "endurance",
    rationale: "In UAS OSINT context, bare 'endurance' almost always means flight time.",
    author: "phase3-seed",
  },

  // ── Class 1: Maneuver ─────────────────────────────────────────────────────
  {
    ruleId: "seed-maneuver-gload-en-1",
    canonicalId: "maneuver.load_factor_max",
    aliasClass: "class1_synonym",
    language: "all",
    rawKey: "max_g",
    rationale: "Max G / g-limit is the structural load factor ceiling, not a mass.",
    author: "phase3-seed",
  },
  {
    ruleId: "seed-maneuver-gload-en-2",
    canonicalId: "maneuver.load_factor_max",
    aliasClass: "class1_synonym",
    language: "all",
    rawKey: "g_limit",
    rationale: "g-limit is the structural load factor ceiling.",
    author: "phase3-seed",
  },
  {
    ruleId: "seed-maneuver-gload-en-3",
    canonicalId: "maneuver.load_factor_max",
    aliasClass: "class1_synonym",
    language: "all",
    rawKey: "load_factor",
    rationale: "Load factor — ratio of lift to weight, measured in g.",
    author: "phase3-seed",
  },

  // ── Class 4: Known ambiguous terms (never auto-resolved) ──────────────────
  {
    ruleId: "seed-ambig-radius",
    aliasClass: "class4_ambiguous",
    language: "all",
    rawKey: "radius",
    candidateCanonicalIds: ["range.combat_radius", "range.engagement"],
    rationale: "Bare 'radius' is polysemous: combat radius or EW suppression/engagement radius.",
    author: "phase3-seed",
  },
  {
    ruleId: "seed-ambig-power",
    aliasClass: "class4_ambiguous",
    language: "all",
    rawKey: "power",
    candidateCanonicalIds: ["power.rf", "power.engine"],
    rationale: "Bare 'power' is polysemous: RF transmitter power (W) vs engine power (kW/hp).",
    author: "phase3-seed",
  },
  {
    ruleId: "seed-ambig-capacity",
    aliasClass: "class4_ambiguous",
    language: "all",
    rawKey: "capacity",
    candidateCanonicalIds: ["payload.capacity", "capacity.fuel", "capacity.target_channels"],
    rationale:
      "Bare 'capacity' is polysemous: payload mass (kg), fuel volume (l), or target channels.",
    author: "phase3-seed",
  },
]);

export const CODE_SEED_SNAPSHOT: ReadonlySemanticSnapshot = compileSemanticSnapshot(
  CODE_SEED_RULES,
  {
    snapshotId: "snap-code-seed-v1",
    version: 0,
    isDegradedSeedOnly: true,
  },
);
