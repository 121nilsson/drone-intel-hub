# Claim source-unit report — run 3 (dry run)

Run of `scripts/report-claim-units.ts` against the live PostgreSQL catalogue, after commit
`ecca42a` ("Unit evidence: fixes found by the second catalogue report"), which changed the modules
the script depends on rather than the script itself.

Read-only. The script writes nothing; no claim, spec or audit row was modified.

```
npx tsx --env-file=.env.local scripts/report-claim-units.ts
```

Supersedes `scripts/output/report-claims-units-run2.md`.

## Result

```
Numeric claims: 1809 in 1363 attribute(s) of 989 system(s).
By source-unit basis:
  value_text: 499
  quote: 801
  extractor_unverified: 0
  conflict: 0
  unknown: 509
Read through the attribute's unit only (basis unknown or extractor_unverified, attribute has a unit): 277
  by attribute: range 32, unit_cost 21, speed 18, payload 16, payload_capacity 14, endurance 10, rate_of_fire 6, cruise_speed 6, max_speed 5, length 5, fiber_spool 5, target_altitude_max 4, warhead 4, ammunition_capacity 4, target_altitude_min 3

What step B does with them (unit-policy.ts):
  evidenced: 1282
  declared: 30
  not_needed: 345
  unverified: 0
  unknown: 152
  conflict: 0
Held back from consensus ("unit unknown"): 152
  range: 23
    Audag-6: 15 miles | no quote
    BladeHAUL: 600-plus kilometers km | no quote
    Corsair: понад 1000 морських миль km | із дальністю ходу понад 1000 морських миль
  speed: 15
    9М333: 550 m/s | no quote
    EDM4S SkyWiper: 80–220 km/h | no quote
    ERAM: exceeding Mach 0.6 km/h | travel at speeds exceeding Mach 0.6
  payload_capacity: 14
    Audag-6: 200 pounds | no quote
    BladeHAUL: 10-Ton kg | BladeHAUL UGV with a 10-Ton Payload Capacity
    BladeHAUL: 10-plus tons kg | no quote
  payload: 11
    FP-1 / Lyutyi: 75 kg | no quote
    FP-1 / Lyutyi: 50 kg | no quote
    Katran-X: 300 kg | no quote
  endurance: 9
    EDM4S SkyWiper: 10–20 minutes | no quote
    Geran-5: 2 hours | тривалість — до двох годин
    MANGAL: 8 hours or more min | no quote
  rate_of_fire: 5
    2S4 Tyulpan: 1 round every 62 seconds | can hurl a maximum of one round every 62 seconds
    Skyranger 30: 1250 rounds per minute | capable of firing up to 1,250 rounds per minute
    Skyranger 30: 1,250 rounds per minute | capable of firing up to 1,250 rounds per minute
  length: 5
    Corsair: 7 m | Corsair є 7-метровим морським дроном
    Seetaube: 6 m | STARK's first six-meter boat for Germany, the Vanta-based Seetaube
    VANTA 24: 24 m | 24-метровий безекіпажний катер VANTA 24
  fiber_spool: 5
    KVN Fiber-Optic FPV: 10 km | no quote
    KVN Fiber-Optic FPV: 20 km | no quote
    KVN Fiber-Optic FPV: 15 km | no quote
  target_altitude_max: 4
    AD-1 Inferno: 10 km | "autonomous fire superiority up to ten kilometres high"
    AD-2: более 9 km | AD-2 имеет аналогичные дальность и высоту поражения
    PAC-3 Edge: higher than PAC-3 MSE km | designed to reach higher, fly farther and maneuver harder than the PAC-3 MSE now in service.
  warhead: 4
    Filin: порівнянна з 1–2 «Шахедами» kg | Вага бойової частини порівнянна з 1–2 «Шахедами»
    Filin: 50 kg | боевая часть – 50 или 100 кг
    Filin: 50 kg | бойова частина залежно від версії становить 50 або 100 кг
  target_altitude_min: 3
    9М333: 10 m | no quote
    9М333: 3500 m | no quote
    Tor-M2: 10 m | no quote
  engagement_range: 3
    AD-2: до 20 km | AD-2 имеет аналогичные дальность и высоту поражения
    Tor-M2: 16 km | no quote
    VL MICA: до 20 km | накрывают воздушные цели по кругу 360° на дальности до 20 к м
  max_speed: 3
    AGM-183A: Mach 5+ km/h | The Air-Launched Rapid Response Weapon is designed to strike targets at significant standoff ranges while traveling faster than Mach 5.
    EDM4S SkyWiper: 300 km/h | no quote
    ERAM: more than Mach 0.6 km/h | a speed of more than Mach 0.6
  effective_range: 3
    EDM4S SkyWiper: 3 km | no quote
    EDM4S SkyWiper: 5 km | no quote
    EDM4S SkyWiper: 100–200 km | no quote
  cruise_speed: 3
    FP-1 / Lyutyi: 200 km/h | no quote
    FP-1 / Lyutyi: 180 km/h | no quote
    Geran-3: 330 km/h | the Geran-3 introduced a jet engine and raised cruise speed to roughly 330 hectares per hour

Note: extractor_unverified and conflict need a stored extractor unit (sourceUnit). Claims written
before that field existed have none, so those two stay at zero for them; a claim whose text states
a unit other than the attribute's (nautical miles under a km attribute) is evidenced and is
converted, not a conflict.

Dry run. Nothing written.
```

