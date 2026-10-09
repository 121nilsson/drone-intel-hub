# Drone OSINT Normalization — Implementation Plan

> This supersedes the first draft in [`normalization.md`](./normalization.md). It keeps the draft's
> intent (preserve raw text, deterministic conversions, extensible taxonomies, full provenance) but
> re-bases every file, symbol and storage decision on how this repository is actually built.

---

## 0. What the draft got wrong about this codebase

The draft was written against a generic FSD layout. These are the mismatches this plan corrects.

| Draft assumption                                                            | This repository actually has                                                                                              | Consequence for the plan                                                                                                                                                  |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/pages/`, `src/features/extraction/`, `src/features/consensus/`         | `src/features/{intake,dynamic-specs,sources,catalog,dossier,counterparts,briefing,settings}/`                             | No new feature slices for parsing. Normalizers live in `src/entities/`, the write path stays in `features/intake/pipeline.ts` and `features/dynamic-specs/spec-engine.ts` |
| Relational tables `taxonomies` / `taxonomy_aliases` / `taxonomy_candidates` | A **document store** abstraction (`DocumentStore`) with 5 JSONB collections, mirrored into 4 backends                     | Taxonomy becomes one new collection (`taxonomies`) plus one (`taxonomy_candidates`) — registered in 8 places, §7.3                                                        |
| "Dynamic taxonomies must be persisted in Lovable Cloud"                     | `DATABASE_URL` → `PostgresStore`; else Lovable Cloud `CloudStore`; browser → `LocalStorageStore`. All behind one contract | Same code path everywhere. No feature ever names a backend                                                                                                                |
| Consensus is a feature-level `consensus.ts` to be "upgraded"                | `src/entities/drone/consensus.ts`, a pure function over `SpecAttribute`                                                   | Consensus is _extended in place_, not rewritten — §8.4                                                                                                                    |
| `RFRole` includes `telemetry`/`tether`/`unknown`                            | `RFRole = "uplink" \| "downlink" \| "video" \| "gnss" \| "antijam"` only                                                  | Type must be widened first; `promote()` also hardcodes `role: "uplink"` for every raw band string — a real bug, §5.2                                                      |
| Tests co-located as `*.test.ts` next to sources                             | All tests in `src/test/*.test.ts`, run by `vitest run`                                                                    | New suites follow `src/test/normalization-*.test.ts`                                                                                                                      |
| Unknown taxonomy terms are an ingestion-time problem                        | Ingestion is already two-stage and lease-guarded (`collectSource` → `processPending`)                                     | Normalization runs **inside** `runTwoTier`, and must never throw, §6                                                                                                      |
| Currency conversion is "domain logic"                                       | No FX provider exists; the only network egress is the AI proxy (`*.server.ts`)                                            | Currency parsing is deterministic; USD estimation is opt-in and snapshot-based, §5.5                                                                                      |

Two more findings that change the design:

1. **The stored `band` string cannot be trusted.** In `src/entities/drone/seed.ts`, `lancet-3` has
   `{ role: "video", band: "L", freqMHz: [868, 915] }` — but 868–915 MHz is IEEE **UHF** / NATO
   **B**, not L. `geran-2` has `{ role: "uplink", band: "LTE/3G", freqMHz: [800, 2600] }`, which
   crosses three IEEE bands. Band labels must therefore be **recomputed from `freqMHz`**, with the
   stored `band` kept as raw evidence only.
2. **`LocalStorageStore.KEYS`, `postgres-store.server.ts` and `cloud-store.server.ts` all have
   non-exhaustive fallbacks.** `PostgresStore.upsert` ends in an `else` that writes the _sources_
   column layout; `CloudStore.row()` has the same `default:` branch. A new collection registered
   without an explicit case in both will silently write wrong columns. This is called out as a
   mandatory checklist item in §7.3.

---

## 1. Layer map (where each piece actually goes)

```
src/
├── entities/                          # domain model + PURE logic, no I/O
│   ├── drone/
│   │   ├── types.ts                   # SpecClaim, SpecAttribute, RFLink, Extraction  ← extended
│   │   ├── consensus.ts               # consensus()                            ← extended
│   │   └── relations.ts               # unchanged
│   └── normalization/                 # NEW — pure parsers & taxonomies
│       ├── types.ts                   # NormalizedQuantity, NormalizedRFLink, …
│       ├── numeric.ts                 # "25k" / "2,5" / "1 500" / "80–120"
│       ├── units.ts                   # distance, speed, mass, duration conversions
│       ├── currency.ts                # "$25k" → {amount, currency} (no FX)
│       ├── rf.ts                      # frequency parsing, IEEE/NATO bands, roles
│       ├── bands.ts                   # the two authoritative band tables
│       ├── propulsion.ts              # seeded propulsion taxonomy
│       ├── airframe.ts                # seeded airframe taxonomy
│       ├── taxonomy.ts                # registry type, alias resolution, candidates
│       ├── semantic.ts                # spec key → semantic kind (semanticSpecKey)
│       ├── apply.ts                    # normalizeExtraction() orchestration
│       └── index.ts                   # public surface
│
├── shared/
│   ├── contracts/
│   │   ├── repository.ts              # CatalogFacets                       ← extended
│   │   ├── store.ts                   # Collection, CollectionMap, Snapshot ← extended
│   │   └── taxonomy.ts                # NEW — TaxonomyRegistry (I/O seam)
│   ├── infra/
│   │   ├── local-repository.ts        # + LocalTaxonomyRepository, + candidate repo
│   │   ├── services.tsx               # + taxonomy wiring
│   │   ├── local-store.ts             # + KEYS entries
│   │   ├── postgres/postgres-store.server.ts   # + ORDER / upsert cases
│   │   └── cloud/cloud-store.server.ts         # + ORDER / row cases
│   └── ui/primitives.tsx              # + ConfidenceTag reuse only, no parsing
│
├── features/
│   ├── intake/pipeline.ts             # runTwoTier / promote / mergeSpecs call sites  ← extended
│   ├── dynamic-specs/spec-engine.ts   # mergeSpecs()                            ← extended
│   ├── catalog/catalog-page.tsx       # + normalized facets
│   ├── counterparts/counterparts-page.tsx  # upgrade overlap()
│   └── taxonomy/                      # NEW — analyst review UI (page only)
│
├── routes/taxonomy.tsx                # NEW route
└── test/
    ├── normalization-numeric.test.ts
    ├── normalization-units.test.ts
    ├── normalization-currency.test.ts
    ├── normalization-rf.test.ts
    ├── normalization-taxonomy.test.ts
    ├── normalization-apply.test.ts
    ├── consensus-normalized.test.ts
    └── taxonomy-store.test.ts
```

**Boundary rules enforced by review, not by tooling:**

- `src/entities/normalization/**` imports nothing from `features/`, `shared/infra/`, or React.
  It is the only place with regexes for quantities.
- `shared/contracts/taxonomy.ts` declares `TaxonomyRegistry`; `shared/infra/**` implements it.
  `entities/normalization/apply.ts` receives a registry — it never touches a store.
- UI components in `features/**` and `routes/**` call `normalizeExtraction`-derived data or the
  precomputed facets. No parsing in JSX. (The existing `catalog-page.tsx` facet derivation is
  about _reading_ already-normalized values, which stays.)

---

## 2. Guiding principles (unchanged from the draft, restated against real types)

1. **Raw is never overwritten.** `SpecClaim.value`, `RFLink.band` and the entire `RawDispatch.text`
   are append-only evidence. Normalized values are _additive, optional fields_.
2. **Deterministic core is pure and unit-tested.** Unit conversion, frequency parsing, band
   lookup: no randomness, no clock, no network. Same input → same output, forever.
3. **Living taxonomies are data, seeded in code, overridable in the store.** A new alias must not
   require a deployment; an unknown term must never become canonical automatically.
4. **AI extraction and deterministic normalization stay separate.** `IntelExtractor` returns an
   `Extraction`; normalization is a separate pure step that can be re-run without re-invoking a
   model. Re-running must be idempotent.
5. **Every normalized value carries its own confidence and its own provenance.** Extraction
   confidence stays where it is (`Extraction.confidence`); normalization confidence is computed by
   the parser and stored per claim.
6. **Unknown input degrades, never throws.** Ingestion already has a failure budget
   (`MAX_ATTEMPTS = 3`, batch `break` on provider error). A parser crash must not consume it.
7. **Read-time tolerance.** Anything written after this change is normalized at write time, but
   everything seeded or previously stored is normalized _lazily on read_. No backfill is a
   prerequisite for the feature working.

---

## 3. Data model — exact diffs against the current types

All changes are additive or optional. Nothing existing becomes non-assignable.

### 3.1 `src/entities/drone/types.ts`

```ts
// ── Widen the role union (draft §5.5) ────────────────────────────────────────
export type RFRole =
  | "uplink"
  | "downlink"
  | "video"
  | "gnss"
  | "antijam"
  | "telemetry" // NEW
  | "tether" // NEW — fiber-optic / wired control
  | "unknown"; // NEW

export interface RFLink {
  role: RFRole;
  /** Raw band label as written by the source. Evidence only; never recomputed into. */
  band: string;
  freqMHz?: [number, number];
  /** NEW — canonical, derived from freqMHz. Empty when freqMHz is absent. */
  ieeeBands?: string[];
  natoBands?: string[];
  protocols?: string[]; // NEW — ExpressLRS, OcuSync, Starlink, CRPA…
  /** NEW — true for fiber-optic / wire-guided control. */
  isFiberOptic?: boolean;
  /** NEW — 0..1, from role inference only. */
  confidence?: number;
  /** NEW — free-form tactical label, e.g. "Sub-GHz C2". */
  tacticalTag?: string;
  notes?: string;
}

