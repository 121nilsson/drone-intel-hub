# Claim source-unit report (dry run)

Output of `scripts/report-claim-units.ts` against the live PostgreSQL catalogue, plus the
verification steps needed to read the numbers correctly. Read-only: nothing was written to the
database by the script or by this run.

```
npx tsx --env-file=.env.local scripts/report-claim-units.ts
```

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
  by attribute: range 40, unit_cost 21, speed 20, payload_capacity 16, payload 16, endurance 14,
  engagement_range 10, target_altitude_max 8, length 8, cruise_speed 7, rate_of_fire 6, max_speed 6,
  detection_range 6, warhead 5, fiber_spool 5

Dry run. Nothing written.
```

## What the counts mean

| Basis                  |    Claims | Share of 1,809 | Meaning                                                                              |
| ---------------------- | --------: | -------------: | ------------------------------------------------------------------------------------ |
| `value_text`           |       497 |         27.5 % | The claim's own value text states the unit ("105 lbs", "20–35 kW"). Strongest basis. |
| `quote`                |       741 |         41.0 % | The unit is found in the evidence quote beside the same figure.                      |
| `unknown`              |       571 |         31.6 % | No unit in the value text or the quote.                                              |
| `extractor_unverified` |         0 |            0 % | —                                                                                    |
| `conflict`             |         0 |            0 % | —                                                                                    |
| **Total**              | **1,809** |      **100 %** |                                                                                      |

**1,238 / 1,809 = 68.4 %** of numeric claims have their unit evidenced by the source text itself.
**571 / 1,809 = 31.6 %** have no evidenced unit.

**337** of those 571 are the claims that the planned step B change affects: no evidenced unit _and_
the attribute carries a unit, so today the attribute's unit is silently borrowed. They are 337 /
1,809 = 18.6 % of all numeric claims and 337 / 571 = 59.0 % of the unevidenced ones. The other 234
unevidenced claims sit under attributes with no unit at all, so nothing changes for them.

## Consistency checks run against the database

- **Claim counts reconcile exactly.** `jsonb_typeof(value)='number' OR value ~ '[0-9]'` over
  `drones` gives **1,809** numeric claims, matching the script's total. `spec.claims.filter(isNumeric)`
  and the script's `for (const spec of doc.specs)` loop both cover every claim.
- **System count reconciles.** The database holds **989** drone documents, matching the script's
  `989 system(s)`. 1,363 of 1,613 attribute rows carry at least one numeric claim.
- **Claims are the unit of the count, not attributes.** The 989 systems and 1,363 attributes are
  context; every percentage above is over claims.

## Two caveats that matter for how this is read

### 1. `extractor_unverified` and `conflict` are zero because `sourceUnit` is stored nowhere

Both buckets can only be reached when `sourceUnit` / `sourceUnitBasis` exist on the claim, or when
the caller passes `extractorUnitIsClaimLevel: true`. Checked directly:

| Level  |  Rows | With `sourceUnit` | With `sourceUnitBasis` |
| ------ | ----: | ----------------: | ---------------------: |
| claims | 2,082 |             **0** |                  **0** |
| specs  | 1,613 |             **0** |                  **0** |

`apply.ts` goes to the trouble of computing `sourceUnitFor(...)` and writing `sourceUnitBasis`, but
the persisted documents contain neither field. So on this database `claimSourceUnit` always falls
through to re-deriving from text and quote, and `extractorUnit` is always `undefined` — which makes
both `extractor_unverified` (needs an extractor unit) and `conflict` (needs an extractor unit that
disagrees) structurally unreachable.

**The zeros are therefore "not populated", not "no disagreement found".** They must not be read as
evidence that extractor units agree with the text.

For scale, the same 1,809 claims re-run with the attribute's unit treated as the claim-level
extractor unit — i.e. what the code was effectively assuming when these claims were written — give:

| Basis                  |  Claims |
| ---------------------- | ------: |
| `quote`                |     692 |
| `value_text`           |     440 |
| `extractor_unverified` |     337 |
| `unknown`              |     234 |
| `conflict`             | **106** |

So the conflict class is not rare; it is merely unreachable in the current storage. Under step B
those 337 `extractor_unverified` claims are the ones that become "unit unknown", and the 106
conflicts are claims where the assumed attribute unit is contradicted by the claim's own text.

### 2. The script's `unknown` figure is sensitive to the `spec.unit` argument

`claimSourceUnit(claim, spec)` is called with the spec but without
`extractorUnitIsClaimLevel`, and `claimSourceUnit` deliberately ignores `spec.unit` in that case.
That is the intended design ("an attribute's unit is the canonical one, and reading it as the
claim's unit is the bug this module exists to stop"), so the reported split is the correct one for
the post-change world. It is _not_ a description of how those claims are currently interpreted —
that is what the second table above shows.

## Highest-impact attributes

The 337 affected claims are concentrated. The top five attributes account for 113 of them
(33.5 %):

| Attribute          | Claims read through the attribute's unit only |
| ------------------ | --------------------------------------------: |
| `range`            |                                            40 |
| `unit_cost`        |                                            21 |
| `speed`            |                                            20 |
| `payload_capacity` |                                            16 |
| `payload`          |                                            16 |

`range` alone is 40/337 = 11.9 %. This is the same family that carries the largest share of the
audit sample (48 of 283 scored claims) and one of the seven families the audit's own
2-errors-in-20 alarm flags, so step B will remove the unit assumption from a heavily audited
family first.

## Does this change any audit result?

No. `claimReading()` and `cleanReading()` both prefer `normalized` and fall back to `spec.unit`;
neither calls `claimSourceUnit`. The frozen audit snapshots, the reader questions and the 36/279
audit errors are unaffected by anything in this report. This is a forward-looking measurement of a
planned change, not a re-measurement of the audit.

## Recommended steps before enabling step B

1. **Persist `sourceUnit` / `sourceUnitBasis`** on specs and claims, so `extractor_unverified` and
   `conflict` become measurable instead of structurally zero. Without this, the change cannot be
   reviewed against real data — only against a re-derivation.
2. **Re-run this script after backfill** and compare: the 337 should split into real
   `extractor_unverified`, real `conflict`, and `unknown`. The 106-conflict figure above is the
   expected order of magnitude, not a prediction.
3. **Triage `range` and `unit_cost` first** (61 claims between them). A missing unit on `range` is
   more dangerous than on `unit_cost`, because range figures span km, nmi and m in this catalogue.
4. **Keep the change in shadow** until the conflict set has been read. A claim whose text says
   `105 lbs` and whose attribute says `kg` is exactly the ERAM class in the audit RCA, and those 106
   are candidate duplicates of a known real error rather than noise.


### writers notes:

The output
Numeric claims: 1809 in 1363 attribute(s) of 989 system(s).
By source-unit basis:
  value_text: 497
  quote: 741
  extractor_unverified: 0
  conflict: 0
  unknown: 571
Read through the attribute's unit only ...: 337
  by attribute: range 40, unit_cost 21, speed 20, payload_capacity 16, payload 16, ...

What I checked rather than assumed

- Counts reconcile with the database. SQL gives exactly 1,809 numeric claims and 989 systems — matching the script. So the numbers are complete, not filtered.
- The two zeros are not a clean bill of health. extractor_unverified and conflict are structurally unreachable here: 0 of 2,082 claims and 0 of 1,613 specs have sourceUnit stored. apply.ts computes it and writes sourceUnitBasis, but the persisted documents contain neither field. With no extractor unit, both buckets can never be entered.

That second point materially changes how the report should be read, so I quantified it. Re-running the same 1,809 claims with the attribute's unit treated as the claim-level unit — what the code effectively assumed when these claims were written — gives 106 conflict and 337 extractor_unverified. So the conflict class isn't rare; it's just invisible in current storage.

One thing to flag

The 337 figure is the set step B actually changes: no evidenced unit, and the attribute has one. They're concentrated in range (40) and unit_cost (21) — and range is both the largest family in the audit sample and one of the seven families the audit's own alarm already flags. The 106 conflicts are likely duplicates of the ERAM 105 lbs → 105 kg class from the RCA, so I recommended triaging those before enabling anything.
I also confirmed this report cannot perturb the audit: claimReading() and cleanReading() never call claimSourceUnit, so the 36/279 result and every frozen snapshot are untouched.