## Change against run 2

The script is unchanged. Two defects reported in run 2 were fixed in the modules it calls, and both
fixes are visible in the data.

| Measure                     |   Run 2 |   Run 3 |   Delta |
| --------------------------- | ------: | ------: | ------: |
| `value_text`                |     497 |     499 |      +2 |
| `quote`                     |     741 |     801 | **+60** |
| `unknown`                   |     571 |     509 |     −62 |
| Read through attribute unit |     337 |     277 | **−60** |
| `evidenced`                 |   1,228 |   1,282 |     +54 |
| `declared`                  |      32 |      30 |      −2 |
| `not_needed`                |     342 |     345 |      +3 |
| **Held back**               | **207** | **152** | **−55** |
| `unverified` / `conflict`   |   0 / 0 |   0 / 0 |       — |

All six `unitStanding` buckets still sum to 1,809, and both basis tables still sum to 1,809. The
held population fell from 207 to 152, a **26.6 % reduction (55 claims)**, with no change to the
denominator.

### Fix 1 — the price in kilometres (run-2 defect, now resolved)

`expectedUnit()` now short-circuits on a resolved semantic:

```ts
const semantic = semanticOf(spec);
if (semantic.includes(".")) return canonicalUnitForSemantic(semantic);
```

Verified directly: `PAC-3 / unit_cost` still stores `canonicalUnit: "km"`, but `expectedUnit()` now
returns `undefined` and both price claims (`3800000`, `"$3.8 million"`) report `not_needed` /
feeds. This is the correct outcome — the stale `canonicalUnit` is now inert rather than
authoritative.

Across the catalogue, **0 of 1,070 specs with a resolved semantic now deviate from
`canonicalUnitForSemantic`**. The rule holds everywhere, not just on PAC-3.

Consequence for the stale-`canonicalUnit` class: 93 specs with 96 numeric claims remain, but claims
**forced to `unknown` by the stale value fell from 14 to 7**. The 7 that remain are unresolved
raw-key semantics (`scan_time`, `transit_altitude`, `power_output`, `reaction_time`,
`range_full_load`, `mtbf_objective`, `scan_cycle_time`) — the fallback is doing what it was designed
to do for keys the registry does not yet know.

### Fix 2 — units past `+`, range continuations and hyphens

`unitBeside()` now skips `+`, `-plus`, `to`/`and`/`or`/`до`/`і`/`и` range continuations and hyphen
joins before looking for the unit, and `units.ts` reads inflected `кілометр…` / `километр…` /
`кілограм…` / `килограмм…`. This is where the +60 `quote` movement comes from. Confirmed by
before/after on the run-2 examples:

| Claim                                                | Run 2 basis | Run 3 basis  | Parsed unit |
| ---------------------------------------------------- | ----------- | ------------ | ----------- |
| `CB90 CX / length` "16.3m-long"                      | unknown     | `quote`      | `m`         |
| `ARBEL / engagement_range` "150 to 200 meters"       | unknown     | `quote`      | `m`         |
| `Aster 30 / engagement_range` "150 кілометрів"       | unknown     | `value_text` | `km`        |
| `Stunner / max_range` "250 кілометрів"               | unknown     | `quote`      | `km`        |
| `Erieye ER / detection_range` "понад 550 кілометрів" | unknown     | `quote`      | `km`        |
| `Dan / max_speed` "500 кілометрів на годину"         | unknown     | `quote`      | `km/h`      |

The deliberate exception is `ton(s)`, which stays unread because short and metric tons differ by 9 %.
That accounts for several of the remaining held claims (`BladeHAUL 10-Ton`, `CB90 CX exceeding 5
tons`, `BladeHAUL 10-plus tons`) — correct behaviour, not a bug.

## Why 277 and 152 are both right

Same reconciliation as run 2, with the new numbers:

| Step                                                        | Count |
| ----------------------------------------------------------- | ----: |
| Claims with no evidenced unit **and** an attribute unit     |   277 |
| of those, `not_needed` (no _canonical_ unit to get wrong)   |    98 |
| of those, `declared` (unit from a person or curated source) |    28 |
| of those, actually held back (`unknown`)                    |   151 |
| **plus** held-back claims with no `spec.unit` at all        |     1 |
| **Total held back**                                         |   152 |

126 of the 277 (45.5 %) are not at risk: 98 `not_needed` plus 28 `declared`. The single held claim outside the 277 is
`LOCUST X3 / power_output = "30-kilowatt-class"` — a descriptor, correctly held.