// ── Claims carry normalization + provenance ──────────────────────────────────
export interface SpecClaim {
  value: number | string;

  /** NEW — verbatim text the value came from, when it was a string. */
  raw?: string;

  /** NEW — parsed, unit-converted representation. Absent = not parsed (not "unknown"). */
  normalized?: NormalizedQuantity;

  /** NEW — deterministic parser confidence, 0..1. */
  normalizationConfidence?: number;

  source: string; // existing display string, e.g. "GUR briefing" or "Telegram · https://…"
  sourceId?: string; // NEW — RawDispatch.id when ingested, for provenance joins
  /** NEW — the exact substring matched. */
  evidence?: string;
  /** NEW — extraction confidence at ingest time. */
  extractionConfidence?: number;
  date: string; // ISO
}

export interface SpecAttribute {
  key: string;
  label: string;
  unit?: string;

  /** NEW — semantic kind this attribute measures, e.g. "range.max". See §3.3. */
  semantic?: SemanticKey;

  /** NEW — canonical unit for `semantic`, so consensus needs no unit guessing. */
  canonicalUnit?: string;

  claims: SpecClaim[];
  discoveredBy: "seed" | "ai" | "analyst";
}
```

`SpecClaim` gains fields; every existing construction site still type-checks because all new
fields are optional.

### 3.2 `Extraction` gains a structured RF channel

```ts
export interface Extraction {
  // … unchanged …
  rfBands: string[]; // KEEP as raw evidence (heuristic emits "900 MHZ", AI emits anything)
  rf?: NormalizedRFLink[]; // NEW — output of the RF normalizer, derived from rfBands + raw text
  // …
}
```

`rfBands` stays the raw contract because both extractors already produce it and both are
unreliable in different ways (`heuristic-ai.ts` emits `"900 MHZ"` with an uppercased unit;
`openai-compatible-ai.ts` passes through whatever the model writes). Normalization consumes it and
produces `rf`.

### 3.3 Semantic keys — the fix for "don't merge different semantics"

Draft §7.1 is the single most valuable requirement and the current code violates it: `mergeSpecs`
groups by `key`, and the AI invents keys freely, so `"range"`, `"max_range"`, `"operational_range"`
become three attributes that the UI shows side by side as if they were one number.

Add `src/entities/normalization/semantic.ts`:

```ts
export type SemanticKey =
  | "range.max"
  | "range.operational"
  | "range.combat_radius"
  | "range.link"
  | "range.fiber_spool"
  | "speed.cruise"
  | "speed.max"
  | "speed.dive"
  | "altitude.max"
  | "altitude.service_ceiling"
  | "altitude.recommended"
  | "payload.warhead"
  | "payload.capacity"
  | "endurance.flight"
  | "cost.unit"
  | "cost.program"
  | "freq.control"
  | "freq.video"
  | "freq.gnss"
  | "freq.other"
  | "power.source"
  | "weight.total"
  | "dimensions.length"
  | "unknown";

