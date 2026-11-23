# Semantic evaluation metrics (Phase 3.2 / S5)

> Exploratory evidence on a frozen frame only. A pilot never approves a target. These figures do not establish quality for future reports, languages, sources or attributes.

- Frame `9d1107e45d166578a6a75ebfd252b1a7562e0a4cd3ca37ba8cfa7eb5a0f93fab`, cutoff `2026-11-01T00:00:00Z`, seed `drone-intel-hub-phase3-eval-20261115`
- Snapshot hash `10fe3ec6823a7537a4986a5bfe41c372d8c3fde3afc6a717815cb52f17a27e07`, resolver version 1.2.0, manifest hash `57fa3e24446b46dd2aad79cb81681eaaecc9d054e82eaf40ccba744f094ce2bf`
- Pilot (exploratory); origins fixture; protocol versions protocol-v1
- Human-reviewed decisions 5; insufficient_evidence 0
- Registry gaps 0: meaningful concepts absent from the frozen registry; reported as a registry-coverage finding, never a resolution or a canonical id

## Coverage and sample sizes (read before any performance figure)

Sampling coverage is drawn / eligible population. Human-review coverage is human-reviewed decisions / drawn. Neither is a quality estimate, and neither says that the whole population was reviewed.

| Quantity                                 |  Value | Denominator / meaning                                   |
| ---------------------------------------- | -----: | ------------------------------------------------------- |
| Population (eligible examples)           |     24 | frozen frame restricted to origins fixture              |
| Drawn sample                             |     24 | examples selected by the seeded sampler                 |
| Human-reviewed decisions                 |      5 | valid protocol-v1 blind decisions for these origins     |
| Sampling coverage of population          | 100.0% | drawn / population                                      |
| Human-review coverage of drawn sample    |  20.8% | human-reviewed / drawn                                  |
| Sampling inclusion coverage (cell-level) | 100.0% | population in cells with at least one draw / population |

| Metric               | Assessable human decisions | Reviewed in metric's strata | Conditional performance coverage |
| -------------------- | -------------------------: | --------------------------: | -------------------------------: |
| resolutionPrecision  |                          4 |                           4 |                           100.0% |
| withholdingPrecision |                          1 |                           1 |                           100.0% |
| withholdingRecall    |                          5 |                           5 |                           100.0% |

Assessable decisions are human blind verdicts only; unreviewed drawn examples are not counted as correct, incorrect or abstentions. Conditional performance coverage is assessable / human-reviewed decisions inside that metric's strata and carries no confidence bound. A rate here never means the population was reviewed.

## Primary metrics (blind verdict only, worst-case sensitivity)

The primary safety view: every sampled `insufficient_evidence` and `registry_gap` is counted AGAINST the resolver (a gap is a registry-coverage finding, never a resolution). The original human decision is never rewritten in any data file.

### resolutionPrecision — target 99.0%

- Point estimate (worst-case, expanded by N_h/n_h): not available (a non-empty stratum has no reviewed draw)
- **bound not available**: uncovered non-empty stratum (en|altitude, en|dimension, en|endurance, en|payload, en|range, en|speed)
- Evidence label: **exploratory**
- Conditional performance (descriptive, NO bound): 100.0% over 4/4 human-assessable decisions; conditional performance coverage 100.0%

| Cell          | N_h | n_h (human-reviewed) | worst errors |
| ------------- | --: | -------------------: | -----------: |
| en\|altitude  |   1 |                    0 |            0 |
| en\|cost      |   1 |                    1 |            0 |
| en\|dimension |   1 |                    0 |            0 |
| en\|endurance |   1 |                    0 |            0 |
| en\|maneuver  |   1 |                    1 |            0 |
| en\|payload   |   1 |                    0 |            0 |
| en\|power     |   1 |                    1 |            0 |
| en\|range     |   1 |                    0 |            0 |
| en\|speed     |   2 |                    0 |            0 |
| ru\|payload   |   1 |                    1 |            0 |

### withholdingPrecision — target 95.0%

- Point estimate (worst-case, expanded by N_h/n_h): not available (a non-empty stratum has no reviewed draw)
- **bound not available**: uncovered non-empty stratum (en|capacity, en|other_programme_metadata, en|range, ru|altitude, ru|power, ru|range, ru|speed, uk|payload, uk|power, uk|range, uk|speed)
- Evidence label: **exploratory**
- Conditional performance (descriptive, NO bound): 100.0% over 1/1 human-assessable decisions; conditional performance coverage 100.0%

| Cell                              | N_h | n_h (human-reviewed) | worst errors |
| --------------------------------- | --: | -------------------: | -----------: |
| en\|capacity                      |   1 |                    0 |            0 |
| en\|other_programme_metadata      |   1 |                    0 |            0 |
| en\|range                         |   1 |                    0 |            0 |
| ru\|altitude                      |   1 |                    0 |            0 |
| ru\|power                         |   1 |                    0 |            0 |
| ru\|range                         |   1 |                    0 |            0 |
| ru\|speed                         |   1 |                    0 |            0 |
| uk\|payload                       |   1 |                    0 |            0 |
| uk\|power                         |   1 |                    0 |            0 |
| uk\|range                         |   1 |                    0 |            0 |
| uk\|speed                         |   1 |                    0 |            0 |
| unknown\|other_programme_metadata |   2 |                    1 |            0 |

### withholdingRecall — target 98.0%

- **bound not available**: bound not available: uncovered non-empty stratum (en|altitude, en|dimension, en|endurance, en|payload, en|range, en|speed)
- Components: N_R 11, N_W 13, U_FN,R n/a, upper non-negatives in W n/a, L_TN,W n/a
- Point estimate (count-weighted, no bound): not available (a non-empty stratum has no reviewed draw)
- Conditional performance (descriptive, NO bound): not available (a non-empty stratum has no reviewed decision)
- Evidence label: **target_not_demonstrated**

No required sample size is stated for Withholding Recall: the two-population estimator's behaviour is derived in §F but its n requirement is left unasserted until measured. The realised bound and what it would take are printed here instead of a guessed number.

## Sample-size reality (simple zero-error cases only)

For an all-assessable ratio, 0 errors in n gives a 95% one-sided error bound of 1 - 0.05^(1/n): n ≥ 299 for a 1% bound (Resolution Precision) and n ≥ 59 for a 5% bound (Withholding Precision). These are NOT the sizes needed for the worst-case sensitivity analysis above: each unassessable unit counts as an error there, so the usable n shrinks with the unassessable share. With 24 sampled and 0 errors the bound is still about 11.7%.

## Diagnostics (never evidence)

- Blind-vs-final change rate: 0.0%
- AI-agreement rate (blind human vs suggestion): 100.0%
- `finalVerdict` and `revisedAfterReveal` are diagnostics only; post-reveal revisions can never replace the blind label as evidence.

## Design, coverage and provenance

- Tier 1 (unit/adversarial safety fixtures) remains a 100% hard blocker, reported by S0.
- Weights are applied to counts (N_h x share), never to a ratio of ratios.
- 22 non-empty cells; 74 empty; 0 unsampled non-empty
- Frame-wide exclusions (all origins, not specific to the metrics' origin filter): duplicate_evidence 1
- Source-cluster concentration (transparency only, not a design-effect correction): top 5 clusters 20.8%
- Exact bounds are refused when a non-empty cell has no draw, the sample is not a seeded SRS within cells, the search is incomplete, or protocol versions are mixed.
