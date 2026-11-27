# E2 sampling design for semantic resolver v1.3.0

> **Status:** approved at method level on 2026-11-26 (see "Decisions" at the end). **The documentation is closed:** no further refinement until D0 and D5 produce real data. The open gates are:
>
> - D0: validated language detection with language provenance kept;
> - D5: a frozen, read-only historical export with manifest and verifiable hash (content and order);
> - the E2 draw: real population counts, then decided n, m and design effect;
> - statistical inference: the separate derivation and tests in §6.3, before any confidence bound is reported;
> - the seed, registered and committed before D5. This document changes no sampling code and creates no E2 material. Part of [semantic-resolver-v1.3.0-plan.md](./semantic-resolver-v1.3.0-plan.md) (§E2 method, D5).
>
> **Revision 2026-11-27 (maintainer decision A + B; supersedes the language parts below).** D0 3.1.0 was not approved, and no detector version may be a premise of E2. Three changes follow:
>
> - **A. The draw strata are routing strata, not language strata.** The strata key is the frozen rule from before D0 (`detectLanguagePreD0` in `src/entities/normalization/language-legacy.ts`), and its values are en, ru, uk and unknown.
>   - The key is used **only to allocate the draw**, never as resolver input.
>   - Design B stays as it is (minimum m per stratum, proportional remainder, §3.1).
>   - The manifest records N_h, n_h, the inclusion probabilities and the weights per routing stratum. Population figures are weighted.
>   - The key may misclassify. That does not affect validity, because it is known before the draw and the weights are applied.
>   - **Name them routing strata, never language strata.** No result per routing stratum says anything about language or about any detector's accuracy.
> - **B. The resolver's language comes from separate provenance sources:**
>
>   | Field                                | Meaning                                               | Use in E2                                 |
>   | ------------------------------------ | ----------------------------------------------------- | ----------------------------------------- |
>   | `declaredLanguage`                   | language declared in the source material              | used when present                         |
>   | `adjudicatedLanguage` (new, planned) | language established by an independent human reviewer | used when no declared language exists     |
>   | `detectedLanguage`                   | the detector's assessment                             | stored for analysis; never resolver input |
>   - The effective resolver language is `declaredLanguage`, else `adjudicatedLanguage`, else unknown.
>   - `adjudicatedLanguage` is **never written into `declaredLanguage`**. They are different sources of knowledge.
>   - **Adjudication protocol:**
>     - the blind reviewer records the language **before** the freeze, without seeing resolver output or expected outcomes;
>     - the allowed values are `en`, `ru`, `uk`, `mixed` (mixed text is not forced into ru or uk) and `unknown` (ambiguous);
>     - the protocol, any second reviewer and every disagreement are documented;
>     - the adjudications are frozen with the E2 material.
>     - `mixed` and `unknown` give the resolver no language.
>
> - **What E2 measures.** E2 measures the resolver's semantic behaviour when it has access to declared or independently adjudicated language. E2 does **not** measure:
>   - the precision or coverage of language detection;
>   - automatic language provenance from historical dispatches;
>   - the whole production chain's ability to pick the right language.
>     A good E2 result is no approval of 3.1.0, or of language detection in general.
> - **Gates changed.**
>   - The D0 gate in the status above is replaced: the routing key is the frozen pre-D0 rule and needs no detector approval.
>   - `adjudicatedLanguage` must exist in the schema, with tests, before E2 is frozen.
>   - Sections §1, §2.1, §2.2 (the "Language detector" row) and §3 are read with these changes. Where they say "detected language", read "routing stratum".
>
> **Position:** a smaller E2 that is well-motivated and statistically defensible is better than a larger one that gives false confidence. Every figure below that depends on the population is **illustrative**: the historical export (D5) does not exist yet, so the real stratum sizes are unknown. The numbers must be recomputed from the D5 counts before the size is fixed.

## 1. What can be decided now, and what waits

| Decide now                                            | Waits for D0 / D5                                    |
| ----------------------------------------------------- | ---------------------------------------------------- |
| Strata definition and the rule for small strata (§2)  | The actual stratum sizes N_l                         |
| Allocation method (§3)                                | The final per-stratum n_l (a formula applied to N_l) |
| A size range and the rule for choosing within it (§4) | The final n, fixed from N_l **before** the draw      |
| Draw algorithm, seed rule and freezing (§5)           | The frozen D0 detector version used for strata       |
| What each result level may claim (§6)                 | The bound derivation and its tests (§6.3)            |