/** Deterministic, seeded, and identity-preserving: unknown keys map to themselves. */
export function semanticKeyFor(key: string, label: string): SemanticKey;
```

`semanticKeyFor` is a pure lookup over a seeded alias table (`range` → `range.max`,
`max_range` → `range.max`, …) with **identity fallback** — `semanticKeyFor("jammers") ===
"jammers"`. Unknown keys therefore never collide and never break consensus; they simply stay
unclassified until an analyst adds a mapping.

`mergeSpecs` then matches on `semantic ?? key`. Because every legacy key maps to itself, existing
seed data and existing tests (`merge-drones.test.ts`, `pipeline-relations.test.ts`) keep their
current behaviour — the first-seen `key`/`label` is preserved on the merged attribute.

---

## 4. Deterministic core — API surface

### 4.1 `numeric.ts` — parsing numbers before there are units

The draft assumes English decimal points. This platform ingests Russian and Ukrainian sources, so
`"1,5"` must parse as 1.5 and `"1 500"` as 1500. `heuristic-ai.ts` already carries a `num()` helper
with exactly this ambiguity rule (grouping only when every group after the first is exactly three
digits and the first group has no leading zero). That rule is **promoted into `numeric.ts`** rather
than re-invented, and `heuristic-ai.ts` is refactored to call it — one implementation, one test
suite.

Exports:

```ts
parseNumber(s: string): number | undefined;      // "1,5" → 1.5, "1 500" → 1500, "2.5" → 2.5
parseMagnitude(s: string): number | undefined;   // "25k" → 25000, "2.5M" → 2_500_000, "500 млн" → 500e6
/** Range with the qualifier preserved. */
parseRange(raw: string): QuantityRange | undefined;
```

`QuantityRange` is the draft's `NormalizedNumericValue`, renamed to avoid colliding with the
domain word "quantity", and with the qualifier list the draft specified:

```ts
export interface QuantityRange {
  /** Representative value for display/sorting: the exact value, else the range midpoint. */
  value?: number;
  min?: number;
  max?: number;
  qualifier:
    "exact" | "approximate" | "up_to" | "at_least" | "less_than" | "greater_than" | "range";
}
```

`"up to 120 km"` yields `{ max: 120, qualifier: "up_to" }` — never `{ value: 120, qualifier:
"exact" }`.

### 4.2 `units.ts` — one canonical unit per dimension

| Dimension                   | Canonical | Accepted (draft §6.1, extended)                                             |
| --------------------------- | --------- | --------------------------------------------------------------------------- |
| distance / range / altitude | `km`      | `m, meter(s), метр, метры`, `mi, mile(s)`, `nm, nmi, nautical mile(s)`      |
| speed                       | `km/h`    | `m/s, м/с`, `mph`, `knots, knot, kts, уз`                                   |
| mass                        | `kg`      | `g, gram(s), гр`, `oz`, `lb, lbs, pound(s), фунт`                           |
| duration                    | `min`     | `s, sec, second(s), сек`, `min, minute(s), мин`, `h, hr, hrs, hour(s), час` |

```ts
export const CANONICAL_UNIT = {
  distance: "km",
  speed: "km/h",
  mass: "kg",
  duration: "min",
} as const;

/** Pure conversion table. Adding a unit is data, never a code path. */
export function convert(value: number, from: string, to: string): number | undefined;
export function canonicalUnitFor(rawUnit: string): string | undefined;
export function normalizeQuantity(raw: string): NormalizedQuantity | undefined;
```

```ts
export interface NormalizedQuantity {
  raw: string; // "80 miles" — always kept
  value?: number; // 80 in the raw unit
  unit?: string; // "mi" as written
  // canonical representation
  canonicalValue?: number;
  canonicalUnit?: string; // "km"
  range?: QuantityRange; // present when the raw text was a range / qualified
  confidence: number; // deterministic: 1.0 for an exact single parse, <1 for inferred ones
}
```

Confidence is deterministic, not a model score: `1.0` when unit and value are explicit, `0.9` when
the unit is inferred from the dimension, `0.6` when the value came from a magnitude suffix
(`"$25k"`), `0.4` when only a range midpoint is available.

### 4.3 `rf.ts` — frequencies, bands, roles, fiber

```ts
/** "720 MHz" → [720,720]; "720–750 MHz" → [720,750]; "0.915 GHz" → [915,915]; "720MHz" → [720,720]. */
export function parseFrequencies(raw: string): Array<[number, number]>;

