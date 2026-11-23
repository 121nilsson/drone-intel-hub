# Drone Intel Hub – Phase 3: Hybrid Semantic Registry Specification

## Architecture, Canonical Identity Governance, Deterministic Resolution, and Validation Model

---

## 1. Executive Summary

Drone Intel Hub extracts, normalizes, verifies, and analyzes technical specifications and operational data concerning unmanned systems and counter-drone capabilities across multilingual OSINT sources (news dispatches, manufacturer brochures, defence analytics, and field reports). A recurring architectural challenge is the semantic variation of extracted attribute names. Different sources express identical technical concepts using diverse languages, transliterations, synonyms, domain-specific abbreviations, and varying levels of technical precision.

Currently, the resolution of raw attribute keys to canonical semantic concepts is handled by a hardcoded, procedural TypeScript routine ([`src/entities/normalization/semantic.ts`](../src/entities/normalization/semantic.ts)). When an extracted key or label does not match an internal rule, the function silently returns the raw key unchanged (_identity fallback_). Furthermore, physical dimension and unit assignments rely on prefix matching ([`src/entities/normalization/core-registry.ts`](../src/entities/normalization/core-registry.ts)), which cannot distinguish whether a semantic identifier represents a genuine, registered concept.

This document establishes the architecture for **Phase 3: The Hybrid Semantic Registry**. It addresses previous architectural shortcomings and defines:

1. **A Strict Separation of Three Registry Concerns:**
   - _Canonical Semantic Concepts:_ A closed, code-owned manifest of valid technical concepts.
   - _Physical and Consensus Metadata:_ Authoritative physical units, dimensions, conversion factors, and consensus tolerances owned by the code core ([`core-registry.ts`](../src/entities/normalization/core-registry.ts) and [`units.ts`](../src/entities/normalization/units.ts)).
   - _Terminology and Alias Mappings:_ An extensible, versioned, database-backed inventory of multilingual terminology and context rules, consumed strictly via compiled, immutable snapshots.
2. **A Corrected Four-Class Alias Model:** Class 1 (Canonical Synonyms), Class 2 (Context-Conditioned Synonyms), Class 3 (Qualified Distinct Concepts), and Class 4 (Known Ambiguous Candidates), alongside an explicit state for _Unknown Terminology_.
3. **Structured Resolution Metadata Instead of Uncalibrated Probabilities:** Deterministic resolution states, match types, matched rule IDs, and guard audit trails replace arbitrary floating-point confidence scores.
4. **Guaranteed Historical Reproducibility:** Content-addressed snapshot hashes, append-only revisions, runtime immutability, and zero network/database dependencies during resolution.
5. **A Non-Destructive Offline Replay Strategy:** Initial Phase 3 validation runs offline against frozen fixtures and reference sets, completely isolated from production ingest hot paths, consensus calculations, and audit gates.

---

## 2. Scope, Non-Goals, and Safety Invariants

### Scope

- Formalize the canonical semantic concept vocabulary for unmanned systems and counter-drone technical attributes.
- Define an extensible, versioned database schema for terminology aliases, language variants, and context guards.
- Specify a pure, deterministic in-memory snapshot compiler and resolver.
- Design an offline shadow-mode replay methodology to evaluate coverage, parity, and semantic accuracy against existing data without modifying production claims.
- Define strict boundaries separating semantic resolution from taxonomy classification, unit conversion, numeric parsing, claim verification, and relationship extraction.

### Explicit Non-Goals

- **No Production Ingest Integration in Initial Work:** The initial resolver runs in isolation and offline replay; it does not replace or wrap `semanticKeyFor()` inside [`src/entities/normalization/apply.ts`](../src/entities/normalization/apply.ts).
- **No Production Claim or Consensus Alteration:** Phase 3 must not change any existing claim value, unit, consensus grouping, catalog status, or verification verdict.
- **No Autonomous Writes to Active Semantics:** `AUTO_APPLY_TIERS` remains strictly empty (`[]`). All new aliases, promotions, and deprecations require human review.
- **No Replacement of Existing Taxonomies:** The registry does not duplicate the propulsion, installation, or protocol taxonomies in [`src/entities/normalization/taxonomy.ts`](../src/entities/normalization/taxonomy.ts).
- **No Arbitrary Regex DSL:** User- or AI-supplied unstructured regular expressions are prohibited. Matching relies on literal strings, bounded word tokens, and validated context guards.

### Mandatory Safety Invariants

1. **The Analyst Outranks Automation:** An analyst's manual attribute assignment or review verdict unconditionally supersedes any automated semantic mapping.
2. **Deterministic Reproducibility:** Given identical input text, context metadata, and snapshot identity, the resolver must produce the identical resolution outcome.
3. **Safe Default for Ambiguity:** If context is missing, conflicting, or the term is ambiguous, the resolver must fail safe to an explicit unresolved state. It must never guess.
4. **Complete Separation from Truth:** Successful semantic resolution verifies only what an attribute name means, never that the underlying factual claim or measurement is true.
5. **No Phantom Physical Metadata:** An unmapped or unresolved attribute must never be assigned canonical units, dimensions, plausibility bounds, or consensus tolerances.
6. **No Backdoor Fallback to Legacy Code:** Legacy `semanticKeyFor()` is maintained strictly as a frozen baseline for comparative evaluation and continues serving existing un-migrated production callers. The new hybrid resolver must **never** call `semanticKeyFor()` as a fallback when an attribute cannot be mapped. Calling legacy code on failure would reintroduce the silent identity fallback (`return key`) and regex guessing through a backdoor. When the new resolver cannot resolve a term, it terminates with an explicit unmapped state (`canonicalId: undefined`).

---

## 3. Current Repository Architecture Findings

The following findings were verified against repository `121nilsson/drone-intel-hub` on branch **`main`** at commit **`08c3a1c7f850c5eeb4867d36570bba45621f1ef4`**.

```
+--------------------------------------------------------------------------------------------------------------------------+
|                                              VERIFIED COMPONENT CALL GRAPH                                               |
|                                                                                                                          |
|  [Raw Extraction]                                                                                                       |
|         │                                                                                                                |
|         ▼                                                                                                                |
|  apply.ts: normalizeSpec()                                                                                               |
|         │                                                                                                                |
|         ├────────► semantic.ts: semanticKeyFor(key, label) ──────┐ (Fallback returns raw key)                            |
|         │                                                        │                                                       |
|         ├────────► semantic.ts: canonicalUnitForSemantic(sem) ───┤ (Prefix match: range.* -> km, speed.* -> km/h)        |
|         │                                                        │                                                       |
|         └────────► units.ts: normalizeQuantityLoose() ───────────┘ (Rebases value if canonical unit found)               |
|                                                                                                                          |
|  spec-engine.ts: mergeSpecs() / regroup()                                                                                |
|         │                                                                                                                |
|         ├────────► attributeSemantic(spec) ─────────────────────► (Re-calls semanticKeyFor if spec.semantic === spec.key)|
|         │                                                                                                                |
|         └────────► sameAttribute(a, b) ─────────────────────────► (Guards attribute merging across claims)               |
|                                                                                                                          |
|  auto-correction.ts: detectCorrection()                                                                                  |
|         │                                                                                                                |
|         └────────► plausibleBounds(attributeSemantic(spec)) ────► (Looks up bounds in PLAUSIBLE / BALLISTIC)             |
+--------------------------------------------------------------------------------------------------------------------------+
```

### Direct Implementation Verifications

1. **`src/entities/normalization/semantic.ts`**
   - _Symbols:_ `semanticKeyFor(key: string, label = ""): string`, `canonicalUnitForSemantic(semantic: string): string | undefined`, `COUNTED`.
   - _Observed Behaviour:_ Normalizes raw keys using regex-based case conversion and unit suffix stripping (`_(km|m|kmh|kg|min|w|l)$`). Trailing `_min` stripping creates a collision with `range_min` (which requires a special guard on line 112). Resolves approximately 58 known canonical concepts via sequential `if-else` blocks and regex checks. Falls back to returning `key` verbatim if unmatched (line 258).
   - _Architectural Impact:_ Downstream components cannot distinguish whether a returned string is an approved canonical identifier or an unrecognized raw term. Prefix-based unit assignment in `canonicalUnitForSemantic` assumes any string starting with `range.` is a distance in `km`.

2. **`src/entities/normalization/core-registry.ts`**
   - _Symbols:_ `CANONICAL_UNIT`, `CORE_DIMENSIONS`, `AttributeEntry`, `registryEntryFor(semantic: string)`.
   - _Observed Behaviour:_ Defines physical dimensions (`distance`, `speed`, `mass`, `duration`, `power`, `volume`, `force`, `acceleration`, `load_factor`, `count_rate`), base units, and consensus tolerances. `registryEntryFor()` looks up exact entries first, then suffix `*.count`, then family prefixes (`range.`, `speed.`, etc.) via `FAMILIES.find((f) => semantic.startsWith(f.semantic))`.
   - _Architectural Impact:_ `registryEntryFor("range.invalid_term")` succeeds and returns the `range.` family entry. Therefore, **`registryEntryFor()` cannot be used as an existence validator for canonical concepts**.

3. **`src/entities/drone/spec-engine.ts`**
   - _Symbols:_ `attributeSemantic()`, `sameAttribute()`, `regroup()`, `mergeSpecs()`.
   - _Observed Behaviour:_ `attributeSemantic()` re-evaluates `semanticKeyFor(spec.key, spec.label)` whenever `spec.semantic === spec.key`. `sameAttribute()` ensures two attributes merge only if their semantics match AND either their raw keys match or at least one raw key resolves to the semantic without relying on the label.
   - _Architectural Impact:_ An erroneous semantic mapping causes specs to group together in `Drone.specs`, pooling claims from unrelated attributes into a single disputed consensus calculation.

4. **`src/entities/drone/auto-correction.ts`**
   - _Symbols:_ `detectCorrection()`, `PLAUSIBLE`, `BALLISTIC`, `statesRecordedFigure()`.
   - _Observed Behaviour:_ Reads `attributeSemantic(spec)` to retrieve physical bounds from `PLAUSIBLE` (e.g., `range.max`: 0.1–25,000 km, `speed.max`: 1–4,000 km/h). Compares claims against other sources for unit slips (e.g., km vs m).
   - _Architectural Impact:_ Misclassifying an attribute (e.g. mapping `cruise_speed` to `speed.max`, or `warhead_weight` to `payload.capacity`) triggers false unit-slip corrections or false implausibility flags.

5. **`src/shared/contracts/rules.ts` & `src/shared/infra/heuristics/rule-registry.server.ts`**
   - _Symbols:_ `RuleSnapshot`, `compileRuleSnapshot()`, `getOrRefreshRuleSnapshot()`.
   - _Observed Behaviour:_ Implements database-backed dynamic heuristic rules (`dynamic_rules` table), an integer version counter (`dynamic_rules_version`), and an in-memory compiled snapshot. Refreshes cache with `TTL_MS = 30_000` (30 seconds, not 60 seconds). If the database query fails, it catches the error, logs a warning, and retains the cached snapshot. In pure/browser environments, an empty snapshot is used.

6. **`src/entities/normalization/taxonomy.ts` & `src/shared/contracts/taxonomy.ts`**
   - _Symbols:_ `TaxonomyTerm`, `SEEDED_TERMS`, `TaxonomyCandidate`, `TaxonomyRepository`, `resolveTerm()`.
   - _Observed Behaviour:_ Manages system-level domain taxonomies: `propulsion`, `installation`, and `protocol`. Stores canonical IDs, labels, parent IDs, and aliases. Provides exact and alias matching (`resolveTerm`). Unmatched terms record `TaxonomyCandidate` records.
   - _Architectural Impact:_ This system models **what a system or component is**, whereas the semantic registry models **what a measured attribute represents**. They must not be conflated.