## 2. Strata

### 2.1 Decision: stratify the draw by detected language only; record family

> **Superseded in part (2026-11-27):** the strata key is the pre-D0 routing rule (routing strata), not D0 detection. See the revision at the top. The family decision below still holds.

**Draw strata:** `detectedLanguage` ∈ {`en`, `ru`, `uk`, `unknown`}.

- A row is `en`, `ru` or `uk` only when D0 says the detection is **decisive**.
- Everything else is `unknown`. That covers non-decisive Cyrillic, short English, technical keys and other languages.
- The D0 reason code (for example `cyrillic_undetermined`) is stored on the row, so `unknown` can be broken down afterwards.
- `unknown` is **not** split into extra strata by default. However, the manifest and the report always show, for both the population and the E2 sample:
  - the number of `unknown` rows;
  - the number with reason `cyrillic_undetermined`;
  - the number with each other unknown-language reason.
  - If `cyrillic_undetermined` turns out to be large or important, the strata may be reconsidered **before the draw**, from population counts only. Strata are never changed after the draw.

**Family:** recorded for every row with the existing keyword classifier (`classifyFamily` in `src/entities/normalization/semantic-eval/sampling.ts`). It is a **reporting and balance dimension, not a draw stratum.**

**Design decision:** the family distribution in E2 is **descriptive only**. E2 gives no support for family-specific population conclusions, and no family-level estimate, rate or bound is reported from it.

This replaces the earlier `detectedLanguage × family` proposal, for these reasons:

1. **Family results cannot be supported at any size considered here.** With 12 families and a realistic skew, a language sample of 25–50 rows leaves 8–11 families with fewer than 5 draws (illustrative skew; §4.3). Stratifying by family would buy a balance that cannot be used for family-level conclusions.
2. **Language-only strata keep a clean statistical argument.**
   - Within one language, the draw is a simple random sample (SRS).
   - Conditional on how many drawn rows the resolver resolves, those rows are an SRS of the language's resolved subpopulation.
   - That gives a candidate route to a conditional bound. It is not established until §6.3 is written and tested.
   - With language × family strata the same argument needs at least one draw in every non-empty cell, and under the existing refusal rule (§F of the Phase 3.2 plan) most cells would get no draw.
3. **The family spread stays random.** An SRS within language yields families roughly in proportion to their occurrence. The realised family distribution is reported next to the population's, as a balance check.

**Rejected alternative:** `detectedLanguage × family` with proportional allocation inside each language. It is valid for point estimates, but it needs its own bound derivation, and with the cell-coverage rule it would mostly refuse bounds.

### 2.2 Independence from the resolver (direct and indirect)

| Possible leak                | Rule                                                                                                                                                                                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Resolver status as a stratum | **Forbidden.** No stratum, allocation, exclusion or sort key uses any resolver output                                                                                                                                                                                                                        |
| Resolver run before the draw | **Not run.** The E2 pipeline freezes the frame and draws without calling `resolve()`. Resolver status is first computed in the evaluation step, after the gold labels are frozen                                                                                                                             |
| Exclusion rules              | Only the existing resolver-independent reasons: `empty_raw_key`, `empty_excerpt`, `missing_published_at`, `invalid_published_at`, `after_cutoff`, `conflicting_evidence_metadata`, `duplicate_evidence`, `duplicate_example_id`. Every excluded row is counted by reason. `verification_audit` is never read |
| Family classifier            | Keyword-based, with no alias rules or snapshot, as already documented in its source                                                                                                                                                                                                                          |
| Language detector            | D0 is not the resolver, but it is under evaluation itself (E4). Its version is **frozen and stamped** in the E2 manifest. Results per language are results per **detected** language, and the report says so                                                                                                 |
| Rule authors see E2 rows     | The v1.3.0 rule set is frozen and its snapshot hash recorded **before** the draw is opened. Anyone who writes resolver rules does not see E2 rows before the evaluation. A rule change after that retires this E2 version                                                                                    |

### 2.3 Small and empty strata

| Situation                      | Handling                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| N_l = 0                        | Reported as an empty stratum; no draw                                                                                           |
| 0 < N_l ≤ m (the minimum)      | **Census:** every row is taken, weight 1, flagged "census, small stratum". The places it leaves unused are redistributed (§3.1) |
| n_l < 10 after allocation      | Included in the weighted aggregates. Per-stratum figures are printed only descriptively, with "too few for a conclusion"        |
| Any family with < 5 drawn rows | Family figures are descriptive only, never an estimate                                                                          |

