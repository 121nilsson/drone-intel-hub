# Claim source-unit report — run 2 (dry run)

Run of the updated `scripts/report-claim-units.ts` against the live PostgreSQL catalogue. The
update adds a second layer: `unit-policy.ts` (`unitStanding` / `feedsNumbers`), which reports what
step B will actually do with each claim, not only what the text shows.

Read-only. The script writes nothing; no claim, spec or audit row was modified.

```
npx tsx --env-file=.env.local scripts/report-claim-units.ts
```

Supersedes `scripts/output/report-claim-units.md` (run 1, before the `unit-policy` layer existed).

## Result

```
Numeric claims: 1809 in 1363 attribute(s) of 989 system(s).
By source-unit basis:
  value_text: 497
  quote: 741
  extractor_unverified: 0
  conflict: 0
  unknown: 571
Read through the attribute's unit only (basis unknown or extractor_unverified, attribute has a unit): 337
  by attribute: range 40, unit_cost 21, speed 20, payload_capacity 16, payload 16, endurance 14, engagement_range 10, target_altitude_max 8, length 8, cruise_speed 7, rate_of_fire 6, max_speed 6, detection_range 6, warhead 5, fiber_spool 5

What step B does with them (unit-policy.ts):
  evidenced: 1228
  declared: 32
  not_needed: 342
  unverified: 0
  unknown: 207
  conflict: 0
Held back from consensus ("unit unknown"): 207
  range: 31
    AIM-174B: 600+ km | Modified AIM-174B Becomes Bus for Seven Vektrex Glide Munitions, 155mm Shell-Bomb Hybrid Now Air-Launchable at 600+ km Combined Range
    Audag-6: 15 miles | no quote
    BladeHAUL: 600-plus kilometers km | no quote
  speed: 16
    9М333: 550 m/s | no quote
    EDM4S SkyWiper: 80–220 km/h | no quote
    ERAM: exceeding Mach 0.6 km/h | travel at speeds exceeding Mach 0.6
  payload_capacity: 16
    Audag-6: 200 pounds | no quote
    BladeHAUL: 10-Ton kg | BladeHAUL UGV with a 10-Ton Payload Capacity
    BladeHAUL: 10-plus tons kg | no quote
  endurance: 13
    ADAM-01: 25 min | Flight time	25+ min
    BERTIL-02: 45 min | Flight time 45+ min
    EDM4S SkyWiper: 10–20 minutes | no quote
  payload: 11
    FP-1 / Lyutyi: 75 kg | no quote
    FP-1 / Lyutyi: 50 kg | no quote
    Katran-X: 300 kg | no quote
  engagement_range: 10
    AD-2: до 20 km | AD-2 имеет аналогичные дальность и высоту поражения
    ARBEL Anti-Drone System: 150 to 200 meters | at ranges of 150 to 200 meters
    Aster 30 Block 1 NT: 150 кілометрів km | у радіусі 150 кілометрів
  length: 8
    CB90 CX: 16.3m-long m | 16.3m-long
    Corsair: 7 m | Corsair є 7-метровим морським дроном
    Saildrone: 20 m | the Norwegian company will build the vessel for Saildrone’s 20-meter-long Surveyor USV
  target_altitude_max: 7
    AD-1 Inferno: 10 km | "autonomous fire superiority up to ten kilometres high"
    AD-2: более 9 km | AD-2 имеет аналогичные дальность и высоту поражения
    Buk-M3: до 35 км | та висотою до 35 кілометрів
  detection_range: 6
    Bluebottle: 30 nautical miles (~55 km) | no quote
    Erieye ER: over 550 km | Радар здатен виявляти повітряні об’єкти з малою площею розсіювання, зокрема крилаті ракети та літаки, на відстані понад 550 кілометрів
    Nebo-SV: 380 km | Станція здатна виявляти винищувачі на відстані до 380 кілометрів залежно від висоти польоту.
  rate_of_fire: 5
    2S4 Tyulpan: 1 round every 62 seconds | can hurl a maximum of one round every 62 seconds
    Skyranger 30: 1250 rounds per minute | capable of firing up to 1,250 rounds per minute
    Skyranger 30: 1,250 rounds per minute | capable of firing up to 1,250 rounds per minute
  warhead: 5
    Filin: порівнянна з 1–2 «Шахедами» kg | Вага бойової частини порівнянна з 1–2 «Шахедами»
    Filin: 50 kg | боевая часть – 50 или 100 кг
    Filin: 50 and 100 kg | warheads weighing 50 and 100 kg
  fiber_spool: 5
    KVN Fiber-Optic FPV: 10 km | no quote
    KVN Fiber-Optic FPV: 20 km | no quote
    KVN Fiber-Optic FPV: 15 km | no quote
  max_speed: 4
    AGM-183A: Mach 5+ km/h | The Air-Launched Rapid Response Weapon is designed to strike targets at significant standoff ranges while traveling faster than Mach 5.
    Dan: 500 km/h | максимальна швидкість польоту становить 500 кілометрів на годину
    EDM4S SkyWiper: 300 km/h | no quote
  cruise_speed: 4
    FP-1 / Lyutyi: 200 km/h | no quote
    FP-1 / Lyutyi: 180 km/h | no quote
    Geran-3: 330 km/h | the Geran-3 introduced a jet engine and raised cruise speed to roughly 330 hectares per hour
  max_range: 3
    2S4 Tyulpan: 6 miles | range of around six miles
    Stunner: 250 km | Згідно із заявою виробника, ракета Stunner здатна уражати цілі на максимальній відстані 250 кілометрів
    TSMB M-25: 7.5 miles | targets up to approximately seven-and-a-half miles away

Note: extractor_unverified and conflict need a stored extractor unit (sourceUnit). Claims written
before that field existed have none, so those two stay at zero for them; a claim whose text states
a unit other than the attribute's (nautical miles under a km attribute) is evidenced and is
converted, not a conflict.

Dry run. Nothing written.
```