/** All IEEE bands the range intersects — never just the midpoint. */
export function ieeeBandsFor(mhz: [number, number]): string[];
export function natoBandsFor(mhz: [number, number]): string[];

export function detectProtocols(raw: string): string[]; // ExpressLRS, ELRS, Crossfire, OcuSync, CRPA…
export function isFiberOptic(raw: string): boolean; // fiber optic, FOCL, optical tether, wire guided…
export function inferRole(raw: string): { role: RFRole; confidence: number };

export function normalizeRF(raw: string): NormalizedRFLink;
```

Two rules the draft got exactly right and that are preserved as hard invariants with tests:

- **Protocols never imply a frequency.** `"ExpressLRS"` alone produces `protocols: ["expresslrs"]`
  and `freqMHz: undefined`. No 915 MHz is invented.
- **Fiber produces no frequency.** `"fiber-optic controlled"` produces `isFiberOptic: true`,
  `role: "tether"`, `freqMHz: undefined`.

Role inference is keyword-driven and returns its confidence: `"control link"` → `uplink` at 0.9,
`"analog video"` → `video` at 0.95, `"GPS L1"` → `gnss` at 0.95, `"CRPA"` alone → `antijam` at 0.7,
nothing matched → `unknown` at 0.3.

### 4.4 `bands.ts` — the authoritative tables

Two exported tables, each entry `{ id, label, minMHz, maxMHz }`, each with a pinned standard in a
doc comment:

- `IEEE_BANDS` — VHF 30–300, UHF 300–1000, L 1–2 GHz, S 2–4, C 4–8, X 8–12, Ku 12–18, K/Ka 18–40.
- `NATO_BANDS` — A 0–250, B 250–500, C 500–1000, D 1–2k, E 2–3k, F 3–4k, G 4–6k, H 6–8k, I 8–10k,
  J 10–20k, K 20–40k, L 40–60k, M 60–100k (MHz). The doc comment pins **NATO STANAG / MIL-STD-2401**
  and explicitly warns that the older "G 4–6, H 6–8, I 8–10" variant exists, so mixing is a bug.

**Name-collision warning carried into the UI:** NATO `C` is 500–1000 MHz while IEEE `C` is 4–8 GHz;
NATO `K` is 20–40 GHz while IEEE `K/Ka` is 18–40 GHz. Facets must render `IEEE C` / `NATO C`, never
a bare `C`. The draft's facet sketch lists bare letters — that is a real misreading risk in an OSINT
tool and is corrected here.

Band lookup is inclusive-lower / exclusive-upper except for the final band, so a boundary frequency
lands in exactly one band and `natoBandsFor([600, 600])` returns `["C"]` without duplication.

### 4.5 `currency.ts` — parse, don't convert (by default)

```ts
export interface Money {
  amount: number; // 25000, from "25k" / "2.5M" / "25 000"
  currency: string; // ISO 4217, from the symbol
  raw: string;
  /** Only present when a rate snapshot was supplied by the caller. */
  usd?: { value: number; rate: number; rateAsOf: string; rateSource: string };
}

export function parseMoney(raw: string): Money | undefined; // "$25k", "€25k", "₽500000", "£10000"
export function toUSD(m: Money, rate: number, asOf: string, source: string): Money;
```

**Change from the draft:** no live FX call. There is no FX provider in this codebase, and adding
one would (a) make a "deterministic" function non-deterministic, (b) put a third-party network
dependency in the browser path, and (c) break the rule that only AI calls leave the browser via the
proxy. Instead:

- `parseMoney` is deterministic and always available.
- `toUSD` is explicit, arguments-in, and stores `rate` + `rateAsOf` + `rateSource` — so the
  conversion is auditable and reproducible.
- If no rate has been supplied, `usd` is **absent**, and the UI shows the original currency. A
  missing rate is rendered as "no rate snapshot", never as a fabricated number.

Currency inference covers the symbols the platform actually needs (`$ € £ ₽ ₴ ₺ ¥`) plus ISO codes,
with `$` mapped to USD only when no adjacent country hint says CAD/AUD (a documented, conservative
rule).

---

## 5. Living taxonomy — seeded registry + one DB-backed collection

### 5.1 Shape

```ts
// src/entities/normalization/types.ts
export interface TaxonomyTerm {
  /** "propulsion", "airframe", "protocol", "payload", "ew" */
  taxonomy: string;
  /** stable slug: "piston", "fixed-wing", "expresslrs" */
  canonicalId: string;
  label: string; // "Piston"
  parentId?: string; // hierarchy: piston → piston.2-stroke
  aliases: string[]; // ["turbo jet", "jet engine", …]
  status: "active" | "rejected" | "candidate";
  /** Seeded terms are the shipped defaults; store edits produce `origin: "db"`. */
  origin: "seed" | "db";
  /** provenance for a db-sourced edit */
  updatedAt?: string;
  updatedBy?: string;
}

