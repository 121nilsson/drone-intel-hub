# Drone OSINT Normalization Engine

## Objective

Build a robust normalization and taxonomy layer for the drone OSINT platform.

The purpose is to transform inconsistent, free-form information extracted from news articles, Telegram posts, technical documents, procurement records, manufacturer specifications, and other OSINT sources into structured, searchable and comparable data.

Examples of raw extracted text:

```text
"720–750 MHz"
"2-stroke 50hp piston"
"80 miles"
"130 km range"
"5.8 GHz analog video"
"915 MHz ExpressLRS"
"Kometa-M 8-element CRPA"
"fiber-optic controlled"
"$25k per unit"
```

The system must preserve the original extracted information while adding normalized representations.

The normalization layer must be deterministic wherever possible and extensible where the underlying domain is evolving.

---

# 1. Core Principles

## 1.1 Preserve Raw Data

**Never replace or destroy the original extracted value.**

Every normalized value must retain:

- original/raw value
- normalized value
- normalized unit/category
- source
- extraction timestamp
- confidence
- optional evidence text

Example:

```json
{
  "raw": "80 miles",
  "value": 80,
  "unit": "mi",
  "normalizedValue": 128.748,
  "normalizedUnit": "km",
  "sourceId": "article-123",
  "confidence": 0.96
}
```

The UI may display `129 km`, but the database must retain `80 miles`.

---

## 1.2 Deterministic Standards vs. Living Taxonomies

Not every part of the domain should behave the same way.

### Deterministic Domain Logic

These are mathematical or standards-based and should be implemented as immutable application logic:

- Unit conversions
- Frequency parsing
- Frequency ranges
- IEEE frequency-band mapping
- NATO frequency-band mapping
- Currency arithmetic
- Numeric normalization

These functions should be deterministic and fully covered by unit tests.

Example:

```text
80 miles
→ 128.748 km
```

The same input must always produce the same result.

---

### Living / Extensible Taxonomies

Some categories evolve continuously as new drone technologies appear.

Examples:

- propulsion
- airframe configuration
- control systems
- payload mechanisms
- communication technologies
- emerging hardware

These should use a seeded canonical taxonomy combined with a database-backed alias registry.

The system must be able to encounter a previously unknown term without:

- breaking TypeScript types
- requiring a code deployment
- modifying source code
- losing the original term

Unknown terms should initially become **candidate taxonomy entries**, not automatically become official categories.

---

# 2. Architecture

Follow the existing Feature-Sliced Design architecture.

Recommended structure:

```text
src/
├── entities/
│   ├── normalization/
│   │   ├── rf.ts
│   │   ├── units.ts
│   │   ├── propulsion.ts
│   │   ├── airframe.ts
│   │   ├── taxonomy.ts
│   │   └── index.ts
│   │
│   └── drone/
│       ├── model.ts
│       ├── types.ts
│       └── ...
│
├── features/
│   ├── extraction/
│   ├── consensus/
│   └── ...
│
└── pages/
```

Pure normalization logic belongs under:

```text
src/entities/normalization/
```

UI components must not contain parsing or normalization logic.

UI components consume already-normalized entities, facets and tags.

---

# 3. Dynamic Taxonomy Storage

Dynamic taxonomies and aliases must be persisted in Lovable Cloud.

Recommended conceptual structure:

```text
taxonomies
taxonomy_aliases
taxonomy_candidates
```

Example:

```json
{
  "taxonomy": "propulsion",
  "canonicalId": "turbojet",
  "label": "Turbojet",
  "aliases": ["turbo jet", "jet engine", "micro turbojet"],
  "status": "active"
}
```

An analyst should be able to:

1. See an unknown term.
2. See where it was encountered.
3. Map it to an existing canonical category.
4. Create a new canonical category if appropriate.
5. Add aliases.
6. Mark a term as irrelevant or misleading.

Changes must persist across devices and future ingestion runs.

---

# 4. Normalization Pipeline

The normalization pipeline should operate approximately as follows:

```text
Raw Extracted Text
        │
        ▼
┌─────────────────────────────────────┐
│       NORMALIZATION ENGINE           │
│                                     │
│  1. RF Spectrum Normalizer          │
│  2. Units & Numeric Normalizer      │
│  3. Propulsion Normalizer            │
│  4. Airframe Normalizer              │
│  5. Taxonomy / Alias Resolution      │
└──────────────────┬──────────────────┘
                   │
                   ▼
        Structured Claims
                   │
                   ▼
        Consensus / Evidence
                   │
                   ▼
      Drone Dossier / Catalog
```

Normalization should happen as early as practical after extraction.

---

# 5. RF Spectrum Normalizer

File:

```text
src/entities/normalization/rf.ts
```

## Purpose

Convert free-form RF and communication descriptions into structured, queryable data.

Examples:

```text
"720-750 MHz"
"720–750MHz"
"915 MHz ExpressLRS"
"5.8 GHz analog video"
"GPS L1"
"GLONASS L1"
"Ku-band satellite link"
"Kometa-M 8-element CRPA"
"fiber optic control"
```

---

## 5.1 Frequency Parsing

Support:

- kHz
- MHz
- GHz
- ranges
- single frequencies
- decimal values
- comma/period decimal formats where unambiguous
- en-dash and hyphen ranges

Examples:

```text
720 MHz
→ [720, 720]

720-750 MHz
→ [720, 750]

0.915 GHz
→ [915, 915]

5.8 GHz
→ [5800, 5800]
```

All normalized RF frequencies should internally use:

```text
MHz
```

---

# 5.2 IEEE Band Mapping

Use deterministic frequency boundaries.

Initial taxonomy:

```text
VHF   30–300 MHz
UHF   300–1000 MHz
L     1–2 GHz
S     2–4 GHz
C     4–8 GHz
X     8–12 GHz
Ku    12–18 GHz
K/Ka  18–40 GHz
```

Important:

A range may cross multiple bands.

Example:

```text
950–1100 MHz
```

should produce:

```json
["UHF", "L"]
```

Do not assign only the midpoint band.

The mapping function should therefore return all bands intersecting the range.

---

# 5.3 NATO Band Mapping

Implement NATO RF band mapping as a deterministic lookup table.

Do not hard-code NATO band assumptions throughout the application.

Create a single authoritative lookup structure:

```ts
interface FrequencyBandDefinition {
  id: string;
  label: string;
  minMHz: number;
  maxMHz: number;
}
```

Example:

```ts
const NATO_BANDS: FrequencyBandDefinition[] = [
  // Band definitions here
];
```

The implementation must use the exact selected standard boundaries.

If different NATO/legacy definitions exist, the standard/version must be explicitly documented rather than silently mixing definitions.

---

# 5.4 Communication Protocol Detection

Recognize known protocol and technology keywords where possible.

Examples:

```text
ExpressLRS
ELRS
Crossfire
TBS
OcuSync
GPS L1
GPS L2
GPS L5
GLONASS
Galileo
Starlink
CRPA
```

Protocol recognition must not automatically imply a frequency.

For example:

```text
"ExpressLRS"
```

does not by itself mean:

```text
915 MHz
```

unless the source explicitly specifies that frequency or band.

---

# 5.5 RF Tactical Role

Attempt to classify the role of the RF information.

Supported roles:

```ts
type RFRole =
  "uplink" | "downlink" | "video" | "gnss" | "antijam" | "telemetry" | "tether" | "unknown";
```

Examples:

```text
"915 MHz control link"
→ uplink

"5.8 GHz analog video"
→ video

"GPS L1"
→ gnss

"Kometa-M CRPA"
→ antijam

"fiber-optic control"
→ tether
```

Role inference must include confidence.

---

# 5.6 Fiber-Optic / Wired Control

Recognize descriptions such as:

```text
fiber optic
fiber-optic
FOCL
optical tether
fiber spool
wire guided
wired control
```

Output:

```ts
isFiberOptic: true;
```

and:

```ts
role: "tether";
```

Do not invent an RF frequency for fiber-optic control.

---

# 5.7 RF Output Model