## Composition of the remaining 152

Worth reading before deciding whether 152 is acceptable, because the buckets need different fixes.

| Bucket                                                         | Held | What it needs                     |
| -------------------------------------------------------------- | ---: | --------------------------------- |
| No quote at all                                                |   74 | Evidence, not unit parsing        |
| Quote has an unread unit word near the figure                  |   14 | Unit lexicon (mostly `ton(s)`)    |
| Quote writes the figure as a word or a different figure        |   21 | Number-word parsing / quote match |
| Other (descriptor values, non-numeric units, indirect wording) |   43 | Case by case                      |

**74 of 152 (48.7 %) are not a unit-recognition problem at all** — the claim has no evidence quote,
so there is no text to evidence a unit from. No amount of unit-lexicon work will move them. This is
the single most important finding of run 3 for planning: the next improvement is evidence coverage,
not units.

The 43 "other" bucket is dominated by speed values the extractor wrote as Mach ratios
(`AGM-183A "Mach 5+"`, `ERAM "more than Mach 0.6"`) and by claims whose quoted sentence carries no
figure matching the stored value. Those are extraction-quality issues surfacing as unit issues.

## Independent verification

I recomputed every bucket from the database with the same modules, separately from the script:

- numeric claims 1,809; `viaAttributeUnit` 277 — matches.
- bases `{quote: 801, unknown: 509, value_text: 499}` — matches (no `extractor_unverified` or
  `conflict` entries at all).
- standings `{evidenced: 1282, not_needed: 345, unknown: 152, declared: 30}` — matches.

## Recommended actions

1. **Evidence coverage is now the top lever**, not units. 74 of the 152 held claims have no quote;
   a claim with no quote cannot have an evidenced unit by definition. Prioritise whatever recovers
   or backfills evidence quotes.
2. **Add `ton(s)` deliberately, if at all.** 14 held claims hinge on it. The short-ton ambiguity is
   real, so the safe form is a metric-only pattern (`tonne`, `metric ton`) rather than a bare `ton`.
3. **Resolve the 7 raw-key semantics** (`scan_time`, `transit_altitude`, `reaction_time`,
   `mtbf_objective`, `scan_cycle_time`, `range_full_load`, `power_output`). They are the entire
   remaining stale-`canonicalUnit` population, and they are the same orphan-key class as the audit
   RCA's registry finding.
4. **Decide the `sourceNormalizedRaw` guard.** `Audag-6` (`"15 miles"`), `2S4 Tyulpan`
   (`"6 miles"`) and `AR5` (`"7 m"`) all store a unit-bearing `normalized.raw` that the guard
   discards as "built", then find nothing in the (empty) quote. Whether that is right is a policy
   call that should be recorded, not left implicit.
5. **Persist `sourceUnit` / `sourceUnitBasis`.** `unverified` and `conflict` remain structurally
   zero — 0 of 2,082 claims and 0 of 1,613 specs store the field — so the conflict class is still
   unmeasured. Run 1's supplement put it near 106 when `spec.unit` is treated as the extractor's
   unit.
6. **Keep step B in shadow.** 152 claims is a reviewable number; one more fixing round of this kind
   would plausibly bring it under 100.


## Writers notes

What actually changed
The script itself was unchanged — the update landed in the modules it calls (ecca42a, "Unit evidence: fixes found by the second catalogue report"), and it fixed both defects I reported in run 2:
 	Run 2	Run 3	Delta
quote basis	741	801	+60
Read through attribute unit	337	277	−60
Held back	207	152	−55 (−26.6 %)
Denominators are unchanged at 1,809, and all buckets still reconcile.
Fix 1 — the price in kilometres. expectedUnit() now short-circuits when the semantic is resolved, so PAC-3 / unit_cost's stale canonicalUnit: "km" is inert instead of authoritative. I verified it across the whole catalogue: 0 of 1,070 resolved-semantic specs now deviate. Claims forced to unknown by a stale unit dropped 14 → 7.
Fix 2 — units past +, ranges and hyphens. This is the +60. CB90 CX "16.3m-long", ARBEL "150 to 200 meters", Stunner "250 кілометрів" and similar now evidence correctly.
The finding that matters for planning
I broke the remaining 152 down by cause, because they need different fixes:
- 74 (48.7 %) have no evidence quote at all. These aren't a unit problem — no text means no unit can be evidenced. The next lever is evidence coverage, not the unit lexicon. That's the main thing run 3 tells you.
- 21 quote the figure as a word ("six miles", "ten kilometres")
- 14 hinge on unread unit words, mostly ton(s) — which the commit deliberately leaves unread because short and metric tons differ by 9 %
- 43 other (Mach-ratio speeds, quotes that don't carry the stored figure)
Verification
I recomputed every bucket independently from the database and they match the script exactly. Note unverified and conflict are still structurally zero — 0 of 2,082 claims store sourceUnit — so that class remains unmeasured.