export interface TaxonomyCandidate {
  id: string;
  taxonomy: string;
  rawTerm: string;
  status: "candidate" | "mapped" | "promoted" | "rejected";
  /** Set when an analyst mapped it to an existing canonical term. */
  resolvedCanonicalId?: string;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  /** Where it was seen — the audit trail the draft asked for. */
  sources: Array<{ sourceId?: string; source: string; droneId?: string; seenAt: string }>;
}
```

### 5.2 Seeded taxonomies (code, immutable at runtime)

`propulsion.ts` and `airframe.ts` export `PROPULSION_TERMS` and `AIRFRAME_TERMS` as plain arrays.
They cover the draft's lists and add the hierarchy the draft sketched:

```
electric      → electric.bldc, electric.brushed
piston        → piston.2-stroke, piston.4-stroke, piston.rotary, piston.turbojet-class
turbojet / turbofan / turboprop
rocket        → rocket.rocket-assist
hybrid / hybrid-vtol / unpowered-glide / unknown
```

```
multirotor    → multirotor.quadrotor, .hexacopter, .octocopter
fixed-wing    → fixed-wing.flying-wing, .delta-wing, .pusher, .tractor
vtol          → vtol.tiltrotor, vtol.hybrid-vtol, vtol.ducted-fan
helicopter    → helicopter.single-rotor
unknown
```

Configuration details (`ducted-fan`, `pusher`, `tractor`, `tiltrotor`) are **separate terms**, not
pushed into the primary type, exactly as the draft insists: `fixed-wing + electric` is two facets,
not one category.

### 5.3 Resolution order and the ambiguity rule

```ts
export function resolveTerm(
  raw: string,
  taxonomy: string,
  reg: TaxonomyRegistry,
): {
  canonicalId?: string;
  candidate?: TaxonomyCandidate;
  confidence: number;
};
```

1. Exact alias match (case- and separator-insensitive: `ELRS` / `Express LRS` / `ExpressLRS` all
   normalize to `expresslrs`).
2. Word-boundary containment, only when the alias is ≥4 chars and the match is unambiguous — one
   canonical term wins.
3. **Two or more canonical terms match → no resolution, confidence 0.5.** This is the ambiguity
   case the draft leaves undefined; silently picking one is the failure mode this whole document
   exists to prevent.
4. No match → a candidate, never an automatic mapping.

`TaxonomyRegistry` (in `shared/contracts/taxonomy.ts`) is the I/O seam:

```ts
export interface TaxonomyRegistry {
  terms(taxonomy?: string): TaxonomyTerm[];
  upsertTerm(t: TaxonomyTerm): void;
  candidates(): TaxonomyCandidate[];
  recordCandidate(rawTerm: string, taxonomy: string, source: SourceRef): TaxonomyCandidate;
  resolveCandidate(id: string, to: "mapped" | "promoted" | "rejected", target?: string): void;
}
```

`LocalTaxonomyRepository` in `shared/infra/local-repository.ts` follows the existing
`CachedRepository` pattern, and `services.tsx` attaches it in the same `Promise.all` as the other
five. Seeded terms are provided at construction so the registry works offline with no store.

### 5.4 Registering the new collections — the complete checklist

Adding `taxonomies` and `taxonomy_candidates` is mechanical but easy to half-do. All of these are
required, and each is a one-or-two-line change:

| #   | File                                                 | Change                                                                                                             |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | `src/shared/contracts/store.ts`                      | add to `Collection`, `CollectionMap`, `Snapshot`                                                                   |
| 2   | `src/shared/infra/local-store.ts`                    | add `dti.taxonomies.v1` / `dti.taxonomy_candidates.v1` to `KEYS`                                                   |
| 3   | `src/shared/infra/postgres/postgres-store.server.ts` | `ORDER` entries + an explicit `else if` branch in `upsert` (**otherwise it falls into the sources column layout**) |
| 4   | `src/shared/infra/cloud/cloud-store.server.ts`       | `ORDER` entry + an explicit `case` in `row()` (**same trap**)                                                      |
| 5   | `src/shared/infra/store.functions.ts`                | add both to the `COLLECTIONS` allow-list                                                                           |
| 6   | `migrations/005_normalization.sql`                   | new migration, §7                                                                                                  |
| 7   | `src/shared/infra/local-repository.ts`               | `LocalTaxonomyRepository` + `LocalTaxonomyCandidateRepository`                                                     |
| 8   | `src/shared/infra/services.tsx`                      | construct, attach, expose                                                                                          |

`taxonomies` is small enough (tens of documents) that it is seeded from code on first attach and
therefore needs no special load ordering. `taxonomy_candidates` is append-mostly and grows with
ingestion, so it gets `ORDER: { col: "last_seen", asc: false }` to match how `candidates` and
`dispatches` are ordered — newest first, capped by the caller rather than the store.

### 5.5 Migration (`migrations/005_normalization.sql`)

Note the file numbering: `004_dispatch_lease.sql` and `004_procurements.sql` already share the
prefix and are applied in that order by `docker-entrypoint-initdb.d`, so the next free number is
**005**.

```sql
-- Canonical taxonomy terms + aliases, and the emergent-term queue.
-- Same layout convention as every collection: JSONB document, hot columns mirrored.

create table if not exists taxonomies (
  id           text primary key,          -- "<taxonomy>/<canonicalId>"
  taxonomy     text not null,
  canonical_id text not null,
  label        text not null,
  parent_id    text,
  data         jsonb not null,
  updated_at   timestamptz not null default now()
);
create index if not exists taxonomies_taxonomy_idx on taxonomies (taxonomy, canonical_id);
create index if not exists taxonomies_data_gin on taxonomies using gin (data jsonb_path_ops);

create table if not exists taxonomy_candidates (
  id         text primary key,
  taxonomy   text not null,
  raw_term   text not null,
  status     text not null default 'candidate',
  occurrences integer not null default 1,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  data       jsonb not null
);
create index if not exists taxonomy_candidates_status_idx
  on taxonomy_candidates (status, last_seen desc);
create index if not exists taxonomy_candidates_taxonomy_idx
  on taxonomy_candidates (taxonomy, raw_term);
```

Lovable Cloud gets the same tables (the CloudStore writes `data` plus mirrored columns); its
`claim`/`release` RPCs remain dispatches-only, which is correct — taxonomies are not a work queue.

---

## 6. Pipeline integration

### 6.1 The seam

```
RawDispatch ──collectSource()──▶ pending
                                   │  processPending()   (lease-guarded, features/sources/auto-ingest.ts)
                                   ▼