7. **`src/shared/contracts/proposals.ts` & `src/shared/infra/proposals/`**
   - _Symbols:_ `PROPOSAL_KINDS`, `AUTO_APPLY_TIERS`, `ruleApplier`, `admitProposal()`.
   - _Observed Behaviour:_ `PROPOSAL_KINDS` reserves `"normalizer"` alongside `"rule"`, `"prompt"`, `"schema"`, `"model_route"`, and `"code_patch"`. However, [`src/shared/infra/proposals/admit.ts`](../src/shared/infra/proposals/admit.ts) registers only `ruleApplier`. **There is currently no implementation for `normalizerApplier`.** `AUTO_APPLY_TIERS` is frozen as an empty array (`[]`).

8. **`src/entities/drone/claim-lineage.ts` & `src/entities/drone/types.ts`**
   - _Symbols:_ `ClaimLineage`, `SpecClaim.lineage`.
   - _Observed Behaviour:_ Tracks `promptVersion`, `promptHash`, `pipelineVersion`, `rulesVersion`, `ruleIds`, `matchedName`, `matchedVia`, and `contentHash`.
   - _Architectural Impact:_ Merely adding optional properties to TypeScript interfaces does not ensure reproducibility if the referenced version cannot be resolved to an immutable snapshot.

9. **`src/shared/infra/autonomy/ledger.server.ts`**
   - _Symbols:_ `recordAutonomyEvent()`, `autonomy_events` table (migration `018_autonomy_events.sql`).
   - _Observed Behaviour:_ Records governance decisions and operational milestones (actor, action, before/after, `reversed_by`). Retains non-heartbeat rows permanently.
   - _Architectural Impact:_ Writing high-volume, per-extraction shadow resolution telemetry into `autonomy_events` would pollute the audit ledger and degrade query performance.

---

## 4. Existing Functionality vs Architectural Gaps

| Architectural Dimension        | Existing Implementation                                        | Identified Deficiency                                                                 | Phase 3 Hybrid Specification                                                                      |
| :----------------------------- | :------------------------------------------------------------- | :------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------ |
| **Canonical Concept Registry** | Hardcoded inside `semantic.ts` procedural code.                | No discrete manifest. Concepts are conflated with parsing regexes.                    | Closed, code-owned `CanonicalManifest` defining exact valid concepts.                             |
| **Concept Validation**         | `registryEntryFor(id)` prefix match.                           | Accepts non-existent concepts if they match family prefixes (e.g. `speed.arbitrary`). | Exact allowlist validation. Prefix matching used only for metadata inheritance on valid concepts. |
| **Unresolved Terms**           | Identity fallback: returns raw key.                            | Unmapped keys appear as resolved semantics to downstream code.                        | Explicit `SemanticResolutionResult` with `resolved: false` and typed failure reason.              |
| **Context Awareness**          | None. `semanticKeyFor(key, label)` inspects only string names. | Cannot distinguish C-UAS envelope from drone reach, or USV beam from radar beam.      | Bounded `ContextGuards` evaluating system class, domain, subsystem, and unit dimension.           |
| **Alias Inventory**            | Hardcoded regexes in TypeScript source.                        | Adding an alias requires code commit, PR, and redeployment.                           | Database-backed `semantic_aliases` table compiled into memory.                                    |
| **Alias Classification**       | Implicit. All rules treated as procedural if-statements.       | No distinction between exact synonyms, context rules, and ambiguous terms.            | Four-Class Model: Synonym (1), Context (2), Qualified Concept (3), Ambiguous (4).                 |
| **Confidence Scoring**         | None (or arbitrary uncalibrated floats).                       | Misleading representation of rule certainty.                                          | Structured audit metadata: status, match type, rule ID, guard match list.                         |
| **Snapshot Versioning**        | None for semantics.                                            | Claim lineage cannot identify which semantic rules mapped an extraction.              | Content-hashed, immutable in-memory snapshot with monotonic version counter.                      |
| **Shadow Evaluation**          | Not implemented.                                               | Testing new vocabulary risks breaking production ingest.                              | Isolated offline replay comparing legacy vs hybrid resolver on frozen reference corpora.          |
| **Telemetry Persistence**      | Proposal to log all evaluations to `autonomy_events`.          | Table bloat in core audit ledger.                                                     | Dedicated diagnostic run summary and bounded discrepancy records.                                 |

---

## 5. Canonical Semantic Identity and Exact Validation

### The Distinction Between Identity and Metadata

A foundational design requirement is the separation of **Canonical Identity** from **Semantic Metadata**:

- **Canonical Semantic Identity:** An exact, immutable identifier representing an agreed technical or operational property (e.g., `speed.max`, `speed.cruise`, `payload.warhead`, `altitude.service_ceiling`).
- **Semantic Metadata:** The physical and operational properties associated with that concept (physical class, canonical unit, display unit, domain, and consensus tolerance).

```
[Candidate Semantic ID: "range.hypothetical_glide"]
                      │
                      ▼
       Is it in CANONICAL_MANIFEST?
         │                     │
        YES                    NO
         │                     │
         ▼                     ▼
   Valid Identity        INVALID CONCEPT (Rejected)
   (Safe to query        - Rejects database alias
   core-registry         - Does NOT inherit range.* metadata
   for metadata)         - Fails safe to Unresolved
```

### Proposed Code-Owned Canonical Manifest

```typescript
// Proposed addition: src/entities/normalization/canonical-manifest.ts
// (Pure, browser-safe, zero database dependencies)

export interface CanonicalConceptDefinition {
  readonly id: string;
  readonly family: string;
  readonly label: string;
  readonly description: string;
  readonly introducedInVersion: string;
  readonly deprecated?: boolean;
  readonly supersededBy?: string;
}

/**
 * Closed inventory of all valid canonical semantic concepts recognized by Drone Intel Hub.
 * A database alias cannot target an ID not present in this manifest.
 */
export const CANONICAL_CONCEPTS: readonly CanonicalConceptDefinition[] = Object.freeze([
  // Speed
  {
    id: "speed.max",
    family: "speed.",
    label: "Maximum Speed",
    description: "Maximum dash or level speed",
    introducedInVersion: "1.0.0",
  },
  {
    id: "speed.cruise",
    family: "speed.",
    label: "Cruise Speed",
    description: "Nominal cruising flight speed",
    introducedInVersion: "1.0.0",
  },
  {
    id: "speed.dive",
    family: "speed.",
    label: "Dive Speed",
    description: "Terminal dive or intercept speed",
    introducedInVersion: "1.0.0",
  },
  {
    id: "speed.stated",
    family: "speed.",
    label: "Stated Speed",
    description: "Reported speed without cruise/max qualification",
    introducedInVersion: "1.0.0",
  },
  {
    id: "speed.target_max",
    family: "speed.",
    label: "Max Target Speed",
    description: "Maximum speed of engageable target (C-UAS)",
    introducedInVersion: "1.0.0",
  },

  // Range
  {
    id: "range.max",
    family: "range.",
    label: "Maximum Range",
    description: "Maximum one-way physical reach",
    introducedInVersion: "1.0.0",
  },
  {
    id: "range.operational",
    family: "range.",
    label: "Operational Range",
    description: "Standard operating radius or mission reach",
    introducedInVersion: "1.0.0",
  },
  {
    id: "range.combat_radius",
    family: "range.",
    label: "Combat Radius",
    description: "Radius of action allowing return to base",
    introducedInVersion: "1.0.0",
  },
  {
    id: "range.combat",
    family: "range.",
    label: "Combat Range",
    description: "Mission range under combat load",
    introducedInVersion: "1.0.0",
  },
  {
    id: "range.ferry",
    family: "range.",
    label: "Ferry Range",
    description: "Maximum range without payload/stores",
    introducedInVersion: "1.0.0",
  },
  {
    id: "range.link",
    family: "range.",
    label: "Link/Control Range",
    description: "Line-of-sight communication or data link limit",
    introducedInVersion: "1.0.0",
  },
  {
    id: "range.engagement",
    family: "range.",
    label: "Engagement Range",
    description: "Effective engagement or suppression envelope (C-UAS)",
    introducedInVersion: "1.0.0",
  },
  {
    id: "range.detection",
    family: "range.",
    label: "Detection Range",
    description: "Sensor detection distance",
    introducedInVersion: "1.0.0",
  },
  {
    id: "range.fiber_spool",
    family: "range.",
    label: "Fiber Spool Length",
    description: "Physical tether or optical fiber payout length",
    introducedInVersion: "1.0.0",
  },
  {
    id: "range.min",
    family: "range.",
    label: "Minimum Range",
    description: "Minimum arming, engagement or operating distance",
    introducedInVersion: "1.0.0",
  },

  // Altitude
  {
    id: "altitude.max",
    family: "altitude.",
    label: "Maximum Altitude",
    description: "Absolute operational ceiling",
    introducedInVersion: "1.0.0",
  },
  {
    id: "altitude.service_ceiling",
    family: "altitude.",
    label: "Service Ceiling",
    description: "Aeronautical ceiling (climb rate decay bound)",
    introducedInVersion: "1.0.0",
  },
  {
    id: "altitude.target_max",
    family: "altitude.",
    label: "Max Target Altitude",
    description: "Ceiling of engageable target (C-UAS)",
    introducedInVersion: "1.0.0",
  },
  {
    id: "altitude.target_min",
    family: "altitude.",
    label: "Min Target Altitude",
    description: "Floor of engageable target (C-UAS)",
    introducedInVersion: "1.0.0",
  },

  // Payload & Weight
  {
    id: "payload.capacity",
    family: "payload.",
    label: "Payload Capacity",
    description: "Maximum carrying capacity for equipment/stores",
    introducedInVersion: "1.0.0",
  },
  {
    id: "payload.mass",
    family: "payload.",
    label: "Payload Mass",
    description: "Nominal carried payload weight",
    introducedInVersion: "1.0.0",
  },
  {
    id: "payload.warhead",
    family: "payload.",
    label: "Warhead Mass",
    description: "Net explosive charge weight",
    introducedInVersion: "1.0.0",
  },
  {
    id: "weight.mtow",
    family: "weight.",
    label: "MTOW",
    description: "Maximum takeoff weight",
    introducedInVersion: "1.0.0",
  },
  {
    id: "weight.empty",
    family: "weight.",
    label: "Empty Weight",
    description: "Airframe weight without fuel or payload",
    introducedInVersion: "1.0.0",
  },
  {
    id: "weight.launch",
    family: "weight.",
    label: "Launch Weight",
    description: "Total weight at moment of launch",
    introducedInVersion: "1.0.0",
  },
  {
    id: "weight.total",
    family: "weight.",
    label: "Total Weight",
    description: "Stated gross system weight",
    introducedInVersion: "1.0.0",
  },

  // Dimensions
  {
    id: "dimension.length",
    family: "dimension.",
    label: "Length",
    description: "Overall airframe/hull length",
    introducedInVersion: "1.0.0",
  },
  {
    id: "dimension.wingspan",
    family: "dimension.",
    label: "Wingspan",
    description: "Total wing span",
    introducedInVersion: "1.0.0",
  },
  {
    id: "dimension.height",
    family: "dimension.",
    label: "Height",
    description: "Overall height",
    introducedInVersion: "1.0.0",
  },
  {
    id: "dimension.width",
    family: "dimension.",
    label: "Width",
    description: "Beam or fuselage width",
    introducedInVersion: "1.0.0",
  },
  {
    id: "dimension.diameter",
    family: "dimension.",
    label: "Diameter",
    description: "Fuselage or body diameter",
    introducedInVersion: "1.0.0",
  },
  {
    id: "dimension.depth",
    family: "dimension.",
    label: "Draft/Depth",
    description: "Subsurface draft or depth",
    introducedInVersion: "1.0.0",
  },
  {
    id: "dimension.caliber",
    family: "dimension.",
    label: "Caliber",
    description: "Bore or munition caliber",
    introducedInVersion: "1.0.0",
  },

  // Power, Endurance, Logistics
  {
    id: "power.rf",
    family: "power.",
    label: "RF Jamming Power",
    description: "Transmitter/jammer output power",
    introducedInVersion: "1.0.0",
  },
  {
    id: "power.engine",
    family: "power.",
    label: "Engine Power",
    description: "Propulsion motor or engine output",
    introducedInVersion: "1.0.0",
  },
  {
    id: "endurance.flight",
    family: "endurance.",
    label: "Flight Endurance",
    description: "Total operating duration in flight",
    introducedInVersion: "1.0.0",
  },
  {
    id: "maneuver.load_factor_max",
    family: "maneuver.",
    label: "Max Load Factor",
    description: "Normal structural acceleration limit (g)",
    introducedInVersion: "1.0.0",
  },
  {
    id: "capacity.fuel",
    family: "capacity.",
    label: "Fuel Capacity",
    description: "Internal liquid fuel volume",
    introducedInVersion: "1.0.0",
  },
  {
    id: "capacity.target_channels",
    family: "capacity.",
    label: "Target Channels",
    description: "Simultaneous target tracking/engagement channels",
    introducedInVersion: "1.0.0",
  },
  {
    id: "cost.unit",
    family: "cost.",
    label: "Unit Cost",
    description: "Procurement price per unit",
    introducedInVersion: "1.0.0",
  },
  {
    id: "production.rate_monthly",
    family: "production.",
    label: "Monthly Production",
    description: "Manufacturing output per month",
    introducedInVersion: "1.0.0",
  },
  {
    id: "inventory.deployed_count",
    family: "inventory.",
    label: "Deployed Units",
    description: "Active operational inventory count",
    introducedInVersion: "1.0.0",
  },
  {
    id: "guidance.system",
    family: "guidance.",
    label: "Guidance System",
    description: "Navigation and terminal homing technology",
    introducedInVersion: "1.0.0",
  },
]);

const VALID_CANONICAL_IDS: ReadonlySet<string> = new Set(CANONICAL_CONCEPTS.map((c) => c.id));

/** Strict validator: returns true IF AND ONLY IF the ID is explicitly registered. */
export function isValidCanonicalId(id: string): boolean {
  return VALID_CANONICAL_IDS.has(id);
}
```