## Layer 1 — what the text shows (`claimSourceUnit`)

Unchanged from run 1, and the totals still reconcile against SQL: 1,809 numeric claims in 989
systems.

| Basis                  | Claims | Share of 1,809 |
| ---------------------- | -----: | -------------: |
| `value_text`           |    497 |          27.5% |
| `quote`                |    741 |          41.0% |
| `unknown`              |    571 |          31.6% |
| `extractor_unverified` |      0 |             0% |
| `conflict`             |      0 |             0% |
| **Total**              |  1,809 |           100% |

1,238 / 1,809 = **68.4 %** of numeric claims have a unit evidenced by the source text. 571 / 1,809
= 31.6 % do not.

The two zeros remain **"not populated", not "no disagreement found"**: 0 of 2,082 claims and 0 of
1,613 specs store `sourceUnit` / `sourceUnitBasis`, so `claimSourceUnit` always falls back to
re-deriving from text and never has an extractor unit to confirm or contradict. The script's own
closing note now says this explicitly.

## Layer 2 — what step B will do (`unitStanding`)

This is the new information, and it is the more useful half.

| Standing     | Claims | Share of 1,809 | Effect under step B                      |
| ------------ | -----: | -------------: | ---------------------------------------- |
| `evidenced`  |  1,228 |          67.9% | Feeds numbers                            |
| `not_needed` |    342 |          18.9% | Feeds numbers (no unit to get wrong)     |
| `declared`   |     32 |           1.8% | Feeds numbers (person or curated source) |
| `unknown`    |    207 |          11.4% | **Held back**                            |
| `unverified` |      0 |             0% | Held back                                |
| `conflict`   |      0 |             0% | Held back                                |
| **Total**    |  1,809 |           100% |                                          |

**1,602 / 1,809 = 88.6 %** of numeric claims keep feeding numbers; **207 / 1,809 = 11.4 %** are held
back as "unit unknown". The `declared` bucket is the update's main behavioural addition — 32 claims
from analyst entries, the seed catalogue or reference imports that run 1 would have counted as
unknown but which legitimately carry a unit nobody read off a post.

### Why `337` and `207` are both right

They answer different questions and the gap between them is the most important thing in this run:

| Step                                                        | Count |
| ----------------------------------------------------------- | ----: |
| Claims with no evidenced unit **and** an attribute unit     |   337 |
| of those, `not_needed` (no _canonical_ unit to get wrong)   |   103 |
| of those, `declared` (unit from a person or curated source) |    30 |
| of those, actually held back (`unknown`)                    |   204 |
| **plus** held-back claims with no `spec.unit` at all        |     3 |
| **Total held back**                                         |   207 |

So 103 of the 337 are **not at risk**: their attribute carries a display unit but no canonical unit,
so `expectedUnit()` returns nothing and there is no unit that could be wrong. A further 30 are
`declared`. The "held back" figure is 204 + 3 = 207.

The three outside the 337 are worth naming because two of them are a defect, not a judgement call:

- `LOCUST X3 / power_output = "30-kilowatt-class"` — a descriptor, correctly held.
- `PAC-3 / unit_cost` ×2 (`3800000`, `"$3.8 million"`) — **wrongly held**, see below.

`unit_cost` is the largest _display_ bucket in run 1 (21) but contributes only 2 held claims; its
68 `not_needed` claims dominate because `cost.unit` has no canonical unit by design. Run 1's
"by attribute" list therefore overstated the cost exposure.

## Defect found: a price carrying `canonicalUnit: "km"`

`PAC-3 / unit_cost` has `semantic: "cost.unit"` and a stored `canonicalUnit: "km"`. Because
`expectedUnit()` is:

```ts
canonicalUnitForSemantic(semantic) ?? spec.canonicalUnit ?? ...
```

and `canonicalUnitForSemantic("cost.unit")` is `undefined` by design, the **stale** `spec.canonicalUnit`
is used, and a price is measured in kilometres. That is why those two claims reach `unknown`
instead of `not_needed` — they were held back for the wrong reason.

Scope, measured: **93 specs carry a `canonicalUnit` on a semantic that has no canonical unit**,
holding 96 numeric claims, of which **14 are forced to `unknown` by the stale value**. The class is
mostly `speed:km/h` (10), `range:km` (3), then one-off orphans such as `target_diameter`, `distance`,
`projectile_weight`. Only the `cost` instance is clearly harmful; the rest are harmless duplicates
of a unit the semantic would have implied anyway.