IntelExtractor.extract()          →  Extraction {rfBands[], specs[], confidence, …}
                                   │
                                   ▼  ★ NEW, pure, synchronous, never throws ★
                        normalizeExtraction(extraction, registry)
                                   │
                                   ▼
                    runTwoTier branches (auto-merge / auto-promote / queue)
                                   │  mergeSpecs()  → SpecAttribute{claims[]}
                                   ▼
                        consensus()  → catalog facets → dossier + counterparts UI
```

`normalizeExtraction` is called once inside `runTwoTier`, immediately after the tier resolution and
before any branch, so all four outcomes (`auto-merged`, `auto-promoted`, `queued`,
`auto-discarded`) carry the same normalized payload. It is also exported and callable from the
intake UI's ad-hoc paste path, which goes through the same `runTwoTier`.

```ts
// src/entities/normalization/apply.ts
export function normalizeExtraction(e: Extraction, reg?: TaxonomyRegistry): Extraction;
```

`reg` is optional. Without a registry, only the seeded taxonomies are used and unknown terms are
returned as candidates in memory but not persisted — the browser-without-store case still works.

### 6.2 Idempotence

`normalizeExtraction` writes only to fields that are absent or derived from `raw`. Calling it twice
on the same extraction produces deep-equal output. This matters because `runTwoTier` may be re-run
after a candidate is retried (`MAX_ATTEMPTS`), and because a re-run must not double-count taxonomy
candidate occurrences.

### 6.3 Failure containment

`normalizeExtraction` is wrapped in the apply path with a per-item guard:

```ts
let normalized: Extraction;
try {
  normalized = normalizeExtraction(extraction, taxonomy);
} catch (err) {
  // A parser bug must not burn a dispatch attempt or fail a batch.
  console.error("[normalize]", err);
  normalized = extraction;
}
```

This is the direct answer to the draft's "unknown values must never cause ingestion to fail" and to
this repo's reality: a throw inside `processPending` sets `status: "pending"` and increments
`attempts`, and three of them mark the dispatch `failed` permanently.

### 6.4 `mergeSpecs` and `promote` upgrades

`src/features/dynamic-specs/spec-engine.ts`:

```ts
export function mergeSpecs(
  drone: Drone,
  specs: ExtractedSpec[],
  source: string,
  ref?: SourceRef,
): Drone {
  // match on `normalized?.semantic ?? key`; preserve first-seen key/label;
  // claims now carry {raw, normalized, normalizationConfidence, sourceId, evidence, extractionConfidence}
}
```

`src/features/intake/pipeline.ts` `promote()` — two real fixes:

```ts
// BEFORE
rf: e.rfBands.map((b) => ({ role: "uplink" as const, band: b })),

// AFTER
rf: (e.rf ?? e.rfBands.map((b) => normalizeRF(b))).map((r) => toRFLink(r)),
```

Every promoted system currently claims its GNSS, CRPA and video links are `uplink`. With
`normalizeRF` in the path, `"CRPA"` becomes `role: "antijam"`, `"5.8 GHz analog video"` becomes
`role: "video"`, and `"720-750 MHz control link"` becomes `role: "uplink"` — which is what the
dossier panel and the counterparts overlap logic both want to read.

The same `rf` derivation is applied in the auto-merge path so a merged drone's links gain
`ieeeBands`/`natoBands`/`protocols` instead of only a raw `band` string.

`mergeDrones` keeps its existing `role` + `band` dedupe, and gains a second pass that merges two
links sharing the same `role` + `freqMHz` (which is the same physical link written as `"868 MHz"`
by one source and `"0.868 GHz"` by another). This is the draft's "three conflicting strings become
one canonical value", applied to RF.

### 6.5 Read-time tolerance in `consensus()`

`consensus()` is extended, not replaced:

```ts
// src/entities/drone/consensus.ts
export function consensus(spec: SpecAttribute): Consensus;
```

- If any claim has `normalized.canonicalValue`, those are the values aggregated (already in
  `canonicalUnit`). Mixed-unit claims (`80 miles` + `130 km`) now land on `128.75` and `130` km
  instead of being compared as 80 vs 130. **This is the draft's headline example, and it works with
  zero backfill.**
- Claims without `normalized` keep today's behaviour — so all seed data and every existing
  assertion in `src/test/consensus.test.ts` still pass unchanged.
- `Consensus` gains `spreadPct` and `outliers: number[]` (indices), which the dossier's "Spread"
  column can show without the page doing arithmetic.
- String-valued claims keep the existing modal-string path. `"$15,000 - $20,000"` is _not_ forced
  into a number; it is displayed as reported, with the parsed `Money` available separately.

Confidence bands stay `high | medium | low` because `ConfidenceTag` in
`shared/ui/primitives.tsx` and both `dossier-page.tsx` and `counterparts-page.tsx` already consume
that union.

---

## 7. Facets, RF overlap and drift

### 7.1 Catalog facets

`CatalogFacets` in `src/shared/contracts/repository.ts` gains optional, additively-filtered fields:

```ts
export interface CatalogFacets {
  domains?: Domain[];
  origin?: string[];
  operators?: string[];
  /** Legacy, raw band strings — kept for backwards compatibility. */
  bands?: string[];
  /** NEW */
  ieeeBands?: string[];
  natoBands?: string[];
  propulsionIds?: string[];
  airframeIds?: string[];
  protocols?: string[];
  fiberOnly?: boolean;
}
```

`LocalDroneRepository.search` filters these off normalized values, so `750 MHz`, `UHF`,
`700–800 MHz` and `0.75 GHz` are all reachable from one facet click. The existing `bands` filter is
left in place so bookmarked/encoded URLs keep working.

The draft's rule "filtering must operate on normalized values, not raw strings" is enforced by a
test: seed a drone with `band: "L"` and `freqMHz: [868, 915]`, assert that the UHF facet finds it
and the "L" facet does not.

### 7.2 Counterparts / EW overlap

`counterparts-page.tsx` already has an `overlap()` helper that compares `band` string equality or
`freqMHz` interval intersection. It is upgraded to use the shared pure helpers from `rf.ts`:

```ts
/** Intersection in MHz, or undefined when the bands do not overlap. */
export function intersectBands(
  a: [number, number],
  b: [number, number],
): [number, number] | undefined;
```

and the panel relabels the result **"Potential frequency overlap"** with the intersection shown
explicitly (`720–750 MHz`), plus a source count per side. The draft's safety rule (§12.1) is
adopted verbatim as a UI string requirement: the page never says a system "can be jammed".

The existing fiber check (`d.rf.some((r) => r.band.startsWith("Fiber"))`) is replaced by
`r.role === "tether" || r.isFiberOptic`, which is what makes it survive normalization: no seeded
drone currently has a band starting with "Fiber", so that branch is dead code today.

### 7.3 Spec drift

`evolution[]` already exists on `Drone` with `kind: "frequency" | "motor" | "payload" | "airframe" |
"other"`. Drift detection is a pure function over the _claim dates_ rather than new storage:

```ts
// src/entities/normalization/drift.ts
export interface DriftPoint {
  date: string;
  canonicalValue: number;
  canonicalUnit: string;
  source: string;
}
export function detectDrift(spec: SpecAttribute): {
  changed: boolean;
  points: DriftPoint[];
  spreadPct: number;
};
```

The dossier timeline renders `Observed change`, not `Confirmed hardware change`, and each point
links back to its claim (source string + evidence + date). Since claims already carry `date`, this
is a read-path feature with **no migration**.

---

## 8. UI surfaces

| Route             | File                                                          | What it does                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/taxonomy` (new) | `routes/taxonomy.tsx` → `features/taxonomy/taxonomy-page.tsx` | Candidate queue: unknown term, occurrences, where seen, "map to existing" / "promote to canonical" / "reject". Alias editor for existing terms               |
| `/catalog`        | extend `features/catalog/catalog-page.tsx`                    | Add IEEE / NATO / protocol / propulsion-canonical / fiber facets. Bare band letters are always prefixed                                                      |
| `/intake`         | extend `features/intake/intake-page.tsx`                      | Show the normalized value next to the raw one on each candidate spec tag (`Range: 1000 km` + `≈621 mi`) so the analyst sees the conversion, not just the raw |
| `/systems/$id`    | extend `features/dossier/dossier-page.tsx`                    | RF panel shows `role · canonical MHz · IEEE/NATO · protocols`; spec table shows canonical consensus with a "reported" tooltip listing the raw strings        |
| `/counterparts`   | extend `counterparts-page.tsx`                                | §7.2                                                                                                                                                         |
| `/` (briefing)    | `features/briefing/briefing-page.tsx`                         | Optional: a "new taxonomy terms this week" card driven by `taxonomy_candidates`                                                                              |