### Invariants for Validation

1. An approved database alias **must** reference an identifier where `isValidCanonicalId(target) === true`.
2. Prefix matching via `core-registry.ts` is permissible **only** after an identifier has passed `isValidCanonicalId`.
3. An unknown identifier that happens to start with `range.` (e.g. `range.hypothetical`) is rejected as an invalid concept and never inherits the physical unit `km` or consensus tolerance `0.6`.

---

## 6. Four-Class Alias Model and Resolution States

### Conceptual Clarification: Qualified Concepts vs Aliases

In the initial draft, terms such as `cruise_speed`, `service_ceiling`, and `warhead_weight` were ambiguously defined as "qualified aliases" of parent concepts (`speed.max`, `altitude.max`). **This was architecturally hazardous.** In Drone Intel Hub, if two attributes share a canonical semantic string, downstream grouping in [`spec-engine.ts: regroup()`](../src/entities/drone/spec-engine.ts#L54) pools their claims into a single attribute. If `cruise_speed` collapsed into `speed.max`, a cruise speed of $180\text{ km/h}$ and a top speed of $300\text{ km/h}$ would be merged and flagged as a factual contradiction!

In the revised model, `speed.cruise`, `speed.max`, `altitude.service_ceiling`, and `payload.warhead` are **distinct canonical concepts**, each with its own entry in `CANONICAL_CONCEPTS`.

```
                    [Raw Extracted Attribute Name]
                                  │
                                  ▼
                     +──────────────────────────+
                     │ Is term universally      │─── YES ───► CLASS 1: Canonical Synonym
                     │ equivalent to a concept? │             (Direct, unconditioned: top_speed -> speed.max)
                     +──────────────────────────+
                                  │ NO
                                  ▼
                     +──────────────────────────+
                     │ Does equivalence require │─── YES ───► CLASS 2: Context-Conditioned Synonym
                     │ verified system context? │             (Scoped: effective_range + C-UAS -> range.engagement)
                     +──────────────────────────+
                                  │ NO
                                  ▼
                     +──────────────────────────+
                     │ Does term represent a    │─── YES ───► CLASS 3: Qualified Distinct Concept
                     │ specific sub-concept?    │             (Preserves unique canonical ID: service_ceiling -> altitude.service_ceiling)
                     +──────────────────────────+
                                  │ NO
                                  ▼
                     +──────────────────────────+
                     │ Is term known to have    │─── YES ───► CLASS 4: Known Ambiguous Candidate
                     │ multiple valid meanings? │             (Never auto-resolves: radius -> ambiguous)
                     +──────────────────────────+
                                  │ NO
                                  ▼
                     UNKNOWN TERMINOLOGY
                     (Unclassified term; never auto-resolves)
```

### Class Definitions

#### Class 1: Canonical Synonym (Direct / Universal Equivalent)

- **Definition:** A term that is universally and directly equivalent to exactly one canonical semantic concept across all domains without requiring context.
- **Criteria:** Universal semantic equivalence. Bijective technical identity.
- **Resolution Rule:** Auto-resolves unconditionally once the alias is approved.
- **Representative Examples:**
  - `top_speed`, `maximum_speed`, `vitesse_maximale`, `максимальная_скорость` $\rightarrow$ `speed.max`
  - `wingspan`, `wing_span`, `рамах_крила` $\rightarrow$ `dimension.wingspan`
  - `mtow`, `max_takeoff_weight`, `максимальный_взлетный_вес` $\rightarrow$ `weight.mtow`
  - `unit_cost` $\rightarrow$ `cost.unit` (unit procurement price per system only). Total programme/project cost is a different datum with no canonical id and must not be aliased here.

#### Class 2: Context-Conditioned Synonym (Scoped Equivalent)

- **Definition:** A term that is equivalent to a canonical concept only when explicit contextual guards (system class, operating domain, component/subsystem, or unit dimension) are satisfied.
- **Criteria:** The term is polysemic across different system categories, but monosemic within a verified context.
- **Resolution Rule:** Auto-resolves **if and only if** all declared context guards are satisfied. If context is missing, incomplete, or contradictory, resolution fails safe.
- **Representative Examples:**
  - `effective_range`:
    - _Guard:_ `systemClass in ['c-uas', 'jammer', 'ew']` $\rightarrow$ `range.engagement`
    - _Guard:_ `systemClass in ['strike_uav', 'loitering_munition']` $\rightarrow$ Fails safe to `unresolved_context` (could mean link range or flight radius).
  - `beam`:
    - _Guard:_ `domain == 'Sea'` $\rightarrow$ `dimension.width`
    - _Guard:_ `unitDimension == 'angle'` or `subsystem == 'radar'` $\rightarrow$ Fails safe / rejected (not airframe width).
  - `output_power`:
    - _Guard:_ `subsystem == 'jammer'` $\rightarrow$ `power.rf`
    - _Guard:_ `subsystem == 'engine'` $\rightarrow$ `power.engine`

#### Class 3: Qualified Distinct Concept (Narrowed / Specific Concept)

- **Definition:** A term representing a specific operational variation or sub-concept that must retain its own distinct canonical identity rather than collapsing into a broader concept.
- **Criteria:** Must not be merged with broader attributes in consensus calculations.
- **Resolution Rule:** Resolves to its own explicit canonical identifier.
- **Representative Examples:**
  - `cruising_speed`, `speed_cruise`, `крейсерська швидкість` $\rightarrow$ `speed.cruise` (NOT `speed.max`).
  - `service_ceiling`, `практический_потолок` $\rightarrow$ `altitude.service_ceiling` (NOT `altitude.max`).
  - `warhead_weight`, `боевая_часть`, `вага_бойової_частини` $\rightarrow$ `payload.warhead` (NOT `payload.capacity` or `payload.mass`). `боевая_часть` is a Russian-language alias (`language: "ru"`): it resolves only for a Russian caller and never licenses a guess from an unscoped or differently scoped term.
  - `combat_radius`, `боевой_радиус` $\rightarrow$ `range.combat_radius` (NOT `range.max`).

#### Class 4: Known Ambiguous Candidate (Contested / Polysemous Term)

- **Definition:** A term verified to possess multiple plausible technical interpretations that cannot be resolved safely with available text or metadata.
- **Criteria:** Documented ambiguity in OSINT reporting.
- **Resolution Rule:** **Never auto-resolves.** Emits diagnostic candidates and queues the instance for analyst review.
- **Representative Examples:**
  - `radius`: Ambiguous between `range.combat_radius`, `maneuver.turn_radius`, and EW suppression radius.
  - `power`: Ambiguous between RF transmitter power (W), piston/turbine engine power (hp/kW), and battery storage (Wh).
  - `capacity`: Ambiguous between payload mass (kg), fuel tank volume (l), battery capacity (mAh), and target channels.

#### Unknown Terminology (Unclassified)

- **Definition:** A term not present in the active snapshot.
- **Distinction:** An unknown term is not necessarily ambiguous; it is merely unindexed. It produces an `unresolved_unknown` state and records an observation candidate without guessing.

---

## 7. Explicit Resolution States and Metadata

To eliminate uncalibrated numeric confidence values, the resolver outputs structured categorical metadata.

```typescript
// Proposed addition: src/entities/normalization/semantic-result.ts

export type SemanticResolutionStatus =
  | "resolved" // Successfully matched an approved Class 1, 2, or 3 rule
  | "unresolved_context" // Class 2 rule matched name, but context guards failed or were missing
  | "unresolved_conflict" // Multiple mutually incompatible rules matched with equal precedence
  | "unresolved_ambiguous" // Matched an approved Class 4 ambiguous entry
  | "unresolved_unknown" // Term is completely unindexed in the active snapshot
  | "unresolved_deprecated"; // Matched rule is marked deprecated without a valid superseding target

export type SemanticMatchType =
  | "canonical_identity" // Exact match against CANONICAL_CONCEPTS manifest
  | "literal_synonym" // Exact case-insensitive literal string match
  | "token_bounded" // Normalized token-boundary match
  | "context_guard"; // Class 2 context-conditioned match

export interface GuardEvaluationAudit {
  readonly guardName: string;
  readonly expected: string | readonly string[];
  readonly actual: string | undefined;
  readonly satisfied: boolean;
}

export interface SemanticResolutionResult {
  /** The validated canonical semantic concept. Defined IF AND ONLY IF status === "resolved". */
  readonly canonicalId?: string;

  /** Comprehensive categorical outcome of the resolution attempt. */
  readonly status: SemanticResolutionStatus;

  /** Operational classification of the matched alias (if any). */
  readonly aliasClass?:
    "class1_synonym" | "class2_context" | "class3_qualified" | "class4_ambiguous";

  /** The specific rule mechanism that produced the resolution. */
  readonly matchType?: SemanticMatchType;

  /** Unique identifier of the rule in the active snapshot. */
  readonly matchedRuleId?: string;

  /** Detailed audit log of context guards evaluated for Class 2 rules. */
  readonly guardAudit?: readonly GuardEvaluationAudit[];

  /** Immutable content hash of the active snapshot used for this resolution. */
  readonly snapshotHash: string;

  /** Monotonic version counter of the active snapshot. */
  readonly snapshotVersion: number;

  /** Original raw key, preserved unconditionally. */
  readonly rawKey: string;

  /** Original raw label, preserved unconditionally. */
  readonly rawLabel?: string;

  /** Explanatory notes or diagnostic error messages. */
  readonly diagnostics: readonly string[];
}
```

---

## 8. Hybrid Registry Architecture and Source of Truth

The hybrid architecture guarantees that safety-critical invariants remain immutable in code while terminology coverage expands via database governance.

```
+──────────────────────────────────────────────────────────────────────────────────────────────────+
|                                  HYBRID REGISTRY ARCHITECTURE                                    |
|                                                                                                  |
|  [Layer 1: Code Core] (src/entities/normalization/)                                              |
|  ├─ canonical-manifest.ts : Closed list of valid Canonical IDs (speed.max, payload.warhead...)   |
|  ├─ core-registry.ts      : Physical Dimensions, Domains, Base Units, Tolerances                 |
|  └─ units.ts              : Physical Unit Definitions, Conversion Factors                        |
|                                         │                                                        |
|                                         ▼ (Validates Targets & Provides Invariants)              |
|  [Layer 2: Database Layer] (PostgreSQL Storage)                                                  |
|  ├─ semantic_alias_revisions     : Append-only log of approved alias rules                       |
|  ├─ semantic_registry_snapshots  : Activated snapshot manifests with SHA-256 content hashes     |
|  └─ semantic_candidates          : High-water mark of unmapped terms observed in extractions     |
|                                         │                                                        |
|                                         ▼ (Compiled Synchronously on Activation)                 |
|  [Layer 3: Runtime Memory Cache] (semantic-registry.server.ts)                                   |
|  ├─ Immutable In-Memory Snapshot : Pure lookup maps (Class 1, 2, 3, 4)                           |
|  ├─ Version & Hash Verification  : TTL refresh (30s) against latest snapshot ID                 |
|  └─ Fallback Seed Registry       : Hardcoded compiled fallback if DB is completely offline       |
+──────────────────────────────────────────────────────────────────────────────────────────────────+
```

### Layer Ownership Rules

1. **Core Registry (Code Core):** Owns base dimensions, physical classes, presentation units, consensus tolerances, and the canonical manifest. The database can never add dimensions, redefine conversion factors, or alter consensus tolerances.
2. **Database Layer (Persistence):** Owns terminology variants, multilingual aliases, context guard definitions, status transitions, and audit provenance.
3. **Runtime In-Memory Snapshot (Execution):** Resolution runs strictly in memory against compiled plain lookup structures. No database I/O occurs on resolution paths.

---

## 9. Proposed TypeScript Data Model

```typescript
// Proposed: src/shared/contracts/semantic-registry.ts

import type { Dimension } from "@/entities/normalization/units";

export type AliasLanguage = "all" | "en" | "uk" | "ru" | "sv" | "fa" | "zh";

export interface ContextGuards {
  readonly systemClasses?: readonly string[];
  readonly domains?: readonly string[];
  readonly subsystems?: readonly string[];
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

/** Class 1, 2, and 3: Must point to a valid canonicalId; cannot have candidate lists. */
export interface Class1_3AliasDefinition extends BaseAliasDefinition {
  readonly aliasClass: "class1_synonym" | "class2_context" | "class3_qualified";
  readonly canonicalId: string;
  readonly candidateCanonicalIds?: never;
  readonly contextGuards?: ContextGuards;
}

/** Class 4: Known ambiguous term; must NOT have canonicalId; must provide candidate targets. */
export interface Class4AliasDefinition extends BaseAliasDefinition {
  readonly aliasClass: "class4_ambiguous";
  readonly canonicalId?: never;
  readonly candidateCanonicalIds: readonly string[];
  readonly contextGuards?: never;
}

/** Discriminated union strictly mirroring database table CHECK constraints. */
export type SemanticAliasDefinition = Class1_3AliasDefinition | Class4AliasDefinition;

export interface ResolutionContextInput {
  readonly rawKey: string;
  readonly rawLabel?: string;
  readonly rawUnit?: string;
  readonly systemClass?: string;
  readonly domain?: string;
  readonly subsystem?: string;
  readonly language?: string;
}
```

---

## 10. Deterministic Context-Aware Resolution Algorithm

Resolution proceeds through strict precedence gates. The algorithm halts at the first decisive gate.

```
                             [Resolution Context Input]
                                         │
                                         ▼
                     +────────────────────────────────────────+
                     | Gate 0: Exact Canonical Manifest Match |
                     | Does rawKey match CANONICAL_CONCEPTS?  |
                     +────────────────────────────────────────+
                                   │            │
                                  YES           NO
                                   │            │
                                   ▼            ▼
                           Status: resolved  +─────────────────────────────────────+
                           Match: canonical  | Gate 1: Class 1 Synonym Match       |
                                             | Unconditional exact literal match?  |
                                             +─────────────────────────────────────+
                                                           │            │
                                                          YES           NO
                                                           │            │
                                                           ▼            ▼
                                                   Status: resolved  +──────────────────────────────────+
                                                   Match: literal    | Gate 2: Class 2 Context Match    |
                                                                     | Name matches AND guards pass?    |
                                                                     +──────────────────────────────────+
                                                                                   │            │
                                                                                  YES           NO
                                                                                   │            │
                                                                                   ▼            ▼
                                                                           Status: resolved  +──────────────────────────────────+
                                                                           Match: context    | Gate 3: Class 3 Qualified Concept|
                                                                                             | Specific sub-concept match?      |
                                                                                             +──────────────────────────────────+
                                                                                                           │            │
                                                                                                          YES           NO
                                                                                                           │            │
                                                                                                           ▼            ▼
                                                                                                   Status: resolved  +──────────────────────────────────+
                                                                                                   Match: qualified  | Gate 4: Class 4 Ambiguous Check  |
                                                                                                                     | Is term known ambiguous?         |
                                                                                                                     +──────────────────────────────────+
                                                                                                                                   │            │
                                                                                                                                  YES           NO
                                                                                                                                   │            │
                                                                                                                                   ▼            ▼
                                                                                                                              Status:      Status:
                                                                                                                              ambiguous    unknown
```

### Precedence Gate Specifications

1. **Gate 0: Exact Manifest Identity**
   Check if the raw key is directly an exact canonical ID in lowercase:
   `const trimmedKey = rawKey.trim().toLowerCase();`
   If `isValidCanonicalId(trimmedKey)` is true:
   Return `status: "resolved"`, `canonicalId: trimmedKey`, `matchType: "canonical_identity"`.
   _Separation Invariant:_ Gate 0 operates directly against canonical ID syntax and does not run alias normalization (which removes namespace dots).

2. **Gate 1: Approved Class 1 Synonym Match**
   Query the active snapshot for a Class 1 entry matching `normalizeAliasKey(rawKey)`. If `labelTokens` are defined, verify that `rawLabel` contains the required literal tokens.
   If matched: Return `status: "resolved"`, `canonicalId: rule.canonicalId`, `aliasClass: "class1_synonym"`, `matchType: "literal_synonym"`.

3. **Gate 2: Approved Class 2 Context Match**
   Query the active snapshot for Class 2 entries matching `normalizeAliasKey(rawKey)`.
   For each candidate rule, evaluate its declared `contextGuards`:
   - `systemClasses`: Checked against `context.systemClass`.
   - `domains`: Checked against `context.domain`.
   - `subsystems`: Checked against `context.subsystem`.
   - `unitDimension`: Verified by checking `context.rawUnit` against [`units.ts: CANONICAL_UNIT`](../src/entities/normalization/units.ts#L3).
   - **Collision Handling:**
     - If exactly one candidate passes all guards: Return `status: "resolved"`, `canonicalId: rule.canonicalId`.
     - If multiple candidates pass with conflicting `canonicalId`s: Fail safe to `status: "unresolved_conflict"`.
     - If candidate matches term name but guards fail: Fail safe to `status: "unresolved_context"`.

4. **Gate 3: Approved Class 3 Qualified Concept Match**
   Query the active snapshot for Class 3 entries matching `normalizeAliasKey(rawKey)`.
   If matched: Return `status: "resolved"`, `canonicalId: rule.canonicalId`, `aliasClass: "class3_qualified"`.
   _Crucial Invariant:_ The resolved ID is its own distinct concept (e.g. `altitude.service_ceiling`).

5. **Gate 4: Class 4 Known Ambiguity Check**
   Query the active snapshot for Class 4 ambiguous terms matching `normalizeAliasKey(rawKey)`.
   If matched: Return `status: "unresolved_ambiguous"`, `aliasClass: "class4_ambiguous"`, `canonicalId: undefined`.

6. **Gate 5: Unclassified Terminology Fallback (Hard Stop)**
   If no gate has matched: Return `status: "unresolved_unknown"`, `canonicalId: undefined`.
   _Strict Invariant (No Backdoor Fallback):_ The resolver does **not** invoke `semanticKeyFor()`, does **not** return the raw key as a canonical ID, and does **not** execute heuristic regex guessing. It halts and returns an unmapped result. This ensures that unknown inputs are cleanly exposed as gaps in the registry rather than silently masquerading as resolved semantics.

---

## 11. Matching and Language Normalization Policy

Arbitrary regular expressions in database rules are prohibited. Matching relies on strict, deterministic, Unicode-aware normalization:

```typescript
/** Deterministic alias key normalizer. Pure, bounded, and Unicode-aware. */
export function normalizeAliasKey(key: string): string {
  const folded = key
    .normalize("NFKC") // fold compatibility forms first
    .trim()
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1_$2") // camelCase boundary becomes a delimiter
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_") // every run of non-letter/number is ONE "_" (never deleted)
    .replace(/^_+|_+$/g, "");
  let current = folded;
  for (;;) {
    const next = current.replace(/_(km|kmh|kg|m)$/, ""); // unambiguous unit artifacts only
    if (next === current || next === "") return current;
    current = next;
  }
}
```

### Multilingual and Morphological Rules

- **Full Multilingual Alphabet Support:** Using Unicode property escapes (`\p{L}`, `\p{N}`) ensures non-ASCII alphabets (Swedish `å`, `ä`, `ö`, Ukrainian `і`, `ї`, `є`, Russian Cyrillic, Persian/Arabic script, Chinese characters) are preserved and indexable rather than being stripped.
- **No Unconstrained Diacritic Stripping:** Diacritics are normalized via Unicode `NFKC` normalization, but semantic characters are never blindly converted to ASCII equivalents, as doing so alters vocabulary identity.
- **Cyrillic and Non-Latin Script Integrity:** Russian, Ukrainian, Persian, and Chinese terms are matched in their native scripts. Transliterations (e.g. `dalnost` for `дальность`) are stored as separate explicit alias entries, not created dynamically by phonetic heuristics.
- **Separation from Canonical IDs:** Canonical concept IDs use standard dot-notation (`family.leaf`). Gate 0 matches exact canonical IDs directly without stripping dots; alias normalization is applied only to raw alias candidate keys.
- **Delimiters Are Kept, Not Deleted:** Spaces, hyphens, dots and slashes all become one `_`, so `air craft`, `air-craft` and `air_craft` agree while `aircraft` stays distinct. The original `rawKey` is always preserved beside the result.
- **Unit Suffixes:** Only `_km`, `_kmh`, `_kg`, `_m` are stripped. `_min`, `_w` and `_l` are not: `range_min` must never collapse into `range` (legacy `semantic.ts` needs a special guard for exactly this).
- **Token Boundaries:** Label matching compares whole Unicode word tokens (NFKC, lowercase), never substrings: `max` does not match `Maximal`. Rule tokens containing regex syntax are rejected at snapshot compilation time.
- **Language Scoping:** A rule applies when its `language` is `all` or equals the caller's `language` (trimmed, case-insensitive). A caller that supplies no language only matches `all` rules, so absence of language never licenses a guess. `all` means that this particular alias key is valid regardless of source language (established technical keys such as `max_speed` appear verbatim in Ukrainian and Russian reports); it does NOT mean that languages are semantically interchangeable. Real language-dependent aliases, translations and transliterations use `en`, `uk`, `ru`, `sv`, etc. The same key may exist in disjoint language scopes. Overlapping scopes (including `all`) on one key are a compile error, **except between Class 2 rules**, which may share a key and overlapping scopes because they are distinguished by their context guards; conflicting outcomes are resolved by the Gate 2 collision rules, never by input order.
- **Deterministic Class 2 Order:** Class 2 candidates are sorted by `ruleId` at compilation, and the content hash is over rules sorted by `ruleId`, so two snapshots with the same hash always return identical results (including `matchedRuleId` and `guardAudit`) regardless of input order.
- **Complete Guard Audit:** Every declared guard of every Class 2 candidate is evaluated and audited (no short-circuit, no overwriting); each audit entry carries its `ruleId`, so a failure shows exactly why every candidate was rejected. A rule passes only if all its guards are satisfied. `unitDimension` classifies `rawUnit` through `units.ts` (`canonicalUnitFor`) into a `CANONICAL_UNIT` dimension; an unknown, unclassifiable or missing unit fails the guard. `CANONICAL_UNIT` is frozen at runtime, and `UNIT_NORMALIZER_VERSION` (units.ts) is bound into the snapshot hash next to the unit table: bump it whenever unit recognition behaviour changes (a golden test enforces this). `canonicalUnitFor` classifies a standalone unit string only on a full match: the `UNITS` patterns find a unit at the end of a longer measurement, so a prefix match (`m/s` inside `m/s2`) must never decide the physical dimension. Acceleration (`m/s2`, `m/s²`) has its own recognizer (`UNIT_NORMALIZER_VERSION` 1.1.0).
- **Compile-Time Validation:** Rule keys are normalized with the same function at compilation. Two rules colliding on a normalized key, a Class 4 key that is also a synonym, a Class 2 rule without an effective guard, and context guards on a Class 1/3 rule are compilation errors.

---

## 12. Snapshot Versioning, Immutability, and Historical Reproducibility

### Evaluation of Versioning Architectures

Two persistence models were evaluated:

- **Option A: Append-Only Alias Revisions:** Every change creates a new row with a revision ID; active state is derived by grouping by rule ID.
- **Option B: Immutable Complete Snapshots:** Every activation serializes the complete registry into an immutable snapshot row containing an in-memory compilation artifact and a SHA-256 content hash.

**Architectural Decision:** We adopt a **hybrid of Option A and Option B**. Individual alias edits are stored in an append-only revision ledger (`semantic_alias_revisions`), while each formal activation compiles a complete, immutable snapshot (`semantic_registry_snapshots`) referenced by a monotonic version number and SHA-256 hash.

```sql
-- Migration: migrations/029_semantic_registry.sql
-- Idempotent setup for the Hybrid Semantic Registry

CREATE TABLE IF NOT EXISTS semantic_alias_revisions (
  revision_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id                 TEXT NOT NULL,
  canonical_id            TEXT, -- NULL for Class 4 ambiguous terms
  candidate_canonical_ids JSONB, -- Mandatory candidate targets for Class 4 ambiguous terms
  alias_class             TEXT NOT NULL CHECK (alias_class IN ('class1_synonym', 'class2_context', 'class3_qualified', 'class4_ambiguous')),
  language                TEXT NOT NULL DEFAULT 'all',
  raw_key                 TEXT NOT NULL,
  label_tokens            JSONB,
  context_guards          JSONB,
  rationale               TEXT NOT NULL,
  author                  TEXT NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_canonical_target CHECK (
    (
      alias_class = 'class4_ambiguous'
      AND canonical_id IS NULL
      AND jsonb_typeof(candidate_canonical_ids) = 'array'
      AND jsonb_array_length(candidate_canonical_ids) > 0
    )
    OR
    (
      alias_class IN (
        'class1_synonym',
        'class2_context',
        'class3_qualified'
      )
      AND canonical_id IS NOT NULL
      AND candidate_canonical_ids IS NULL
    )
  )
);

CREATE TABLE IF NOT EXISTS semantic_registry_snapshots (
  snapshot_id             TEXT PRIMARY KEY, -- e.g. "snap-v004-a1b2c3d4"
  version                 INTEGER NOT NULL UNIQUE,
  content_hash            TEXT NOT NULL,    -- SHA-256 over composite digest (rules + manifests)
  manifest_version        TEXT NOT NULL,   -- Version of code CANONICAL_CONCEPTS
  manifest_hash           TEXT NOT NULL,   -- SHA-256 over CANONICAL_CONCEPTS
  core_registry_version   TEXT NOT NULL,   -- Version identifier from core-registry.ts
  resolver_version        TEXT NOT NULL,   -- Version of the resolver engine/compiler code
  compiled_rules          JSONB NOT NULL,   -- Complete serialized snapshot payload
  activated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_by            TEXT NOT NULL,
  note                    TEXT
);

CREATE INDEX IF NOT EXISTS idx_semantic_revisions_rule ON semantic_alias_revisions(rule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_semantic_snapshots_version ON semantic_registry_snapshots(version DESC);

-- Concrete Database-Enforced Immutability:
-- Protects against accidental UPDATE/DELETE from scripts, ORM bugs, or administrative manual edits.
CREATE OR REPLACE FUNCTION prevent_semantic_registry_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is strictly append-only: UPDATE and DELETE operations are forbidden.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_alias_revision_mutation ON semantic_alias_revisions;
CREATE TRIGGER trg_prevent_alias_revision_mutation
BEFORE UPDATE OR DELETE ON semantic_alias_revisions
FOR EACH ROW EXECUTE FUNCTION prevent_semantic_registry_mutation();

DROP TRIGGER IF EXISTS trg_prevent_snapshot_mutation ON semantic_registry_snapshots;
CREATE TRIGGER trg_prevent_snapshot_mutation
BEFORE UPDATE OR DELETE ON semantic_registry_snapshots
FOR EACH ROW EXECUTE FUNCTION prevent_semantic_registry_mutation();
```

### Invariants for Candidate Targets & Snapshot Compilation

1. **Database-Level Protection:** The SQL `chk_canonical_target` constraint strictly enforces at the DB level that Class 4 rows have `canonical_id IS NULL` and non-empty `candidate_canonical_ids` JSON array, while Classes 1–3 have `canonical_id IS NOT NULL` and `candidate_canonical_ids IS NULL`.
2. **Compiler-Level Validation of Candidate Targets:** Since PostgreSQL cannot inspect code-owned TypeScript sets, the **snapshot compiler** enforces an unconditional verification gate at compilation/activation time:
   - For every Class 4 rule, **every identifier** in `candidateCanonicalIds` must satisfy `isValidCanonicalId(candidate) === true`.
   - If any candidate references an unregistered or invalid concept, snapshot compilation immediately aborts with an error, preventing the snapshot from being saved or activated.

### Composite Snapshot Content Addressability

A snapshot hash computed over database rules alone is insufficient, because changes to code-owned definitions (e.g. `CANONICAL_CONCEPTS`, physical dimensions, consensus tolerances, or normalizer compiler logic) could silently alter resolution behavior under an unchanged database state.

The snapshot content hash is therefore computed over a **composite digest** that explicitly binds all code invariants and active database rules:

```typescript
export interface SnapshotCompositeDigest {
  readonly resolverVersion: string; // Compiler / resolver engine version (e.g. "1.0.0")
  readonly manifestVersion: string; // Version of CANONICAL_CONCEPTS (e.g. "1.0.0")
  readonly manifestHash: string; // SHA-256 over canonical JSON of CANONICAL_CONCEPTS
  readonly coreRegistryVersion: string; // Version identifier from core-registry.ts
  readonly coreMetadataHash: string; // SHA-256 over full core-registry.ts metadata: CORE_DIMENSIONS + ENTRY_LIST (tolerances, domains, dimensions) + DEFAULT_TOLERANCE
  readonly activeRules: readonly SemanticAliasDefinition[]; // Canonical sorted active rules
}
```

$$\text{snapshot\_content\_hash} = \text{SHA256}\Big(\text{canonical\_json\_sort}(\text{SnapshotCompositeDigest})\Big)$$

In Phase 3.1 the compiler computes `contentHash` itself (pure SHA-256 over resolver version, manifest version, manifest hash and every rule field sorted by `ruleId`); callers cannot supply it. `coreRegistryVersion` and `coreMetadataHash` are bound in Phase 3.3.

This cryptographic binding guarantees that if any code-level invariant or active rule changes, the snapshot content hash changes, completely preventing silent historical drift.

### Runtime Immutability Guarantee

To ensure runtime immutability in JavaScript/TypeScript:

- Snapshots are encapsulated inside an opaque interface.
- Callers cannot access internal lookup maps directly.
- Lookup functions expose only frozen value objects or defensive copies.
- Resolver functions are pure: `resolveSemantic(input, snapshot)`.

```typescript
// Proposed: src/entities/normalization/semantic-snapshot.ts

export interface ReadonlySemanticSnapshot {
  readonly snapshotId: string;
  readonly version: number;
  readonly contentHash: string;
  readonly manifestVersion: string;
  readonly activatedAt: string;

  // Public resolution interface (safe, pure, read-only)
  resolve(input: ResolutionContextInput): SemanticResolutionResult;
}
```

### Database Failure and Cold-Start Resilience

1. **Cache TTL Refresh:** The server queries `select max(version) from semantic_registry_snapshots` every 30 seconds (matching [`src/shared/infra/heuristics/rule-registry.server.ts`](../src/shared/infra/heuristics/rule-registry.server.ts)).
2. **Database Failure During Refresh:** If the query fails, the server logs a warning and **retains the current active in-memory snapshot**. Ingest and processing never halt.
3. **Cold-Start Without Database:** If the service boots without database access or with `DATABASE_URL` unset, it automatically initializes a **Fallback Code Seed Snapshot** compiled from hardcoded initial seed rules. The snapshot flags its state as `isDegradedSeedOnly: true`.

---

## 13. Boundaries Between Semantic, Taxonomy, Unit, and Value Normalization

To maintain architectural decoupling, each pipeline stage enforces strict boundaries:

```
[Raw Post / Dispatch Text]
            │
            ▼
┌───────────────────────────────────────────────────────────┐
│ Stage 1: Entity & Taxonomy Classification                 │
│ (src/entities/normalization/taxonomy.ts)                  │
│ Responsibility: Identifies system propulsion,             │
│ installation, and protocol.                               │
│ BOUNDARY: Never touches attribute names or measurements.  │
└───────────────────────────────────────────────────────────┘
            │
            ▼
┌───────────────────────────────────────────────────────────┐
│ Stage 2: Semantic Resolution                              │
│ (Proposed Phase 3 Isolated Resolver)                      │
│ Responsibility: Maps raw attribute names to Canonical IDs.│
│ BOUNDARY: Never alters numbers, units, or evidence text.  │
│ If unresolved: leaves canonicalId undefined.              │
└───────────────────────────────────────────────────────────┘
            │
            ▼
┌───────────────────────────────────────────────────────────┐
│ Stage 3: Unit Normalization & Value Parsing               │
│ (src/entities/normalization/units.ts, numeric.ts)         │
│ Responsibility: Parses numeric strings/ranges and converts│
│ units to canonical dimensions.                            │
│ BOUNDARY: Operates ONLY if Stage 2 provided a valid       │
│ canonicalId. Never alters semantic meaning.               │
└───────────────────────────────────────────────────────────┘
            │
            ▼
┌───────────────────────────────────────────────────────────┐
│ Stage 4: Plausibility & Auto-Correction Detection         │
│ (src/entities/drone/auto-correction.ts)                   │
│ Responsibility: Checks physical plausibility bounds and   │
│ detects unit slips.                                       │
│ BOUNDARY: Consumes canonicalId to look up bounds. Never   │
│ rewrites terms or modifies quotes.                        │
└───────────────────────────────────────────────────────────┘
            │
            ▼
┌───────────────────────────────────────────────────────────┐
│ Stage 5: Claim Verification & Audit Gates                 │
│ (src/entities/drone/verification.ts, audit.server.ts)     │
│ Responsibility: Evaluates whether source quote supports   │
│ the assertion and checks participant identity.            │
│ BOUNDARY: Semantic resolution does NOT influence whether  │
│ a claim is factually verified.                            │
└───────────────────────────────────────────────────────────┘
```

---

## 14. Governance and Approval Lifecycle

```
[Candidate Term Observed in Extraction]
                   │
                   ▼
[Recorded in semantic_candidates Queue]
                   │
                   ▼
[Analyst Reviews via Proposal Workflow]
                   │
       ┌───────────┴───────────┐
       ▼                       ▼
   [Rejected]             [Approved]
                           │
                           ▼
          [Appended to semantic_alias_revisions]
                           │
                           ▼
          [Compile New Snapshot Manifest]
                           │
                           ▼
          [Analyst Activates Snapshot (Version Bump)]
                           │
                           ▼
          [Runtime Cache Invalidated within 30s]
```

### Governance Invariants

1. **No Autonomous Promotion:** `AUTO_APPLY_TIERS` remains empty (`[]`). All new semantic mappings require explicit analyst approval.
2. **Audit Ledgering:** Snapshot activations and deprecations write an event to `autonomy_events` ([`src/shared/infra/autonomy/ledger.server.ts`](../src/shared/infra/autonomy/ledger.server.ts)) with action `semantic_snapshot_activated`.
3. **Rollback:** An analyst can activate an older snapshot version at any time. The database merely updates the active snapshot pointer, immediately restoring prior resolution behavior.

---

## 15. Offline Shadow Evaluation and Observability

> **Amendment — Phase 3.2 human-efficient evaluation (rev. 3).** The sampling and acceptance numbers below are the original Phase 3 target. They are superseded for Phase 3.2 by `docs/phase-3-2-human-efficient-evaluation-plan.md`:
>
> - **2,160 examples and 60/stratum are an aspirational future benchmark, not a prerequisite for continuing development.**
> - A small pilot may be used **exploratively**; its metrics carry evidence labels (`exploratory`, `target_not_demonstrated`), never "passed".
> - **Insufficient evidence is reported as insufficient**, never as approval. In the primary worst-case view it is counted against the resolver; the conditional view is descriptive and carries no confidence bound.
> - The 98% / 95% / 99% targets remain the long-term acceptance criteria for any **autonomy or production-integration decision**. Those phases keep their own quality gates and are **not unlocked by 3.2**.
> - Tier 1 (unit/adversarial safety fixtures) stays a **100% hard blocker**.
> - The stratification matrix is a **proposed pilot frame**: 4 languages (including `unknown`) × 12 families × 2 resolver statuses = 96 possible cells, with a **total ceiling** (72 draws) instead of a per-cell quota; empty and unsampled cells are reported.
> - **Blind verdicts are the primary labels; post-reveal revisions are diagnostics only.**
>
> The 3.2 implementation freezes a frame, runs the resolver on the whole frame, and samples a seeded simple random sample within each non-empty cell. When a non-empty cell receives no draw, the exact bound is refused rather than caveated; only the covered fraction of the population is reported as measured.

To satisfy the non-destructive safety requirement, the new resolver will **not** be integrated into production ingest during initial implementation.

### Isolated Evaluation Harness

- **Offline Execution:** An offline script (`scripts/evaluate-semantic-registry.ts`) reads stored dispatch extractions and frozen test fixtures.
- **Comparative Execution:** Evaluates both legacy `semanticKeyFor()` and the new `resolveSemantic()` against each extraction.
- **Dedicated Diagnostic Persistence:** Results are written to a dedicated, bounded diagnostic collection (`semantic_evaluation_runs`), **not** to the core `autonomy_events` ledger.

```typescript
// Proposed diagnostic storage interface
export interface SemanticEvaluationSummary {
  readonly runId: string;
  readonly evaluatedAt: string;
  readonly corpusSize: number;
  readonly snapshotVersion: number;
  readonly snapshotHash: string;
  readonly metrics: {
    readonly totalSpecs: number;
    readonly resolvedCount: number;
    readonly resolutionCoverage: number;
    readonly legacyAgreementRate: number;
    readonly legacyDisagreementCount: number;
    readonly unresolvedContextCount: number;
    readonly unresolvedAmbiguousCount: number;
    readonly unresolvedUnknownCount: number;
  };
  readonly representativeMismatches: readonly {
    readonly rawKey: string;
    readonly rawLabel?: string;
    readonly legacyResult: string;
    readonly hybridResult?: string;
    readonly status: string;
    readonly rationale: string;
  }[];
}
```

### Three-Tier Evaluation Material

Volume alone (e.g. 2,000 raw posts) is not a quality guarantee; a random historical sample tends to be dominated by common `speed` and `range` terms while underrepresenting difficult, rare, and high-risk technical attributes. Evaluation therefore combines three distinct test materials:

1. **The Complete Existing Normalization Corpus:** Replays 100% of the existing fixture corpus (`src/test/fixtures/normalization-corpus.ts`).
2. **Frozen Stratified Historical Sample:** A fixed sample stratified across both **language** and **semantic attribute family**, selected via a deterministic, reproducible sampling methodology.
3. **Dedicated Adversarial & Boundary Set:** Specifically constructed test cases targeting known conflation traps, polysemous abbreviations, homonyms across system classes (e.g. USV width vs radar angle), and edge cases identified during repository analysis.

### Reproducible Sampling Methodology for Historical Material

To guarantee that the historical evaluation sample can be reconstructed identically by any auditor or test run:

1. **Population and Cutoff Window:** The sampling population comprises all dispatches and extracted specifications stored in PostgreSQL up to a frozen cutoff timestamp (`2026-11-01T00:00:00Z`). Later posts are excluded.
2. **Post-Level Deduplication:** Ingestion feeds frequently syndicate identical dispatches across multiple outlets. Posts are deduplicated prior to stratification using the dispatch `contentHash` (SimHash) and text hash. A syndicated report contributes to the sampling pool only once.
3. **Stratification Matrix (Language × Attribute Family):**
   - _Languages (4 in the Phase 3.2 pilot):_ English (`en`), Ukrainian (`uk`), Russian (`ru`), and `unknown` (a reported stratum, not a discarded bucket).
   - _Semantic Families & Programme Metadata (12):_
     1. `speed.` (max, cruise, dive, stated, target)
     2. `range.` (max, operational, combat radius, link, engagement, detection)
     3. `altitude.` (max, service ceiling, target ceiling/floor)
     4. `payload.` (capacity, mass, warhead)
     5. `weight.` (mtow, empty, launch, total)
     6. `dimension.` (length, wingspan, height, width/beam, diameter, depth, caliber)
     7. `power.` (rf jammer power, engine output)
     8. `endurance.` (flight duration)
     9. `maneuver.` (load factor g)
     10. `capacity.` (fuel volume, target channels)
     11. `cost.` (unit procurement price)
     12. `other_programme_metadata` (explicit category capturing `production.rate_monthly`, `inventory.deployed_count`, `guidance.system`, and long-tail unclassified raw extraction keys, preventing them from falling outside the sampling plan).
   - _Total Strata Cells:_ $4 \times 12 \times 2 = 96\text{ possible cells}$ in the Phase 3.2 pilot (language × family × resolver status). The resolver is run on the whole frame, so each cell's population $N_h$ is known. Many cells are empty; empty cells are reported.
4. **Sample Ceiling, not a per-cell quota (Phase 3.2):**
   - At most **72 examples in total** may be _drawn_, never auto-exported (review export defaults to `--limit 5`). This is a ceiling for a small exploratory pilot; the former 60-per-cell / 2,160-context target is aspirational future work, not a prerequisite.
   - Within each non-empty cell the draw is a plain seeded simple random sample; allocation across cells uses largest remainder with small cells taken whole. Because 72 < 96, some non-empty cells legitimately receive no draw — these are reported as `unsampled`, never backfilled from another cell.
5. **Handling of Small or Empty Strata (Phase 3.2):**
   - A cell with fewer instances than its allocation is taken whole. Deficits are never backfilled with common attributes (`speed` or `range`), as doing so would distort family representation.
   - Empty, undersaturated and unsampled strata are explicitly recorded in the sampling manifest and the sampling report, together with the covered fraction of the population.
   - An overall population bound is emitted only when every non-empty cell of the relevant subpopulation was sampled. Otherwise the report gives per-cell results plus the covered fraction and states that the unsampled remainder is unmeasured.
6. **Fixed Random Seed and Content Hash:**
   - The sampling script (`scripts/sample-historical-evaluation-set.ts`) uses a deterministic PRNG initialized with a fixed constant seed string:
     `SEED = "drone-intel-hub-phase3-eval-20261115"`.
   - The sampled records are serialized to a versioned fixture file: `src/test/fixtures/historical-stratified-sample.json`.
   - The fixture is stamped with a computed SHA-256 content hash in a companion manifest (`historical-stratified-sample.manifest.json`).
   - Running the sampling script against the frozen database cutoff produces a bitwise identical dataset.
   - The Phase 3.2 implementation realises this as `examples.jsonl`, `predictions.jsonl` and `manifest.json` in `src/test/fixtures/semantic-eval/`; the fixture above remains a planned future form.

### Reference Corpus Ground Truth and Review Model

Measuring genuine semantic correctness requires comparison against human ground truth rather than automated consensus or model predictions. The reference corpus (`src/test/fixtures/semantic-reference-corpus.ts`) is governed by an explicit review model:

```typescript
// Proposed schema for human-reviewed ground truth cases
export interface SemanticReferenceCase {
  readonly id: string; // e.g. "ref-case-0142"
  readonly input: {
    readonly rawKey: string;
    readonly rawLabel?: string;
    readonly rawUnit?: string;
    readonly evidenceText?: string;
  };
  readonly context: {
    readonly systemClass?: string;
    readonly domain?: string;
    readonly subsystem?: string;
    readonly language: string;
  };
  /** Expected resolution state: either "resolved" or an explicit unresolved code */
  readonly expectedStatus: SemanticResolutionStatus;
  /** Defined IF AND ONLY IF expectedStatus === "resolved" */
  readonly expectedCanonicalId?: string;
  /** True when this case deliberately tests withholding on ambiguous or insufficient context */
  readonly isNegativeCase: boolean;
  /** Comprehensive analytical justification for why this outcome is correct */
  readonly rationale: string;
  readonly reviewProvenance: {
    readonly analyst: string;
    readonly reviewedAt: string;
    readonly notes?: string;
  };
}
```

#### Mandatory Ambiguity, Negative Cases, and Statistical Metrics

- The reference corpus must explicitly contain at least **30% negative or ambiguous test cases** (e.g., bare `radius` without context, `power` on an unknown system, `effective_range` on a UAV where engagement vs link range cannot be deduced).
- **Statistical Metrics for Withholding and Resolution:**
  To evaluate the system's safety and precision without conflating true negative rates with positive predictive value, we specify distinct statistical formulations:

  $$\text{Withholding Recall (Specificity on Negative Cases)} = \frac{\text{Correctly Unresolved Negative Cases}}{\text{All Actual Negative / Ambiguous Cases in Reference Set}}$$
  _Measures whether the system reliably detects and withholds on terms that should not be resolved._

  $$\text{Withholding Precision} = \frac{\text{Correctly Unresolved Negative Cases}}{\text{All Cases Where Resolver Withheld (Total Unresolved Outcomes)}}$$
  _Measures whether the system's decision to withhold was justified, ensuring it does not excessively withhold on terms that possess sufficient context for safe resolution._

  $$\text{Resolution Precision (on positive mappings)} = \frac{\text{Correctly Resolved Valid Cases}}{\text{All Cases Where Resolver Mapped to a Canonical ID}}$$
  _Measures the correctness of positive assignments, proving that mapped concepts match human truth._

  $$\text{Withholding } F_1 = 2 \times \frac{\text{Withholding Precision} \times \text{Withholding Recall}}{\text{Withholding Precision} + \text{Withholding Recall}}$$

- A resolver that achieves high resolution coverage by guessing on ambiguous terms will fail the Withholding Recall benchmark. Conversely, a resolver that refuses to resolve valid synonyms will fail the Withholding Precision benchmark.

#### Stratum-Level Reporting and Population-Weighted Error Estimation

Because the Phase 3.2 frame is sampled with a **total ceiling and no per-cell quota**, raw aggregated metric averages would misrepresent the frozen population: common strata would dominate and unsampled cells would be silently treated as measured. Rare strata (e.g. load factor) must not be given equal weight with high-volume strata (e.g. speed) merely because a few were drawn.

To avoid this distortion, evaluation telemetry enforces two reporting standards:

1. **Cell-Level Metric Breakdown:** All metrics (resolution precision, withholding precision, withholding recall) are reported individually across the sampled cells of the 96-cell frame ($4\text{ languages} \times 12\text{ families} \times 2\text{ resolver statuses}$), with empty and unsampled cells listed separately.
2. **Count-Based Population Estimation:** Weights are applied to **counts** ($N_h \times$ share), never to a ratio of ratios. For an error share in a finite population with known $N_h$ and a seeded SRS within each cell, the exact hypergeometric stratified bound applies to the error count; the bound is divided by the known population total. Withholding recall is a ratio of two estimated counts from the resolved (R) and withheld (W) subpopulations, so it is bounded **componentwise** at $\alpha/2$ and reported as conservative — no single-population bound is claimed for the ratio.
   $$\text{Recall}_{\text{lower}} = \frac{L_{TN,W}}{L_{TN,W} + U_{FN,R}}$$
   Conditional performance among assessable units is descriptive only and carries no confidence bound. A bound is refused when a non-empty cell has no draw, the search is incomplete, or protocol versions are mixed.

### Measuring Actual Semantic Correctness

Evaluation strictly separates:

- **Resolution Coverage:** Percentage of extracted attributes assigned a canonical ID. High coverage is not proof of correctness.
- **Legacy Parity:** Frequency of agreement with `semanticKeyFor()`. Legacy behavior contains known flaws; therefore, 100% parity is neither expected nor desired.
- **Human-Reviewed Correctness:** Precision, recall, and withholding accuracy measured directly against `src/test/fixtures/semantic-reference-corpus.ts`. Correctness is measured against human ground truth, never by automated consensus.

---

## 16. End-to-End Resolution Scenarios

### Scenario 1: Direct Multilingual Alias (Class 1)

- **Input:** `rawKey: "vitesse_maximale"`, `rawLabel: "Vitesse maximale"`, `context: { domain: "Air", rawUnit: "km/h" }`
- **Algorithm Trace:** Gate 0 fails $\rightarrow$ Gate 1 matches Class 1 synonym rule `vitesse_maximale` $\rightarrow$ `speed.max`.
- **Resolution Result:**
  - `status`: `"resolved"`
  - `canonicalId`: `"speed.max"`
  - `aliasClass`: `"class1_synonym"`
  - `matchType`: `"literal_synonym"`
  - `matchedRuleId`: `"rule-speed-max-fr"`
  - `diagnostics`: `[]`
- **Explanation:** Direct French synonym for maximum speed. Unconditionally maps to `speed.max`.

### Scenario 2: Counter-UAS Envelope (Class 2 - Guard Satisfied)

- **Input:** `rawKey: "effective_range"`, `rawLabel: "Jamming Range"`, `context: { systemClass: "c-uas", subsystem: "jammer", domain: "Land", rawUnit: "km" }`
- **Algorithm Trace:** Gate 0 & 1 fail $\rightarrow$ Gate 2 matches rule `rule-range-eff-cuas` (requires `systemClass == 'c-uas'`). Guard check passes.
- **Resolution Result:**
  - `status`: `"resolved"`
  - `canonicalId`: `"range.engagement"`
  - `aliasClass`: `"class2_context"`
  - `matchType`: `"context_guard"`
  - `guardAudit`: `[{ guardName: "systemClasses", expected: ["c-uas", "ew"], actual: "c-uas", satisfied: true }]`
- **Explanation:** System is a C-UAS jammer. `effective_range` correctly represents engagement/jamming envelope.

### Scenario 3: Missing Context on Polysemous Term (Class 2 - Guard Failure)

- **Input:** `rawKey: "effective_range"`, `rawLabel: "Effective range"`, `context: { systemClass: undefined, domain: "Air", rawUnit: "km" }`
- **Algorithm Trace:** Gate 0 & 1 fail $\rightarrow$ Gate 2 matches candidate rule `rule-range-eff-cuas`. System class guard fails.
- **Resolution Result:**
  - `status`: `"unresolved_context"`
  - `canonicalId`: `undefined`
  - `aliasClass`: `"class2_context"`
  - `guardAudit`: `[{ guardName: "systemClasses", expected: ["c-uas", "ew"], actual: undefined, satisfied: false }]`
  - `diagnostics`: `["Context guard 'systemClasses' failed: actual was undefined"]`
- **Explanation:** Without knowing whether the system is an effector or a reconnaissance UAV, the system refuses to guess. Fails safe.

### Scenario 4: Qualified Concept (Class 3)

- **Input:** `rawKey: "cruising_speed"`, `rawLabel: "Cruise Speed"`, `context: { domain: "Air", rawUnit: "km/h" }`
- **Algorithm Trace:** Gate 0 & 1 fail $\rightarrow$ Gate 2 fails $\rightarrow$ Gate 3 matches Class 3 concept rule `cruising_speed` $\rightarrow$ `speed.cruise`.
- **Resolution Result:**
  - `status`: `"resolved"`
  - `canonicalId`: `"speed.cruise"`
  - `aliasClass`: `"class3_qualified"`
  - `matchType`: `"literal_synonym"`
- **Explanation:** Successfully resolves to `speed.cruise`. Preserves distinct identity from `speed.max`, preventing grouping collisions.

### Scenario 5: Known Ambiguous Term (Class 4)

- **Input:** `rawKey: "radius"`, `rawLabel: "Radius"`, `context: { domain: "Air", rawUnit: "km" }`
- **Algorithm Trace:** Gates 0–3 fail $\rightarrow$ Gate 4 matches Class 4 ambiguous entry `rule-radius-ambig`.
- **Resolution Result:**
  - `status`: `"unresolved_ambiguous"`
  - `canonicalId`: `undefined`
  - `aliasClass`: `"class4_ambiguous"`
  - `diagnostics`: `["Term 'radius' is known ambiguous: candidate interpretations: range.combat_radius, maneuver.turn_radius, range.engagement"]`
- **Explanation:** The bare noun "radius" is polysemous. Automatically resolves to undefined; flags candidates for review.

---

## 17. Testing and Acceptance Criteria

### Unit and Adversarial Test Requirements

Testing is structured into two clearly separated verification tiers to eliminate any ambiguity between unit-level invariants and corpus-level benchmarks:

- **Tier 1 (Deterministic & Adversarial Safety Fixtures):** Requires a **100% pass rate** on all explicit unit tests in `src/test/semantic-registry-isolated.test.ts`. Any failure in Gate 0–5 precedence, manifest validation, immutability, or adversarial pair non-conflation is a hard blocker.
- **Tier 2 (Corpus-Level Benchmark on Human Ground Truth):** Evaluated against human-reviewed decisions on the frozen pilot frame. This tier is the long-term acceptance gate for **autonomy or production-integration decisions**, which keep their own quality gates and are **not unlocked by Phase 3.2**. A 3.2 pilot is exploratory: its metrics carry evidence labels (`exploratory`, `target_not_demonstrated`), never "passed". Insufficient evidence is reported as insufficient, never as approval.

A dedicated test suite (`src/test/semantic-registry-isolated.test.ts`) must prove the following invariants:

1. **Manifest Integrity:**
   - `isValidCanonicalId("speed.max") === true`
   - `isValidCanonicalId("range.fake_entry") === false`
   - `isValidCanonicalId("speed.") === false` (Prefixes are not concepts)

2. **Adversarial Non-Conflation Tests:**
   - `resolve("top_speed")` $\neq$ `resolve("cruising_speed")` (`speed.max` vs `speed.cruise`)
   - `resolve("warhead_weight")` $\neq$ `resolve("payload_capacity")` (`payload.warhead` vs `payload.capacity`)
   - `resolve("service_ceiling")` $\neq$ `resolve("max_altitude")` (`altitude.service_ceiling` vs `altitude.max`)
   - `resolve("combat_radius")` $\neq$ `resolve("max_range")` (`range.combat_radius` vs `range.max`)
   - `resolve("beam", { domain: "Sea" })` resolves to `dimension.width`; `resolve("beam", { domain: "Air", rawUnit: "deg" })` fails safe to unresolved.
   - `resolve("max_g", { rawUnit: "g" })` resolves to `maneuver.load_factor_max` (`g_load`); `resolve("weight", { rawUnit: "g" })` resolves to `weight.total` (`kg`).
   - `resolve("jamming_power")` resolves to `power.rf`; `resolve("engine_power")` resolves to `power.engine`.

3. **Determinism and Offline Invariance:**
   - Executing 10,000 resolutions of identical inputs produces bitwise identical results.
   - Zero network calls and zero database queries are triggered during resolution.
   - The resolver operates successfully with `DATABASE_URL` unset.

4. **Snapshot Immutability Tests:**
   - Mutating properties on a returned resolution result does not alter subsequent resolver calls.
   - Internal snapshot state cannot be modified by external consumers.

5. **No Legacy Backdoor Fallback:**
   - Querying an unindexed term (e.g. `hypothetical_laser_emitter`) returns `status: "unresolved_unknown"` and `canonicalId: undefined`.
   - Under no circumstances does the resolver fall back to `semanticKeyFor()` or return the raw input key as a canonical ID.
   - Spy/mock assertions verify that `semanticKeyFor` execution count is zero during hybrid resolver runs.

6. **Withholding Precision and Recall on Human Decisions (Phase 3.2; the Phase 3.1 unit tests are only a 100% regression guard and do not measure these thresholds):**
   - The long-term targets remain **Withholding Recall $\ge 98\%$**, **Withholding Precision $\ge 95\%$** and **Resolution Precision $\ge 99\%$**, measured against human **blind** verdicts on the frozen frame. Post-reveal revisions are diagnostics only.
   - For a 3.2 pilot these are **estimands with evidence labels, not passes**. A small sample may only emit `exploratory` or `target_not_demonstrated`; a bound is refused when a non-empty cell has no draw or protocols are mixed.
   - Tier 1 (deterministic/adversarial safety fixtures) stays a **100% hard blocker** regardless of any corpus-level figure.

---

## 18. Revised Implementation Roadmap

Implementation must proceed in decoupled, independently reviewable stages:

```
+──────────────────────────────────────────────────────────────────────────────────────────────────+
| Phase 3.0: Architecture, Canonical Manifest & Model Approval (Documentation Only)                |
| - Commit docs/phase-3-hybrid-semantic-registry.md                                                |
| - Review and sign off by lead architect                                                          |
| - Non-goals: No code or database changes.                                                        |
+──────────────────────────────────────────────────────────────────────────────────────────────────+
                                                  │
                                                  ▼
+──────────────────────────────────────────────────────────────────────────────────────────────────+
| Phase 3.1: Isolated Pure Resolver & Code Manifest                                                |
| - Implement src/entities/normalization/canonical-manifest.ts                                     |
| - Implement src/entities/normalization/semantic-resolver.ts (pure, zero DB dependencies)         |
| - Implement unit test suite verifying Gate 0-5 precedence and adversarial pairs                  |
| - Implement semantic-result.ts and sha256.ts (pure, no external imports)                         |
| - Non-goals: No database migrations; no hot-path production modifications.                       |
+──────────────────────────────────────────────────────────────────────────────────────────────────+
                                                  │
                                                  ▼
+──────────────────────────────────────────────────────────────────────────────────────────────────+
| Phase 3.2: Human-Efficient Evaluation Infrastructure                                             |
| - S0 automated replay + property suite (100% on Tier 1 safety invariants)                        |
| - S1/S2 data model, protocol v1, whole-frame replay, seeded sampler (dry run)                     |
| - S3/S4 AI suggestions and two-step blind/reveal CSV review; export defaults to --limit 5         |
| - S5 evidence-labelled metrics with exact, refused-when-unsupported finite-population bounds     |
| - Five-card feasibility gate G3 decides whether ANY further annotation is justified              |
| - 2,160 examples / 60 per stratum and the 98/95/99% targets are long-term criteria, NOT a 3.2 gate|
| - Non-goals: Production claims, ingest, consensus, gates and AUTO_APPLY_TIERS unchanged.          |
+──────────────────────────────────────────────────────────────────────────────────────────────────+
                                                  │
                                                  ▼
+──────────────────────────────────────────────────────────────────────────────────────────────────+
| Phase 3.3: Database Schema & Immutable Snapshot Compiler                                         |
| - Migration 029_semantic_registry.sql (semantic_alias_revisions, semantic_registry_snapshots)    |
| - Incremental rule curation: migrate individual vetted rules (Option B), not bulk dump           |
| - Snapshot compiler with SHA-256 content addressability                                          |
| - 30-second TTL cache in src/shared/infra/normalization/semantic-registry.server.ts              |
| - Fallback code seed resilience tests (database outage simulation)                               |
| - Non-goals: Ingestion does not read from registry yet.                                          |
+──────────────────────────────────────────────────────────────────────────────────────────────────+
                                                  │
                                                  ▼
+──────────────────────────────────────────────────────────────────────────────────────────────────+
| Phase 3.4: Offline Shadow Replay & Evaluation Report                                             |
| - Implement scripts/evaluate-semantic-registry.ts                                                |
| - Replay the three-tier corpus offline; generate SemanticEvaluationSummary                       |
| - Review representative mismatches with analysts against human-reviewed ground truth             |
| - Non-goals: Zero writes to production drones or autonomy_events.                                |
+──────────────────────────────────────────────────────────────────────────────────────────────────+
                                                  │
                                                  ▼
+──────────────────────────────────────────────────────────────────────────────────────────────────+
| Phase 3.5: Curation & Governance Tools                                                           |
| - UI for candidate review, alias proposals, and snapshot activation                              |
| - Rollback and deprecation workflows                                                             |
| - Non-goals: AUTO_APPLY_TIERS remains empty.                                                     |
+──────────────────────────────────────────────────────────────────────────────────────────────────+
                                                  │
                                                  ▼
+──────────────────────────────────────────────────────────────────────────────────────────────────+
| Separate Future Stage: Production Integration (Requires Independent Approval)                    |
| - Wire resolver into normalizeSpec() in apply.ts                                                 |
| - Update spec-engine.ts regroup() and sameAttribute()                                            |
| - Comprehensive staging deployment and canary audit                                              |
+──────────────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 19. Architectural Decisions, Approved Directions, and Risk Management

### Identified Risks and Mitigations

| Risk                                                                                                                    | Severity | Mitigation Strategy                                                                                                    |
| :---------------------------------------------------------------------------------------------------------------------- | :------- | :--------------------------------------------------------------------------------------------------------------------- |
| **Silent Parity Breakage:** Divergence between legacy `semanticKeyFor` and hybrid resolver breaks existing assumptions. | High     | Phase 3.2 explicit parity bench: all intentional divergences must be documented and tested against reference fixtures. |
| **Over-reliance on Context:** Extraction pipeline fails to supply `systemClass` or `domain`.                            | Medium   | Gate 2 fails safe to `unresolved_context`. Unresolved state preserves raw key and prevents erroneous grouping.         |
| **Database Connection Failure:** Server unable to refresh snapshot on boot.                                             | Low      | Resolver initializes seamlessly from static code seed. Cold-start never throws.                                        |
| **Audit Ledger Pollution:** Shadow evaluation records thousands of debug events.                                        | Medium   | Shadow evaluation telemetry is written to dedicated evaluation run tables, completely bypassing `autonomy_events`.     |

### Approved Architectural Decisions for Phase 3 Implementation

The following three architectural decisions have been explicitly reviewed and approved:

1. **Initial Seed Rule Migration: Option B Approved (Incremental Curation)**
   - **Decision:** We do **not** automatically batch-convert all 58 procedural rules from `semantic.ts` into database seed revisions in migration `029`.
   - **Rationale:** `semantic.ts` contains complex procedural logic: sequential precedence rules, label-dependent matching, regex conditions, noun-counting (`countSemantic()`), and delicate domain heuristics (e.g. `effective_range`, bare `range`, `range_min`). A bulk conversion risks populating the database with rules that appear uniform but subtly deviate from existing behaviour.
   - **Action Plan:**
     - Retain current `semantic.ts` as a frozen baseline and legacy fallback.
     - Build the new hybrid resolver with a clean, discrete, and curated seed set.
     - Incrementally migrate existing rules individually once their semantics, precedence, and context guards have been explicitly documented.
     - Require a dedicated regression test for each migrated rule prior to snapshot activation.

2. **Shadow Replay Scope: Three-Tier Stratified Corpus Approved**
   - **Decision:** Replay volume alone is not a quality guarantee; a random historical sample overrepresents common `speed` and `range` terms while omitting complex and long-tail attributes.
   - **Action Plan:** The offline evaluation harness (`scripts/evaluate-semantic-registry.ts`) will evaluate against three combined test materials:
     1. **Complete Existing Normalization Corpus:** Replays 100% of `src/test/fixtures/normalization-corpus.ts`.
     2. **Frozen Stratified Historical Sample:** A fixed corpus stratified across both **language** (English, Ukrainian, Russian) and **semantic attribute family** (propulsion/engine power, RF/jamming, payload/warhead mass, airframe dimensions, operational limits).
     3. **Dedicated Adversarial & Boundary Set:** Specifically constructed cases targeting known conflation traps, homonyms across system classes, and ambiguous abbreviations.
     4. **Human-Reviewed Reference Ground Truth:** Actual semantic correctness is measured strictly against human-reviewed mappings, never against automated consensus.

3. **Handling of Legacy Specs with Unmapped Semantics: Approved**
   - **Decision:** Existing claims and stored specs in `drones.data` remain **completely untouched**.
   - **Action Plan:** Unmapped raw keys in historical claims are preserved. Any future reinterpretation or normalization of historical claims will take place strictly via a separate, versioned backfill script (`scripts/renormalize-claims.ts`) featuring dry-run mode, impact reporting, and explicit human sign-off during a future production integration stage.

---

## 20. Summary of Changes from the Previous Specification

1. **Fixed Canonical Concept Validation:**
   - _Previous:_ Used `registryEntryFor(canonicalId)` to validate concepts, which erroneously accepted any string matching a family prefix (e.g. `range.anything`).
   - _Revised:_ Introduced `CANONICAL_CONCEPTS` and `isValidCanonicalId()` as an exact code-owned allowlist. Prefix matching in `core-registry.ts` is restricted to metadata lookup on valid concepts.
2. **Corrected Four-Class Alias Model:**
   - _Previous:_ Conflated sub-concepts (`cruise_speed`, `service_ceiling`) as "qualified aliases" of parent concepts, creating severe risks of accidental consensus merging.
   - _Revised:_ Clarified that `speed.cruise` and `altitude.service_ceiling` are distinct canonical concepts. Class 3 represents specific concepts mapping to their own distinct canonical IDs.
3. **Explicit Unresolved States:**
   - _Previous:_ Grouped all unknown terms into Class 4 Ambiguous.
   - _Revised:_ Established clear distinctions between `unresolved_context`, `unresolved_conflict`, `unresolved_ambiguous`, `unresolved_unknown`, and `unresolved_deprecated`.
4. **Eliminated Uncalibrated Confidence Floats:**
   - _Previous:_ Assigned arbitrary numeric confidences (`1.0`, `0.85`, `0.70`).
   - _Revised:_ Replaced numbers with structured audit metadata (`matchType`, `guardAudit`, `status`).
5. **Genuinely Immutable Snapshots:**
   - _Previous:_ Relied on mutable tables with `updated_at` queries and shallow `Object.freeze()`.
   - _Revised:_ Implemented SHA-256 content-addressed immutable snapshots, append-only revisions, and encapsulated read-only lookup interfaces.
6. **Corrected Server TTL Invariant:**
   - _Previous:_ Assumed a 60-second TTL based on an unbuilt roadmap note.
   - _Revised:_ Verified and aligned with the actual 30-second TTL (`TTL_MS = 30_000`) used by `rule-registry.server.ts`.
7. **Removed Hot-Path Shadow Integration:**
   - _Previous:_ Proposed instrumenting `normalizeSpec()` in production ingest immediately.
   - _Revised:_ Moved shadow evaluation to an offline replay script and dedicated evaluation run model, preserving total production isolation.
8. **Removed Early Normalizer Proposal Applier:**
   - _Previous:_ Proposed implementing `normalizerApplier` during Phase 3.1.
   - _Revised:_ Kept proposal applier implementation deferred until governance and curation tools are built (Phase 3.5); `AUTO_APPLY_TIERS` remains empty.
9. **Protected the Autonomy Event Ledger:**
   - _Previous:_ Proposed logging all shadow evaluation comparisons to `autonomy_events`.
   - _Revised:_ Restricted `autonomy_events` to true governance decisions (snapshot activations), preventing telemetry bloat.
10. **Class 4 Schema Realignment (Nullable `canonical_id`):**
    - _Previous:_ Defined `canonical_id TEXT NOT NULL` in `semantic_alias_revisions`, which conflicted with Class 4 terms having multiple or zero resolved meanings.
    - _Revised:_ Made `canonical_id` nullable, added `candidate_canonical_ids JSONB`, and enforced a CHECK constraint requiring candidate arrays for Class 4 and exact canonical IDs for Classes 1–3.
11. **Composite Snapshot Content Addressability:**
    - _Previous:_ Computed hash only over database alias rules.
    - _Revised:_ Bound the SHA-256 content hash to a composite digest encompassing the compiler resolver version, canonical manifest version, manifest hash, and core registry version.
12. **Database-Enforced Immutability Triggers:**
    - _Previous:_ Immutability was described conceptually but lacked database-level enforcement against `UPDATE` and `DELETE`.
    - _Revised:_ Added PostgreSQL triggers raising exceptions on any `UPDATE` or `DELETE` against `semantic_alias_revisions` and `semantic_registry_snapshots`.
13. **Statistical Formulation of Withholding Metrics:**
    - _Previous:_ Formulated Withholding Precision with total negative cases as the denominator.
    - _Revised:_ Formally separated _Withholding Recall_ (denominator: all negative cases in reference set) from _Withholding Precision_ (denominator: all instances where resolution withheld).
14. **Expanded Historical Stratification Matrix:**
    - _Previous:_ 11 attribute families, which risked dropping programme-level metadata or unclassified terms.
    - _Revised:_ Added `other_programme_metadata` as the 12th category (covering production rate, inventory count, guidance, and unclassified attributes), yielding a robust 36-cell matrix.
15. **Repository-Relative File Links:**
    - _Previous:_ Contained local `file:///C:/dev/...` links.
    - _Revised:_ Converted all file references to standard repository-relative Markdown links (`../src/...`).
16. **Strict Class 4 CHECK Constraint and Candidate Target Validation:**
    - _Previous:_ Simple nullability check without verifying JSON structure.
    - _Revised:_ Enforced `jsonb_typeof(candidate_canonical_ids) = 'array'` and `jsonb_array_length(candidate_canonical_ids) > 0` at DB level; enforced compiler validation that every candidate target exists in `CANONICAL_CONCEPTS`.
17. **TypeScript Discriminated Union Model:**
    - _Previous:_ Single `SemanticAliasDefinition` interface with optional fields that allowed invalid state combinations.
    - _Revised:_ Explicit discriminated union (`Class1_3AliasDefinition | Class4AliasDefinition`) strictly mirroring DB constraints at compile time.
18. **Unicode-Aware Key Normalization and Gate 0 Separation:**
    - _Previous:_ Restricted ASCII/Cyrillic regex that stripped Swedish (å, ä, ö), Persian, and Chinese, while Gate 0 stripped dots from canonical IDs.
    - _Revised:_ Replaced with Unicode property escapes (`\p{L}`, `\p{N}`) for aliases; separated Gate 0 so canonical IDs are validated in their exact dot-notated form.
19. **Two-Tier Quality Gates and Count-Based Estimation (amended for Phase 3.2):**
    - _Previous:_ Thresholds (>=98%, >=95%, >=99%) read as required to complete Phase 3.2, alongside a contradictory 100% roadmap goal.
    - _Revised:_ 100% is strictly required on deterministic/adversarial unit safety fixtures (Tier 1, a hard blocker). The statistical targets are long-term acceptance criteria for autonomy/production-integration decisions and are not unlocked by 3.2. A 3.2 pilot is exploratory, labelled never "passed"; 2,160 examples / 60 per stratum are aspirational. Weights apply to counts, blind verdicts are the primary labels, and exact bounds are refused when sampling assumptions fail.
20. **Comprehensive Core Metadata Hash Binding:**
    - _Previous:_ Composite hash bound only `CORE_DIMENSIONS`.
    - _Revised:_ Expanded to `coreMetadataHash` binding `CORE_DIMENSIONS` and all attribute-specific tolerances, domains, and dimensions in `ENTRY_LIST` from `core-registry.ts`.
