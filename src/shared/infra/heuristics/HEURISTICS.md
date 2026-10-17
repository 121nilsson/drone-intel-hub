# Heuristic engine

```text
@/shared/lexicons/        en, uk, ru, sv  – vocabulary only (money, units, cues)
heuristics/
  regex-cache.ts          getRe: compiled-pattern cache keyed on pattern + flags
  names.ts                detectNames, mentions, resolveSystems (catalog + variants;
                          stop-worded catalog names — e.g. calendar words — never match)
  facts.ts                extractFacts: schema-checked sink + SPEC_EXTRACTORS order
  pricing.ts              unit price vs contract value (never mixed)
  extractors/
    common.ts             measureCue, extractCountedNouns (both use the cache)
    uav|ugv|cuas|shorad   per system class
    structure.ts          weights, payload, warhead, fuel capacity, dimensions
    observations.ts       counted equipment, sensors, guidance, propulsion, RF bands
heuristic-ai.ts           HeuristicExtractor: orchestration, domain/origin, confidence
```

## Add a language

Copy `@/shared/lexicons/en.ts`, translate entries (regex fragments, no capture groups),
register in `@/shared/lexicons/index.ts`. Native-speaker review required. No extractor edits.

## Add a system class

New file in `extractors/`, append to `SPEC_EXTRACTORS` in `facts.ts`. Use `notAfter` when a
class's envelope (engagement/detection range) could be read as a vehicle's own figure.

## measureCue contract

- `order: "before"`: cue → ≤gap non-digits → number → unit. Gap excludes `\n`.
- `order: "after"`: number → unit → ≤gap → cue. Gap also stops at `.` and `;`.
- `notAfter`: reject when the 24 chars before the number match (cross-class guard).

## Ownership

- `range`/`altitude`/`speed`: uav (guarded by `notAfter` against C-UAS/SHORAD cues).
- `engagement_range`, `detection_range`, `target_*`: shorad / cuas.
- Altitude discipline: engagement/interception altitude cues (lexicon `targetAltitude`) route to
  shorad `target_altitude_max` and feed the uav `notAfter` envelope, so one figure never lands in
  both keys.
- `rfBands`: `observations.ts` `extractRfBands(raw)` — one shared rule for the whole text and
  per-system clause contexts.
- `unit_cost` only with a per-unit cue and no total cue; otherwise `contract_value`.

## Money vocabulary

Lexicon `money.magnitudes` (by scale), `money.currencies` (by ISO code) and `money.compounds`
("mkr" = million SEK) feed both `pricing.ts` and normalization (`parseMagnitude`, `parseMoney`).
`extractPriceNumeric()` returns `{ amount, currency }` (or a range) for the found figure; the
verbatim string stays the stored claim value.