Nav entry in `shared/ui/app-shell.tsx` `NAV` array. Adding a route under `src/routes/` requires the
TanStack route tree to regenerate (`routeTree.gen.ts` is generated by the router plugin on
dev/build), so the doc notes: _run `npm run dev` once after adding the route file, then commit the
regenerated tree_.

All new UI consumes normalized values. The only new "logic" in JSX is formatting, and the rule from
the draft stands: no parsing components.

---

## 9. Testing plan

All suites are plain vitest in `src/test/`, matching `consensus.test.ts` style (`describe`/`it`,
`@/` alias, no new harness). `npm run test` runs everything; nothing here needs a database
except `taxonomy-store.test.ts`, which uses `LocalStorageStore` + `LocalTaxonomyRepository` in
jsdom.

**`normalization-numeric.test.ts`** — `1,5`/`1 500`/`2.5`/`25k`/`2.5M`; grouped vs decimal comma;
malformed input (`""`, `"km"`, `"—"`) returns `undefined` and never throws.

**`normalization-units.test.ts`** — every draft case (`80 miles` → 128.748, `70 nm`, `1000 m`,
`100 mph`, `90 knots`, `30 m/s`, `2 hours` → 120 min, `5400 seconds` → 90 min) plus Cyrillic units
(`км`, `км/ч`, `кг`) and range confusables (`80 km` vs `80–120 km` vs `up to 120 km`).

**`normalization-currency.test.ts`** — `$25,000`, `€25k`, `$2.5M`, `£10000`, `₽500000`; currency is
never defaulted away; `toUSD` without a rate leaves `usd` absent; a rate is stored with `rateAsOf`
and `rateSource`.

**`normalization-rf.test.ts`** — all draft cases (`720 MHz`, `720-750 MHz`, `720–750 MHz`,
`0.915 GHz`, `5.8 GHz`, `720MHz`, `950–1100 MHz` → `["UHF","L"]`); boundary frequencies land in
exactly one band; `"ExpressLRS"` alone yields no frequency; `"fiber-optic control"` yields
`isFiberOptic` and no frequency; role inference confidences.

**`normalization-taxonomy.test.ts`** — alias resolution (`ELRS`/`Express LRS`); two-way ambiguity
returns no match; unknown term produces a candidate and never a canonical mapping; candidate
occurrence counting is idempotent under re-runs.

**`normalization-apply.test.ts`** — `normalizeExtraction` is idempotent; a throwing parser input
degrades to the unnormalized extraction (simulated by an injected bad registry); the seed
inconsistency (`band: "L"`, `freqMHz: [868,915]`) recomputes to IEEE UHF / NATO B.

**`consensus-normalized.test.ts`** — the draft's headline case: `80 miles` + `130 km` + `125 km`
aggregate as `128.75 / 130 / 125` km, median ≈ 129, `sources === 3`; and the negative case —
`range.max` and `range.operational` are **not** merged even though both are km. This suite also
re-asserts every existing `consensus.test.ts` expectation, so the extension is provably
non-regressive.