## 3. Allocation

Two designs, applied to the language strata.

**A. Proportional.** n_l = n · N_l / N (largest remainder, as `allocateWithinCeiling` already does).

- Every row has the same inclusion probability n/N, so the sample is **self-weighting**: an unweighted sample proportion is an unbiased population estimate.
- The cost is that small languages get very few rows. At n = 200 with Ukrainian at 3–10 % of the population, Ukrainian gets **6–20 rows**.

**B. Minimum per language, proportional remainder (decided).** Each language gets at least m = 25 rows (or all of its rows, if it has fewer), and the rest is spread in proportion to stratum size. The exact procedure, including small strata, is §3.1.

- Inclusion probability is π_l = n_l / N_l and the weight is w_l = N_l / n_l. Both are recorded in the manifest for each stratum.
- **Every population estimate must be weighted.** An unweighted figure over a minimum-allocated sample over-represents the small languages, so it is printed only as a descriptive figure about the sample (§6.1).
- Unequal weights lower the effective sample size: n_eff = n / deff, with Kish deff = n·Σw²/(Σw)².

**Consequences (illustrative scenarios; recompute from D5):**

- S1: en 55 %, ru 30 %, uk 10 %, unknown 5 %.
- S2: en 70 %, ru 22 %, uk 3 %, unknown 5 %.

| n   | Design | Per language (S1)  | deff S1 / S2 | Smallest language | Can it see a language-wide problem? |
| --- | ------ | ------------------ | ------------ | ----------------- | ----------------------------------- |
| 100 | A      | 55 / 30 / 10 / 5   | 1.00 / 1.00  | 5 (S1), 3 (S2)    | no                                  |
| 100 | B      | 25 / 25 / 25 / 25  | 1.62 / 2.17  | 25                | yes, gross failures only            |
| 150 | A      | 83 / 45 / 15 / 8   | 1.00         | 8 (S1), 5 (S2)    | no                                  |
| 150 | B      | 53 / 40 / 30 / 28  | 1.27 / 1.45  | 27–28             | yes, gross failures                 |
| 200 | A      | 110 / 60 / 20 / 10 | 1.00         | 10 (S1), 6 (S2)   | weak                                |
| 200 | B      | 80 / 55 / 35 / 30  | 1.16 / 1.26  | 28–30             | yes, gross failures                 |
| 300 | A      | 165 / 90 / 30 / 15 | 1.00         | 15 (S1), 9 (S2)   | weak                                |
| 300 | B      | 135 / 85 / 45 / 35 | 1.08 / 1.13  | 31–35             | yes, somewhat finer                 |

**Why B:** the most likely failure we know about is language-specific (the RCA and D0). Under A, Ukrainian rows are too few to show even a total failure. B costs some aggregate precision through deff, and that cost shrinks as n grows.

### 3.1 Allocation procedure for design B (exact, deterministic)

Inputs: stratum sizes N_l, total n, minimum m.

1. **Empty strata** (N_l = 0) get nothing and are reported as empty.
2. **Full census.** If n ≥ Σ N_l, every row is taken, all weights are 1, and the realised total is Σ N_l.
3. **Minimum.** Each non-empty stratum gets min(N_l, m). A stratum with N_l ≤ m is now a **census**: all its rows, weight 1.
4. **Refusal.** If the minima already exceed n, the allocation is **refused**. n or m must then be changed in writing before the draw. Nothing is reduced silently.
5. **Remainder.** r = n − Σ allocated. Spread r over the **open** strata (those with n_l < N_l), in proportion to N_l: raw share r·N_l / Σ N_open. Each open stratum gets the floor of its share. The units still left go one each to the largest fractional parts; a tie goes to the stratum name that sorts first.
6. **Caps.** No stratum may exceed N_l. Any excess above a cap is returned to r, and step 5 is repeated over the strata that are still open, until r = 0 or every stratum is a census.
7. The manifest records N_l, n_l, π_l, w_l and the census flag per stratum, together with n, m and the number of redistribution rounds.

**Hand-computed test cases** (n = 150, m = 25 unless stated). These become unit tests when the allocation is implemented:

| Case                       | N (en / ru / uk / unknown) | Result n_l (en / ru / uk / unknown) | Sum | Note                                                                           |
| -------------------------- | -------------------------- | ----------------------------------- | --- | ------------------------------------------------------------------------------ |
| One small stratum          | 1000 / 400 / 12 / 88       | 67 / 42 / 12 / 29                   | 150 | uk census; r = 63 spread over en, ru, unknown; remainders go to ru and unknown |
| Empty stratum              | 900 / 300 / 0 / 50         | 79 / 43 / – / 28                    | 150 | uk reported empty                                                              |
| Several small strata       | 500 / 20 / 8 / 3           | 119 / 20 / 8 / 3                    | 150 | three census strata; en takes the rest                                         |
| Caps force redistribution  | 60 / 40 / 30 / 26          | 54 / 40 / 30 / 26                   | 150 | uk and unknown hit their caps in round 1, ru in round 2                        |
| Minimum exceeds n (n = 90) | 100 / 100 / 100 / 100      | refused                             | –   | 4 × 25 = 100 > 90                                                              |
| n ≥ population             | 50 / 30 / 10 / 5           | 50 / 30 / 10 / 5                    | 95  | full census, all weights 1                                                     |

## 4. Sample size

### 4.1 The questions E2 must answer

1. **Does v1.3.0 fail systematically in any language** on real data? This is per-language detection of gross failure.
2. **How often is a v1.3.0 resolution wrong** on the historical population? This is the aggregate Resolution Precision, with an upper bound on the error rate.
3. **How often is a withholding wrong?** This is the aggregate Withholding Precision.

E2 is **not** suited to measuring the effect of the D1 aliases, and that matters for interpreting it. v1.3.0 differs from v1.2.0 only on rows whose key matches one of the ~5 new rules, and a random draw of 100–300 rows may contain few or none. That question is answered by a separate **difference census** (§4.4).

### 4.2 What each size can say (planning approximations only)

> **These are illustrative planning approximations, not valid E2 confidence bounds.** They plug a Kish effective sample size into a binomial Clopper–Pearson formula, which is a rough guide for choosing n and nothing more. They must **never** be used to approve or reject a resolver target. §6.3 is the only authoritative source for real E2 bounds.

Assumptions: the resolver resolves about half of all rows (r ≈ 0.5, unknown on real data); 95 % one-sided Clopper–Pearson on the approximate effective n; ≈ 2 min per card for blind review plus reveal, with a range of 1.5–3 min.

| n       | Design B: aggregate resolved n (≈ r·n_eff) | Error bound if 0 / 2 errors among resolved | Per language (≥ 25–35): bound if 0 errors; chance to see ≥ 1 error when the true rate is 5 % / 10 % | Human time    |
| ------- | ------------------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------- |
| 100     | 23–31                                      | 9–12 % / 19–25 %                           | 11.3 %; 72 % / 93 %                                                                                 | 2.5–5 h       |
| **150** | **52–59**                                  | **5.0–5.6 % / 10–12 %**                    | **≈ 10 %; 74–76 % / 94–95 %**                                                                       | **3.8–7.5 h** |
| 200     | 79–86                                      | 3.4–3.7 % / 7–8 %                          | ≈ 10 %; 76–79 % / 95–96 %                                                                           | 5–10 h        |
| 300     | 133–139                                    | 2.1–2.2 % / 4.5–4.7 %                      | 8–9 %; 80–83 % / 96–98 %                                                                            | 7.5–15 h      |

What the table means:

- **No size considered can demonstrate the 99 % Resolution Precision target.** Even with zero errors that needs about 299 resolved rows, so n ≈ 600+ at r = 0.5. A larger E2 therefore does not change the _kind_ of conclusion, only how narrow the bound is.
- **The 95 % Withholding Precision target** needs at least 59 withheld rows with zero errors. That is reachable from n ≈ 150 (B) only if at most about one error is found.
- **Per language, every size gives the same kind of answer:** "no gross failure" (≈ 10 % bound) or "a problem exists". Fine per-language precision would need roughly 100 rows per language.
- **Going from 150 to 300** halves the aggregate bound (about 5 % → 2 %) and doubles the human time (≈ 5 h → 10 h at 2 min per card). Per-language power barely changes.

### 4.3 Family coverage (illustrative skew)

Within one language, using a skewed distribution of 12 families:

- 25 drawn rows leave 11 of 12 families with fewer than 5 rows;
- 50 rows leave 8 of 12;
- 100 rows leave 4 of 12.

No size considered gives family-level estimates. Families are reported descriptively only.

### 4.4 Companion measure: difference census (decided; separate from E2)

After E2 is frozen, v1.2.0 and v1.3.0 are run over the **whole** frozen frame. That is deterministic and needs no sampling. Every row where their outputs differ forms a known set D.

- **Two different questions.** E2 asks how v1.3.0 performs on a random sample of the historical population. The difference census asks whether the changes v1.3.0 makes compared with v1.2.0 are correct.
- **Blinding covers both versions.**
  - The reviewer first judges the source material and records a blind verdict without seeing either output.
  - Only then are the two outputs shown, as anonymised alternatives "A" and "B" in a seeded random order per row.
  - The mapping from A/B to versions is stored and revealed only in the report.
- **Size rule, fixed in writing before D is computed.**
  - Default: **every** row in D is reviewed, which makes it a true census.
  - If a threshold K and a fallback design are needed for cost, both are written down before D is computed. The fallback is a seeded SRS of K rows from D, stratified by the rule that caused the difference.
  - The result is then called a **sample of the difference set**, not a census, and is reported as such.
- **Kept separate.** It is selected by resolver output, so it is **never pooled with E2** and never used for population error estimates.

### 4.5 Recommendation

- **Default, preliminary: n = 150 with design B (m = 25).** It is a reasonable diagnostic sample with limited statistical power, and it meets no quality target.
  - In the illustrative planning approximation (§4.2), it gives an aggregate upper error bound of about 5 % **only if zero errors are observed**. With two errors that rises to about 10–12 %.
  - Per language it can show a gross failure, at an approximate 10 % level.
  - It takes about 5 hours of review and is paired with the difference census.
- **Choose n = 200 instead** only if the D5 counts show the minimum allocation costs too much (deff > 1.4), or if a narrower aggregate is a stated requirement written down before the draw.
- **n = 100** only as a per-language smoke test.
- **n = 300 is not recommended** for this version. It doubles the cost and still cannot reach the 99 % target.
- **The final n and m are fixed in writing from the D5 stratum counts and the computed design effect, before the draw.** Population counts are not outcome data, so using them is allowed. Nothing about labels or resolver output may influence n.

## 5. Seed and reproducibility

1. **Seed is fixed before the export.** It is a plain string such as `drone-intel-hub-e2-v1`, written into this document in a commit that comes **before** the D5 export and the draw in the documented history. Choosing among several seeds is not allowed.
   - The commit is an audit trail, not cryptographic proof of when the seed was chosen.
   - The stronger reproducibility checks are the export file's hash, the manifest hashes and the exact replay (points 2 and 4).
2. **Input.** The draw reads only the frozen D5 export file. Its SHA-256 and the database snapshot boundary (cutoff, row count, hash of ordered source ids) are in the manifest.
3. **Algorithm:** the existing one, unchanged except for the stratum key.
   - Rows are grouped by stratum.
   - Ids within a stratum are sorted lexicographically by `exampleId`.
   - The per-stratum RNG seed is the first 8 hex digits of SHA-256(`seed|stratum`), fed to mulberry32 (`seededRandom`).
   - The sorted ids are shuffled with Fisher–Yates (`shuffle`), and the first n_l are taken.
   - Allocation is the deterministic procedure in §3.1, with ties broken by stratum name.
   - The stratum key for E2 is the detected language alone. It contains no family and no resolver status.
4. **Replay.** Verification redraws from the export, seed and parameters and requires an exact match: same ids, same allocation, same hashes. This is the same rule S5 already enforces for the pilot.
5. **No silent replacement.** E2 lives in its own versioned directory (`e2-v1`). A new draw is a new version with a written reason. Verification refuses a manifest whose draw does not replay. An E2 version, once frozen, is never edited. Using its results to change rules retires it.

## 6. Three result levels, kept apart

### 6.1 Descriptive: the reviewed sample

- Counts and unweighted shares **for these n cards only**: per language, per family, per resolver status, per verdict.
- Always labelled "describes the reviewed sample; not a population estimate".
- Under design B, unweighted pooled shares are biased toward small languages and **must not** be read as population figures.

### 6.2 Estimates for the historical population