```ts
export interface NormalizedRFLink {
  raw: string;

  role: "uplink" | "downlink" | "video" | "gnss" | "antijam" | "telemetry" | "tether" | "unknown";

  freqMHz?: [number, number];

  ieeeBands: string[];

  natoBands: string[];

  protocols?: string[];

  tacticalTag?: string;

  isFiberOptic: boolean;

  confidence: number;
}
```

Example:

```json
{
  "raw": "720–750 MHz control link",
  "role": "uplink",
  "freqMHz": [720, 750],
  "ieeeBands": ["UHF"],
  "natoBands": ["..."],
  "protocols": [],
  "tacticalTag": "Sub-GHz C2",
  "isFiberOptic": false,
  "confidence": 0.98
}
```

---

# 6. Units & Numeric Normalizer

File:

```text
src/entities/normalization/units.ts
```

## Problem

Different sources may describe the same value differently:

```text
80 miles
130 km
70 nautical miles
```

The consensus engine must recognize these as numeric measurements rather than unrelated strings.

---

# 6.1 Canonical Units

### Distance / Range

Normalize to:

```text
km
```

Support:

```text
m
meter
meters

mi
mile
miles

nm
nautical mile
nautical miles
```

---

### Speed

Normalize to:

```text
km/h
```

Support:

```text
m/s
mph
knots
knot
kts
```

---

### Mass / Payload

Normalize to:

```text
kg
```

Support:

```text
g
gram
grams

oz
ounce
ounces

lb
lbs
pound
pounds
```

---

### Flight Time / Endurance

Choose one canonical internal representation.

Recommended:

```text
minutes
```

Support:

```text
seconds
sec
s

minutes
min
m

hours
hr
hrs
h
```

---

### Cost

Costs must preserve:

1. raw amount
2. raw currency
3. normalized estimate
4. conversion date/source
5. confidence

Example:

```json
{
  "rawAmount": 25000,
  "rawCurrency": "USD",
  "normalizedAmountUSD": 25000,
  "conversionDate": "2026-10-08"
}
```

For:

```text
€25k
```

parse:

```text
amount = 25000
currency = EUR
```

then calculate an estimated USD value.

Never discard the original currency.

Currency conversion is time-sensitive and must not be treated as immutable domain logic.

---

# 6.2 Numeric Range Support

Support:

```text
80 km
80–120 km
80 to 120 km
~80 km
up to 120 km
more than 100 km
less than 50 km
```

Represent the semantic qualifier.

Example:

```ts
interface NormalizedNumericValue {
  raw: string;

  value?: number;

  min?: number;
  max?: number;

  unit: string;

  qualifier?:
    "exact" | "approximate" | "up_to" | "at_least" | "less_than" | "greater_than" | "range";

  confidence: number;
}
```

Do not turn:

```text
"up to 120 km"
```

into:

```text
120 km exact
```

---

# 7. Consensus Integration

The consensus engine must operate on normalized numeric values.

Example:

```text
Source A:
80 miles

Source B:
130 km

Source C:
125 km
```

Normalized:

```text
128.75 km
130 km
125 km
```

The consensus engine can then calculate:

```text
minimum
maximum
median
mean
spread
source count
```

The UI should be able to display something like:

```text
Range
≈ 129 km

Reported:
125–130 km

3 sources
```

The underlying evidence must remain accessible.

---

# 7.1 Do Not Automatically Merge Different Semantics

The consensus engine must distinguish:

```text
maximum range
operational range
combat radius
cruise range
link range
maximum altitude
recommended altitude
service ceiling
```

These must not be merged simply because they share the same physical unit.

The semantic specification type is as important as the normalized number.

---

# 8. Propulsion & Hardware Taxonomy

File:

```text
src/entities/normalization/propulsion.ts
```

This is an intentionally extensible taxonomy.

---

## 8.1 Canonical Propulsion Categories

Initial categories:

```text
electric
piston
turbojet
turbofan
turboprop
rocket
rocket-assist
hybrid
unpowered-glide
unknown
```

Propulsion should support hierarchy.

Example:

```text
piston
├── 2-stroke
├── 4-stroke
└── rotary

electric
├── BLDC
├── brushed
└── unknown
```

Do not force a subtype when the source does not provide enough evidence.

---

# 8.2 Airframe / Installation Taxonomy

Initial categories:

```text
multirotor
fixed-wing
flying-wing
delta-wing
vtol
tiltrotor
helicopter
single-rotor
hybrid-vtol
unknown
```

Configuration should be separate from propulsion.

For example:

```text
fixed-wing + piston
fixed-wing + electric
VTOL + electric
multirotor + electric
```

Do not encode these as one giant category.

---

# 8.3 Configuration Details

Store additional details independently:

```text
quadrotor
hexacopter
octocopter
pusher
tractor
tiltrotor
ducted-fan
```

Example:

```json
{
  "primaryType": "electric",
  "subType": "BLDC",
  "airframe": "fixed-wing",
  "configuration": ["pusher"]
}
```

---

# 8.4 Unknown / Emergent Technologies

When the AI encounters:

```text
"pulsejet"
"fiber-optic spool"
"thermite payload"
"novel propulsion system"
```

and no canonical category exists:

1. Preserve the raw term.
2. Create an `emergent candidate`.
3. Store source references.
4. Do not silently map it to the closest category.
5. Allow analysts to review it.
6. Allow analysts to map it to an existing category or promote it to a new canonical taxonomy entry.

Example:

```json
{
  "rawTerm": "pulsejet",
  "taxonomy": "propulsion",
  "status": "candidate",
  "occurrences": 4,
  "firstSeen": "2026-09-21",
  "lastSeen": "2026-10-08"
}
```

This creates a feedback loop between OSINT ingestion and taxonomy development.

---

# 9. Alias Resolution

Every taxonomy should support aliases.

Example:

```text
"ELRS"
"Express LRS"
"ExpressLRS"
```

can resolve to:

```text
expresslrs
```

Similarly:

```text
"2 stroke"
"two-stroke"
"2-stroke piston"
```

can resolve to:

```text
piston / 2-stroke
```

However, alias resolution must not destroy the original wording.

Store both:

```text
rawTerm
canonicalTerm
```

---

# 10. Confidence & Evidence

Every AI-derived normalized value must have a confidence score.

Recommended confidence dimensions:

```text
extractionConfidence
normalizationConfidence
sourceReliability
```

Avoid reducing everything to one opaque AI confidence value.

Example:

```json
{
  "extractionConfidence": 0.97,
  "normalizationConfidence": 1.0,
  "sourceReliability": 0.72
}
```

A manufacturer datasheet and an anonymous Telegram post may contain the exact same statement but should not have identical evidentiary weight.

---

# 11. Source Provenance

Every normalized claim must remain traceable to its source.

Minimum metadata:

```ts
interface ClaimProvenance {
  sourceId: string;
  sourceUrl?: string;
  publishedAt?: string;
  extractedAt: string;

  evidenceText?: string;

  extractionConfidence: number;
  normalizationConfidence: number;
}
```

The UI should allow the analyst to navigate:

```text
Drone
  ↓
Specification
  ↓
Consensus
  ↓
Individual claims
  ↓
Original source
```

This is essential for an OSINT application.

---

# 12. Downstream Feature: EW Overlap

The normalized RF data enables comparison between drone systems and EW systems.

Example:

```text
Drone A:
Control link = 720–750 MHz
```

```text
EW System B:
Jamming coverage = 700–800 MHz
```

The system should detect:

```text
OVERLAP = TRUE
```

and calculate the intersection:

```text
720–750 MHz
```

This should be represented as an analytical relationship, not as a claim that the drone can definitely be defeated.

Possible UI:

```text
EW Coverage

Drone control link
720–750 MHz

EW system
700–800 MHz

Frequency overlap
720–750 MHz
```

---

# 12.1 Important RF Safety / Evidence Rule

Frequency overlap alone does not establish operational effectiveness.

Do not automatically infer:

```text
frequency overlap
→ successful jamming
```

The system should instead label this:

```text
potential frequency overlap
```