**`taxonomy-store.test.ts`** — seed-on-first-attach; a db override of a seeded alias wins; the
seeded terms survive a store that returns `null`.

Integration tests to extend rather than add: `pipeline-relations.test.ts` and
`merge-drones.test.ts` already build `Extraction` fixtures with `rfBands: []` — those keep compiling
because every new field is optional, and both gain one case asserting normalized `rf` survives a
merge.

---

## 10. Delivery phases

Each phase is independently mergeable and leaves the app running. No phase depends on a later one.

### Phase 1 — Deterministic core (no schema change, no UI change)

`numeric.ts`, `units.ts`, `currency.ts`, `bands.ts`, `rf.ts` + four test suites.
Refactor `heuristic-ai.ts`'s `num()` to call `numeric.parseNumber`.
**Done when:** the three test suites pass and `npm run test` is green, including all pre-existing
tests; `lint` and `build` pass.

### Phase 2 — Taxonomy model & store

`entities/normalization/{propulsion,airframe,taxonomy,semantic}.ts`,
`shared/contracts/taxonomy.ts`, the 8-point collection checklist, `migrations/005_normalization.sql`,
`LocalTaxonomyRepository`. Wire into `services.tsx`.
**Done when:** the new collections load and round-trip through `LocalStorageStore`,
`PostgresStore` (docker-compose) and `CloudStore`; `taxonomy-store.test.ts` passes.

### Phase 3 — Apply to extraction (type widening)

Widen `RFRole`, extend `RFLink`/`SpecClaim`/`SpecAttribute`, add `Extraction.rf`, add `apply.ts`,
call it in `runTwoTier` with the failure guard. Keep `rfBands` as raw.
**Done when:** `heuristic-ai.test.ts` and both relation tests still pass; a pasted dispatch now
yields `role: "video"` / `"antijam"` instead of `"uplink"` in the queue UI.

### Phase 4 — Persist normalized claims

Upgrade `mergeSpecs` (semantic grouping + claim fields), `promote()`'s RF derivation, `mergeDrones`
RF link merge.
**Done when:** `merge-drones.test.ts` gains the normalized-RF case and passes; a merged drone's
specs carry `canonicalValue` and `sourceId`.

### Phase 5 — Consensus & dossier

Extend `consensus()` with read-time normalization; dossier panel renders canonical + reported.
**Done when:** `consensus-normalized.test.ts` passes and **every existing consensus assertion still
passes unchanged**; no backfill needed for the seed data to show `129 km`.

### Phase 6 — Facets & SEO route

`CatalogFacets` + `search` filters; catalog page facets; `/taxonomy` route and page.
**Done when:** the "stored `band` lies" test passes; an analyst can resolve a candidate end-to-end.

### Phase 7 — EW overlap & drift

`intersectBands`, counterparts panel relabel, `drift.ts` + dossier timeline.
**Done when:** the overlap panel shows "Potential frequency overlap" with an explicit
intersection and never asserts jamming capability.

---

## 11. Definition of done

- [ ] `npm run test`, `npm run lint` and `npm run build` all pass, including every pre-existing test.
- [ ] `80 miles`, `130 km` and `125 km` aggregate to a single consensus with spread reported.
- [ ] All frequencies resolve to MHz internally; IEEE and NATO bands are queryable; a range
      crossing two bands returns both.
- [ ] Stored `band` labels are never trusted: bands are recomputed from `freqMHz` and the raw
      label is preserved as evidence.
- [ ] `role`, not `"uplink"`, is set for every promoted/merged RF link.
- [ ] Propulsion, airframe, protocol and payload taxonomies extend by editing data — adding an
      alias needs no deploy.
- [ ] Unknown terms become candidates with occurrences, timestamps and source references; none is
      silently mapped or promoted.
- [ ] Every normalized claim keeps `raw`, `normalized`, `confidence`, `source`, `sourceId`,
      `evidence`, `date`.
- [ ] Currency keeps the original currency; `usd` exists only with a stored rate, rate date and
      rate source.
- [ ] Consensus never merges different semantic keys (`range.max` vs `range.operational`).
- [ ] Unknown or malformed input degrades to the raw value and never fails ingestion.
- [ ] Existing ingestion, auto-merge, auto-promote and the lease logic behave as before.
- [ ] `docker-compose up` applies `migrations/005_normalization.sql` on a fresh database.
- [ ] The UI shows "Potential frequency overlap" and "Observed change", never confirmed jamming or
      confirmed hardware change.

---

## 12. Hard rules carried forward from the draft

1. Never destroy raw extracted text.
2. Never silently invent a specification — a protocol keyword never implies a frequency, and a
   fiber link never gets one.
3. Never convert an uncertain inference into a confirmed fact.
4. Never merge semantically different specifications merely because they share a unit.
5. Never create a canonical taxonomy entry automatically without a candidate first.
6. Never put parsing or normalization in a UI component.
7. Every normalized claim retains provenance.
8. Deterministic conversions are unit-tested.
9. Currency conversion retains the original currency, the rate and the conversion date.
10. Frequency ranges map to every band they intersect.
11. RF overlap is potential overlap, never proof of interference.
12. Consensus is reproducible from the underlying claims.
13. Specification changes preserve historical values.
14. Unknown terms degrade gracefully rather than breaking ingestion.
15. AI extraction and deterministic normalization remain separate responsibilities.
16. **Never trust a stored band label over the frequencies it is supposed to describe.**
17. **Never let a normalization bug consume a dispatch's retry budget.**

The architecture continues to favour **traceability, reversibility and evidence preservation**
over aggressive automatic inference — every displayed fact still has to answer _where it came
from, what the source actually said, how it was normalized, and how sure we are_.