- **Estimands:**
  - Resolution Precision: the share of resolved rows in the frozen frame whose canonical id the human confirms.
  - Withholding Precision: the same for withheld rows.
  - Both are per language and aggregated.
- **Estimator: a weighted ratio estimator,** with weights w_l = N_l / n_l: P̂ = Σ_l w_l·correct_l / Σ_l w_l·resolved_l. Here correct_l and resolved_l are sample counts in stratum l. Weights apply to counts, never to ratios of ratios (as §F of the Phase 3.2 plan requires).
  - It is a reasonable estimate of the defined estimand. It is **not** claimed to be exactly design-unbiased in every situation: a ratio of weighted counts can be slightly biased in small samples.
  - Its inferential properties (variance, bounds) are handled only in the separate derivation (§6.3).
- `insufficient_evidence` is shown in two views, as in the Phase 3.2 plan. The worst-case sensitivity view is primary. The conditional view is shown next to its coverage rate.
- **Scope:** the frozen frame up to its cutoff. It says nothing about future sources, languages or attributes.
- Families and strata with n_l < 10 get no estimate.

### 6.3 Confidence intervals and upper bounds: separate justification required

- The Phase 3.2 bounds were derived for strata of language × family × **resolver status**. E2's strata differ, so **those bounds may not be reused** without a new derivation.
- **Candidate argument, to be written and tested:**
  - Within language l, the draw is an SRS of size n_l from N_l.
  - Conditional on the number of drawn rows the resolver resolves (k_l), those k_l rows are an SRS of size k_l from the resolved subpopulation R_l. Its size N_{R,l} is known exactly once the resolver is run on the whole frozen frame, after the labels are frozen.
  - The finite-population stratified bound (`stratifiedUpperBound`) can then be applied over the strata R_l, conditionally on k_l. That needs k_l ≥ 1 in every non-empty R_l; otherwise the bound is refused, as today.
  - The same argument applies to the withheld subpopulations W_l.
- **Before any bound is printed:**
  - the derivation is written down, including why conditioning on k_l preserves exactness;
  - hand-computed test cases (including k_l = 0 and census strata) exist;
  - the S5 refusal conditions are extended to E2.
- Until then, E2 prints §6.1 and §6.2 only. Approximate (normal or Kish-adjusted) intervals, including those in §4.2, are not used for claims.
- **This section is the only authoritative source for E2 confidence intervals and upper bounds.**

## 7. Review checklist

These are the three points the maintainer asked to review, and where each is addressed:

1. **Independent of the resolver?** §2.2. The draw path calls no resolver, and the rule freeze precedes the draw. Language strata come from D0, which is stamped, evaluated separately (E4) and reported "per detected language".
2. **Do allocation and weights give a correct population estimate?** §3, §3.1 and §6.2. Design B with an exact allocation procedure, recorded π_l and w_l, a weighted ratio estimator, and unweighted figures confined to the descriptive level.
3. **Is the size enough for the intended conclusions?** §4.2 and §4.5. n = 150 is a diagnostic sample with limited power. In the planning approximation it supports "no gross per-language failure" and, at zero observed errors, an aggregate bound of about 5 %. No size here can show 99 %. Whether the D1 aliases are right is answered by the difference census.

## Decisions (2026-11-26)

| #   | Point                         | Decision                                                                                                                                                                                 |
| --- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Draw strata                   | **Detected language only.** Family is recorded and descriptive; E2 supports no family-level population conclusions                                                                       |
| 2   | Allocation                    | **Design B, m = 25**, with the exact small-strata procedure and test cases in §3.1                                                                                                       |
| 3   | Size                          | **n = 150, preliminary.** Final n and m are fixed from the D5 counts and design effect before the draw                                                                                   |
| 4   | Difference census             | **Yes, separate from E2.** Blind to both versions, outputs shown as A/B in random order; review all differences by default; any fallback sample is pre-registered and named as a sample  |
| 5   | Splitting `unknown`           | **Not by default.** The counts of `unknown`, `cyrillic_undetermined` and other reasons are always reported, for population and sample. Any change of strata happens only before the draw |
| 6   | Confidence bounds             | **None** before the separate derivation and tests in §6.3. The §4.2 figures are planning approximations only                                                                             |
| 7   | E2 material and sampling code | **Not created in this step**                                                                                                                                                             |

### Gates still open

- The D5 export and its real stratum counts, which fix n, m and the design effect.
- The §6.3 bound derivation and its tests.