and allow additional evidence such as:

- demonstrated interference
- documented loss of control
- manufacturer specifications
- test results
- operational reports

to strengthen the assessment.

---

# 13. Catalog Facets

Normalized fields should become searchable catalog facets.

Examples:

```text
IEEE Band
├── VHF
├── UHF
├── L
├── S
├── C
├── X
├── Ku
└── K/Ka
```

```text
NATO Band
├── A
├── B
├── C
...
```

```text
Propulsion
├── Electric
├── Piston
├── Turbojet
├── Turboprop
├── Hybrid
└── ...
```

```text
Airframe
├── Multirotor
├── Fixed-wing
├── Flying-wing
├── VTOL
└── ...
```

Filtering must operate on normalized values, not raw strings.

Thus:

```text
750 MHz
UHF
700–800 MHz
0.75 GHz
```

can all participate in appropriate RF queries.

---

# 14. Specification Drift Detection

The system should detect when reported technical characteristics change over time.

Example:

```text
2025:
Control frequency = 868–915 MHz

2026:
Control frequency = 720–750 MHz
```

The system should flag:

```text
Potential specification drift
```

However, it must not automatically conclude that the hardware changed.

Possible explanations include:

- new variant
- regional version
- different control system
- replacement of radio hardware
- source error
- measurement uncertainty
- incorrect reporting

The UI should therefore show:

```text
Observed change
```

rather than:

```text
Confirmed hardware change
```

unless evidence supports the latter.

---

# 15. Database Model

Recommended conceptual entities:

```text
Drone
DroneVariant
SpecificationClaim
NormalizedValue
RFLink
Taxonomy
TaxonomyAlias
TaxonomyCandidate
Source
SourceDocument
Consensus
```

Relationships:

```text
Drone
 ├── DroneVariant
 │     └── SpecificationClaim
 │             ├── Source
 │             └── NormalizedValue
 │
 ├── RFLink
 │     └── Source
 │
 └── Consensus
```

Do not store only the final consensus value.

The consensus should be reproducible from the underlying claims.

---

# 16. Implementation Phases

## Phase 1: Pure Parsers & Unit Tests

Implement:

```text
src/entities/normalization/rf.ts
src/entities/normalization/units.ts
```

Tasks:

- frequency regex/parser
- GHz → MHz
- MHz → MHz
- kHz → MHz
- range parsing
- IEEE band mapping
- NATO band mapping
- distance conversion
- speed conversion
- mass conversion
- time conversion
- currency parsing

Deliver:

- complete Vitest suite
- edge cases
- malformed inputs
- range handling
- multi-unit expressions
- decimal handling
- qualifiers such as "up to"

---

# Phase 2: Propulsion & Taxonomy

Implement:

```text
propulsion.ts
taxonomy.ts
airframe.ts
```

Tasks:

- canonical propulsion categories
- airframe categories
- subtype extraction
- alias resolution
- unknown-term detection
- taxonomy candidates
- database-backed aliases

Deliver:

```text
Raw extraction
→ normalized taxonomy
→ candidate taxonomy when unknown
```

---

# Phase 3: Extraction Pipeline Integration

Integrate normalization into:

```text
runTwoTier
mergeSpecs
```

and any equivalent ingestion/extraction paths.

Normalization should occur immediately after candidate extraction.

Example:

```text
Source
 ↓
Extraction
 ↓
Candidate Claim
 ↓
Normalization
 ↓
Structured Claim
 ↓
Consensus
```

All normalized values must retain their provenance.

---

# Phase 4: Consensus Engine Upgrade

Update:

```text
consensus.ts
```

Tasks:

- compare canonical numeric values
- calculate min
- calculate max
- calculate median
- calculate mean where appropriate
- calculate spread
- identify outliers
- preserve semantic specification types
- distinguish exact values from ranges
- account for source reliability

Example:

```text
80 miles
130 km
125 km
```

must become:

```text
128.75 km
130 km
125 km
```

rather than three conflicting strings.

---

# Phase 5: Catalog UI

Add filters for:

- IEEE RF bands
- NATO RF bands
- frequency ranges
- propulsion
- airframe
- communication protocol
- fiber-optic control
- payload type
- normalized range
- normalized speed
- normalized payload
- reported price

UI must consume normalized entities and must not implement parsing itself.

---

# Phase 6: Counterparts / EW Analysis

Add RF comparison between systems.

Example:

```text
Drone A
720–750 MHz

EW System B
700–800 MHz

Potential overlap
720–750 MHz
```

Add:

- overlap visualization
- intersecting frequency range
- RF role
- source count
- evidence strength
- uncertainty indicator

Do not infer actual operational effectiveness from frequency overlap alone.

---

# Phase 7: Specification Timeline

Add historical visualization.

Example:

```text
2024 ───── 2025 ───── 2026

Range
     80 km ─────────── 120 km

Control
     915 MHz ───────── 720–750 MHz
```

Each change should be clickable and reveal:

- source
- original wording
- normalized value
- date
- confidence
- source reliability
- whether the change is confirmed or merely reported

---

# 17. Testing Requirements

Every deterministic normalization function must have unit tests.

Test cases must include:

### RF

```text
720 MHz
720-750 MHz
720–750 MHz
0.915 GHz
5.8 GHz
720MHz
720 MHz control
950–1100 MHz
```

### Distance

```text
80 miles
130 km
70 nm
1000 m
```

### Speed

```text
100 mph
90 knots
30 m/s
160 km/h
```

### Mass

```text
500 g
2 kg
10 lbs
16 oz
```

### Time

```text
2 hours
90 minutes
5400 seconds
```

### Currency

```text
$25,000
€25k
$2.5M
£10000
₽500000
```

### Semantic qualifiers

```text
up to 120 km
more than 100 km
less than 50 km
approximately 80 km
80–120 km
```

### Unknown taxonomy

```text
novel propulsion term
unknown airframe configuration
unknown communication technology
```

Unknown values must never cause ingestion to fail.

---

# 18. Important Implementation Rules

The following rules are mandatory:

1. **Never destroy raw extracted text.**
2. **Never silently invent a specification.**
3. **Never convert an uncertain inference into a confirmed fact.**
4. **Never merge semantically different specifications merely because they share a unit.**
5. **Never create a new canonical taxonomy category automatically without recording it as a candidate first.**
6. **Never make UI components responsible for parsing or normalization.**
7. **Every normalized claim must retain provenance.**
8. **Deterministic conversions must be unit tested.**
9. **Currency conversion must retain the original currency and conversion date.**
10. **Frequency ranges must be capable of mapping to multiple overlapping bands.**
11. **RF overlap must be represented as potential overlap, not proof of successful interference.**
12. **Consensus must be reproducible from the underlying claims.**
13. **Specification changes must preserve historical values.**
14. **Unknown terms must degrade gracefully rather than breaking ingestion.**
15. **AI extraction and deterministic normalization must remain separate responsibilities.**

---

# 19. Definition of Done

The implementation is considered complete when:

- Raw OSINT text can be converted into structured claims.
- RF frequencies are normalized into MHz.
- IEEE and NATO bands can be queried.
- Frequency ranges crossing multiple bands are handled correctly.
- Distances, speeds, masses and durations are normalized.
- Currency values preserve original currency and normalized USD estimates.
- Propulsion and airframe taxonomies are extensible without code changes.
- Unknown taxonomy terms are captured as candidates.
- All normalized values retain source provenance.
- Consensus operates on canonical numeric values.
- Historical specification changes can be displayed.
- Catalog filtering uses normalized facets.
- RF overlap between systems can be calculated.
- The UI distinguishes confirmed facts from reported or uncertain information.
- Comprehensive Vitest coverage exists for deterministic normalization logic.
- Existing ingestion functionality continues to work without regression.

The architecture should favor **traceability, reversibility and evidence preservation** over aggressive automatic inference.

The goal is not simply to produce a clean-looking drone database.

The goal is to build a system where every displayed fact can answer:

> **"Where did this information come from, what exactly did the source say, how was it normalized, and how confident are we that it represents the underlying reality?"**