This is a pre-existing data defect that the new layer made visible. It is not caused by the
`unit-policy` change, and step B would _carry it forward_: fixing it before step B removes 2 of the
207 held claims with no loss of information.

## A second defect behind several held claims

13+ held claims show `no quote`, and the examples expose a recurring pattern: claims whose
`normalized.raw` looks like `<value> <unit>` are discarded by `sourceNormalizedRaw` as
"built" rather than source text. That heuristic is right in general — `apply.ts` does build such
strings — but it also discards genuinely source-shaped readings when the trailing token is a
_unit word_ that differs from the stored unit token:

```
Audag-6 | payload_capacity | value "200" | norm.raw "200 pounds" | norm.unit "lb" | held
Audag-6 | range            | value "15"  | norm.raw "15 miles"   | norm.unit "mi" | held
2S4 Tyulpan | max_range    | value "6"   | norm.raw "6 miles"    | norm.unit "mi" | held
ARBEL | engagement_range  | value "150 to 200" | norm.raw "150 to 200 meters" | held
```

166 held claims match the "built" pattern; 24 of those have a trailing token that differs from
`normalized.unit`. Those are candidates for un-holding — the unit is evidenced in `normalized.raw`
but the guard throws it away. This is a policy decision, not an obvious bug, so it is reported
rather than fixed here.

## Is this a regression against run 1?

No. Layer 1 output is identical, claim for claim. Layer 2 is additive. The one substantive change
in interpretation is that the _held_ population is 207, not 337 — run 1's headline number counted
claims that step B will not actually touch.

## Recommended actions before enabling step B

1. **Fix the stale `canonicalUnit` on `cost.unit`** (and the 13 other held-by-stale claims). Two of
   the 207 are held for no reason. Low effort, no behaviour change beyond correctly feeding numbers.
2. **Decide the `sourceNormalizedRaw` policy** for the 24 claims whose `normalized.raw` carries a
   unit word. Un-holding them is defensible; doing so silently is not. Record the decision.
3. **Persist `sourceUnit` / `sourceUnitBasis`** so `unverified` and `conflict` stop being
   structurally zero. Until then the conflict class is unmeasured — the run-1 supplement put it at
   ~106 claims when `spec.unit` is treated as the extractor's unit, which is the order of magnitude
   to expect once the field exists.
4. **Triage `range` first** (31 held, 15 % of the held set). Range figures span km, nmi and m in this
   catalogue, so a missing unit there is the highest-risk case; `speed` (16) and `payload_capacity`
   (16) follow.
5. **Keep step B in shadow** until the 207 have been read. The held set is small enough to review,
   and 14 of them are held for reasons that are not about the source text at all.


### writers note

Done. The updated script ran cleanly and the report is at scripts/output/report-claims-units-run2.md.
What changed in the output
The update adds a unit-policy.ts layer, so there are now two answers:
Layer 1 — what the text shows (identical to run 1): 1,809 numeric claims, 1,238 (68.4 %) with an evidenced unit, 571 (31.6 %) without.
Layer 2 — what step B will actually do (new): 1,602 (88.6 %) keep feeding numbers, 207 (11.4 %) held back as "unit unknown". The biggest addition is 32 declared claims from analyst/seed/reference sources that carry a legitimate unit nobody read off a post.
The finding worth your attention
Run 1's headline of 337 "read through the attribute's unit" is not the number step B acts on — 207 is. I traced the gap rather than reporting both side by side:
- 103 of the 337 are not_needed: the attribute has a display unit but no canonical unit, so there is nothing that could be wrong. Not at risk.
- 30 are declared.
- 204 are genuinely held, plus 3 with no spec.unit at all = 207.
So run 1 overstated the cost exposure. unit_cost is a good example: 21 in run 1's list, but only 2 actually held — its 68 claims are not_needed because cost.unit has no canonical unit by design.
One real defect surfaced
PAC-3 / unit_cost stores canonicalUnit: "km" on a price. Because expectedUnit() falls back to spec.canonicalUnit when the semantic has no canonical unit, a price gets measured in kilometres — which is why those two claims land in unknown instead of not_needed. They're held for the wrong reason. Measured scope: 93 specs carry a stale canonicalUnit, 14 claims are forced to unknown by it.
I also flagged a second, softer issue: ~24 held claims have a unit word in normalized.raw ("15 miles", "200 pounds") that the sourceNormalizedRaw guard discards as "built". That may be intended, so I reported it as a policy decision rather than a bug.
Verification
- Totals reconcile exactly with SQL (1,809 claims / 989 systems) and all six unitStanding buckets sum to 1,809.
- Re-captured the run with UTF-8 (chcp 65001) after the first pass mangled Cyrillic example text — the quotes in the report are now exact.
- Prettier-clean, docs-paths.test.ts passes 15/15.
- No temp scripts remain; git status shows only the new file. I did not touch the run-1 file, since you asked for a new one.