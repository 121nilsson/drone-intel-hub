# Phase 3.2 — Human-Efficient Evaluation Infrastructure (plan, rev. 3)

> **Status:** approved direction (rev. 3). S0–S5 (the automated infrastructure) are implemented; the human steps remain: confirm D1–D5, review the five cards, and decide at G3. The Phase 3 spec amendment (D5, section C) has been applied to `docs/phase-3-hybrid-semantic-registry.md` sections 15, 17, 18 and the revision log; the amended spec and this plan now agree. No human labels are fabricated — `decisions.jsonl` is created only by the reviewer.

## Implemented infrastructure (S0–S5)

Pure modules live in `src/entities/normalization/semantic-eval/` (`types`, `validate`, `csv`, `sampling`, `metrics`, `verify`, plus the S0 `replay`). CLIs and generated evidence:

```
npx tsx scripts/sample-historical-evaluation-set.ts --apply   # freeze frame, whole-frame replay, SRS sample
npx tsx scripts/prepare-semantic-suggestions.ts --ai --apply --model <id>   # real AI suggestions (offline mode exists)
npx tsx scripts/semantic-review.ts export --step blind --limit 5            # fill in the five cards
npx tsx scripts/semantic-review.ts export --step reveal                     # reads the filled blind CSV, adds resolver/AI
npx tsx scripts/semantic-review.ts import --file <the filled CSV> --reviewer "Name"
npx tsx scripts/evaluate-semantic-registry.ts --report                      # S5 evidence-labelled metrics (historical only)
```

The one-page annotation rules, allowed verdicts and worked examples are in `docs/semantic-review-protocol.md`.

No `decisions.jsonl` is committed: human labels are created only by the reviewer. `examples.jsonl` is the whole frozen frame; S3 and S4 read the `manifest.json` next to it (or `--manifest`) and process only the drawn sample. S5 requires that manifest and verifies the file hashes, frame id, snapshot/version stamps, resolver statuses, cell counts and drawn ids, then **re-runs `drawSample` with the declared seed and ceiling and requires an exact replay** before emitting a report; there is no fallback to current versions or to an unverified sample. The ceiling is hard-capped at 72 — `--allow-ceiling-override` is required to leave pilot mode, and expansion is a G3 decision. Pilot status is explicit in the manifest and follows that configuration; S5 independently rejects a manifest that claims pilot mode with a ceiling above 72, and reports exclusions as frame-wide rather than origin-specific. Frame cutoff comparison uses UTC instants (`Date.parse`) and undated rows are excluded. Evidence dedupe is source-independent (normalized quote + key + value + unit): syndicated copies collapse, and source concentration is reported separately.

Metrics use `origin: "historical"` by default — the committed demo frame is synthetic (`fixture`), so evaluating it needs `--origins fixture` and never produces a historical claim. Coverage, strata and concentration in the report are derived from the same origin-filtered examples as the metrics, and an empty origin selection aborts the report. Re-review replaces the one active decision per example; no history chain is kept in 3.2. Re-running the sampler and replay is bit-identical and the generators write prettier-formatted reports, so `npm run green` stays green. The adversarial property checks are the S0 invariant suite (INV-01–INV-13); items promoted from it use `origin: "adversarial_ai"` and are reported separately.

## Design principle

Optimise for **as few human decisions as possible per unit of useful evidence**, not for finishing a quota. We are building a review _system_, not another review _queue_. Every human step is on demand, small, and optional beyond the first five cards.

## Context

Phase 3.1 (commits `8af4669` … `3be7b81`, plus `1993fa5`) is reviewed. The Phase 3 spec (§15–17, roadmap 3.2) demands 36 strata × 60 human-reviewed examples (2,160) and hard statistical thresholds. A sole maintainer who also owes a 200-claim audit cannot do that. Phase 3.2 becomes: automated replay and property checks first, tooling second, a five-card feasibility check third, and only then a decision whether any further annotation is justified. Working tree is clean.

## A. Current-state assessment

**Verified in the repo**

| Finding                                                                                                                                                             | Where                                                                                                                            | Consequence                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Semantic fixtures = **13 hand-written records** (`{key,label?,expected,note?}`), English only, 6 families, no unit/context/language, no "withhold" expectation      | `src/test/fixtures/normalization-corpus.ts` `SEMANTICS` (l.341); consumed by `src/test/normalization-fixtures.test.ts` l.128-134 | Replaying them measures **parity with legacy `semanticKeyFor`, not correctness**. Legacy pass-through (`some_unknown_key`) is not ground truth. |
| `verification_audit` rows hold raw key, label, value, quote, post text, language, family and a human `answer`                                                       | migrations 019 to 028, `audit.server.ts`                                                                                         | The verdict is "is the extracted claim correct?", not "which canonical concept?" → weak semantic evidence.                                      |
| Rule: nothing that learns reads the audit seed set                                                                                                                  | `AGENTS.md:26`, `docs/architecture.md` (lines 81 and 83)                                                                         | No evaluation reads `verification_audit` without an explicit owner decision (D1).                                                               |
| `SpecClaim.review` = analyst verdict per claim                                                                                                                      | `src/entities/drone/types.ts`, `claim-review.ts`                                                                                 | May pre-fill context only; never an independent label.                                                                                          |
| Dispatches carry `contentHash` (SimHash), `sourceId`, `url`, `publishedAt`; **no stored language**                                                                  | `src/entities/dispatch/types.ts`, migration 006                                                                                  | Language is derived (`detectLanguage()`, `src/entities/normalization/language.ts`: en/ru/uk/unknown) and frozen in the manifest.                |
| `seededRandom` (mulberry32), `shuffle`, Clopper-Pearson `errorRateUpperBound`, `stratifiedUpperBound`, `allocateProportional` exist                                 | `src/entities/drone/audit.ts` l.46-65, 246-280; `audit-statistics.ts`                                                            | Reusable **only after the §F suitability check** (see below).                                                                                   |
| Scripts: `.ts` via `npx tsx --env-file=.env.local`, dry-run default + `--apply`, reports to `scripts/output/*.md`; AI scripts follow `scripts/benchmark-models.mjs` | `scripts/renormalize-claims.ts`, `src/shared/infra/ai-proxy.*`                                                                   | New tools follow this.                                                                                                                          |
| `docs-paths` test allow-lists 4 planned Phase 3 files and fails if an allowed path starts existing                                                                  | `src/test/docs-paths.test.ts` l.25-40, 73-77                                                                                     | Creating a planned file means deleting its entry in the same change.                                                                            |
| Review UI pattern exists (`correction-queue.tsx`); `/audit` is tied to `claim_id`                                                                                   | `src/features/evaluation/`, `src/features/autonomy/audit-page.tsx`                                                               | **No UI in 3.2**; CSV only.                                                                                                                     |

**Not verified:** where `systemClass` is stored for a drone; `eval-catalog.json` consumers; whether docs-paths flags `historical-stratified-sample.manifest.json`; provider note in memory is 36 days old.

**Genuinely missing:** data model, sampler, two-step review export/import, suggestion prep, metrics/report, property suite.

## B. Architecture

Four record kinds, separate files, never merged in place:

```
 historical DB (read-only) ─► sampler ─► examples.jsonl      RAW, frozen, versioned manifest
                                                │
 resolver (CODE_SEED_SNAPSHOT) over the WHOLE frame ─► predictions.jsonl   RESOLVER (hash-stamped)
                                                │
 AI suggestion script ─► suggestions.jsonl      AI ("suggested", never approved)
                                                │
 step 1 blind-queue.csv ─► decisions.jsonl      HUMAN (blind verdict)
 step 2 reveal.csv      ─► (revision, if any)   HUMAN (may revise after seeing AI/resolver)
                                                ▼
                          metrics + report (scripts/output/*.md + report manifest)
```

- Pure types/validators/metrics in `src/entities/normalization/semantic-eval/` (no DB, no I/O); CLIs in `scripts/`; data in `src/test/fixtures/semantic-eval/`; reports in `scripts/output/`.
- **Isolation:** production imports nothing from here; the existing import-graph test is extended. No change to ingest, claims, consensus, catalog, `formalGate()`, Second Reader, audit statistics, `AUTO_APPLY_TIERS`, or legacy `semantic.ts`.
- 3.2 storage is files; the spec's `semantic_evaluation_runs` collection is deferred to 3.4.

### Data model (minimal)

`Example` (raw): `exampleId`, `sourceClusterId`, `evidenceClusterId`, `source{id,url?,publishedAt?}`, `excerpt` (≤300 chars), `language` (derived+frozen: `en`|`ru`|`uk`|`unknown`), `rawKey` (exact), `rawLabel?`, `rawValue?`, `rawUnit?`, `context{domain?,systemClass?,subsystem?}`, `priorAnalystReview?{claimId,verdict}` (**context reference only — never a label and never shown as one**), `family`, `stratum`, `resolverStatus` (frozen from the whole-frame replay), `origin` (`historical`|`fixture`|`adversarial_ai`), `isPilot`, `frameId`, `schemaVersion`.

- **IDs:** `exampleId` = SHA-256 of `sourceId | attribute-occurrence locator (specId/claimId + evidence span offset or occurrence index) | exact rawKey | rawValue`. It names one occurrence, so the same attribute appearing twice in one text gets two IDs (collision test).
- `sourceClusterId` = same or near-identical publication (SimHash + URL/text hash). `evidenceClusterId` = same concrete claim/passage (hash of normalised evidence quote + normalised key + value + unit).
- **Dedupe rule:** identical evidence is collapsed **before the frame is frozen** (one unit per `evidenceClusterId`); **different attributes from one document are all kept**. There is **no per-source cap**: sampling inside each stratum is a plain seeded simple random sample, so the exact bounds' design assumptions hold. `sourceClusterId` is used only to _report_ how concentrated the frame and the sample are (top-k share, units per source cluster). If the realised sample or the frame violates the assumptions the bounds need, the tool refuses the exact bound (see §F) rather than adding a caveat.

`Suggestion` (AI): `exampleId`, `model`, `promptHash`, `proposed{verdict,canonicalId?,candidates?}`, `rationale`, `missingInfo[]`, `status:"suggested"`.

`Decision` (human): `exampleId`, `blindVerdict`, `blindCanonicalId?`, `blindNote`, `finalVerdict` (equals blind unless revised), `finalCanonicalId?`, `revisedAfterReveal` (bool) + `revisionReason?`, `reviewer`, `reviewedAt`, `protocolVersion`, `status:"human_reviewed"`.

**Label roles (D6, resolved):** `blindVerdict` is the **primary evaluation label** for every quality metric. `finalVerdict` and `revisedAfterReveal` are **diagnostics only**: they show how often exposure to the resolver/AI changed the reviewer's mind and are never used as evidence that the resolver was right. A metric computed on `finalVerdict` may appear in a report only as a clearly labelled, circular-by-construction diagnostic.

`Prediction` (resolver): `exampleId`, full `SemanticResolutionResult`, `snapshotHash`, `resolverVersion`.

**States:** `unreviewed` → `suggested` → `human_reviewed`. `adjudicated` is reserved (needs a second reviewer). One active Decision is kept per example: importing a re-review replaces it, and no historical re-review chain is retained in 3.2 (a `supersedes` chain would need per-decision IDs, deferred with the DB-backed run store in 3.4).

### Annotation rules (protocol v1, one page)

| Verdict                           | Use when                                                              | Counts toward                           |
| --------------------------------- | --------------------------------------------------------------------- | --------------------------------------- |
| `resolve` + `canonicalId`         | Evidence supports exactly one manifest concept (`isValidCanonicalId`) | resolution precision                    |
| `withhold_context`                | Term resolves only under a guard the evidence doesn't satisfy         | negative (withholding)                  |
| `withhold_ambiguous` + candidates | Known polysemous (`radius`, `power`, `capacity`)                      | negative                                |
| `unknown_term`                    | Not a recognised concept                                              | negative                                |
| `insufficient_evidence`           | Excerpt can't support any call                                        | **excluded**, reported as coverage loss |

The reviewer is never forced to choose a canonical ID.

## C. Work breakdown (small, independently reviewable; tests in `src/test/`)

| #      | Objective                                                                                                                                          | Files (likely)                                                                                                              | Output / acceptance                                                                                                                                                                                                                                                                                                                                                                                                                     | Human                                                                                                                                                           |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S0** | **Fully automated first increment, decoupled from S1–S5 (no data model, DB or sampler needed):** replay the 13 fixtures + property/invariant suite | `scripts/evaluate-semantic-registry.ts`, `semantic-eval/replay.ts`                                                          | `scripts/output/semantic-replay.md` with **three separately headed sections that are never merged**: (1) _parity with legacy_ — per-fixture `agree` / `resolver_withholds` / `resolver_differs`; (2) _technical invariants_ — pass counts, 100% required; (3) _semantic correctness_ — always printed as "not measured by S0". The report's opening line states that a green S0 does **not** show the resolver is semantically correct. | **none**                                                                                                                                                        |
| S1     | Data model, validators, JSONL/CSV round-trip, protocol v1 **and the Phase 3 spec amendment (below)**                                               | `semantic-eval/{types,validate,csv}.ts`; `docs/phase-3-hybrid-semantic-registry.md`; the new plan doc; `docs-paths.test.ts` | Round-trip lossless; invalid verdict/ID/protocol rejected; docs consistent                                                                                                                                                                                                                                                                                                                                                              | read protocol + decide D1–D5 (≈15 min)                                                                                                                          |
| S2     | Whole-frame replay + sampler (dry-run default)                                                                                                     | `scripts/sample-historical-evaluation-set.ts`, `semantic-eval/sampling.ts`                                                  | `examples.jsonl`, `predictions.jsonl`, `manifest.json` (seed, cutoff, N_h, n_h, exclusions + reasons, SHA-256); re-run bit-identical                                                                                                                                                                                                                                                                                                    | skim sampling report (≈10 min)                                                                                                                                  |
| S3     | AI suggestion preparation                                                                                                                          | `scripts/prepare-semantic-suggestions.ts`                                                                                   | cached `suggestions.jsonl`; schema forbids `human_reviewed`                                                                                                                                                                                                                                                                                                                                                                             | none                                                                                                                                                            |
| S4     | Two-step review export/import                                                                                                                      | `scripts/semantic-review.ts` (`export --step blind                                                                          | reveal --limit N`, `import`)                                                                                                                                                                                                                                                                                                                                                                                                            | Blind CSV has **no** AI/resolver columns; reveal CSV has them and a blank `final_verdict` (blank = keep); import rejects incomplete/invalid/mixed-protocol rows | the review (§D) |
| S5     | Metrics + report incl. the §F derivation                                                                                                           | `semantic-eval/metrics.ts`, `evaluate-semantic-registry.ts --report`                                                        | Matches hand-computed cases; refuses a bound when assumptions fail                                                                                                                                                                                                                                                                                                                                                                      | none                                                                                                                                                            |
| G3     | **Five-card feasibility check** → stop/decide                                                                                                      | —                                                                                                                           | clarity, speed, AI usefulness, blind-vs-final change rate                                                                                                                                                                                                                                                                                                                                                                               | 5 cards (≈10–15 min)                                                                                                                                            |

Order: S0 → S1+S2 (spec updated alongside) → S3–S5 → five cards → G3. After G3 the system **never auto-produces further cards**; `export` defaults to `--limit 5` and anything larger is an explicit choice.

### Phase 3 spec amendment (same documentation work as this plan)

Edit §15 (sampling), §17 (items 3-6, Tier 2), §18 roadmap 3.2 gate, and the Revision-log bullet that says thresholds are required. The amended text must say explicitly:

- **2,160 examples and 60/stratum are an aspirational future benchmark, not a prerequisite for continuing development.**
- A small pilot may be used **exploratively**; its metrics carry evidence labels, never "passed".
- **Insufficient evidence is reported as insufficient**, never as approval.
- The 98% / 95% / 99% targets remain the long-term acceptance criteria for any _autonomy or production-integration decision_; those phases keep their own quality gates and are not unlocked by 3.2.
- Tier 1 (unit/adversarial safety fixtures) stays a **100% hard blocker**.
- The stratification matrix is a _proposed pilot frame_: 4 languages (incl. `unknown`) × 12 families × 2 resolver statuses = 96 possible cells, with a total ceiling instead of a per-cell quota; empty and unsampled cells are reported (§E–F).
- Blind verdicts are the primary labels; post-reveal revisions are diagnostics only.

## D. Review workflow (blind first, then reveal)

**Step 1 — blind card.** One CSV row; the reviewer sees only the evidence:

```
#17  uk · payload
Excerpt : «…корисне навантаження до 40 кг, злітна маса 160 кг…»   (source 8841, 2026-03-02)
Raw     : key="корисне_навантаження"  value=40  unit=kg   context: domain=Air
Your call: verdict=___  canonical_id=___  note=___      (cannot_tell is allowed)
```

No resolver output and no AI suggestion are shown, so the first judgement is independent.

**Step 2 — reveal (optional per row; blank = keep).** The same ids with extra columns: the resolver's status/candidates and the AI suggestion with rationale and missing info. The reviewer may type a `final_verdict` and a one-line reason. Import stores `blindVerdict` (primary label, immutable), `finalVerdict`, and `revisedAfterReveal` (diagnostics). A revision never overwrites the blind verdict.

AI does all preparation (excerpt, provenance, suggestion, missing-info) but cannot approve anything. Reports show the blind-vs-final change rate and AI-agreement rate, so "human agrees with AI" is distinguishable from "human independently judged". Target ≈1.5–3 min/card; none needs opening a source document.

**One queue, on demand.** The audit stays in `/audit` untouched and has priority. There is **no standing weekly semantic quota**; semantic cards exist only when the maintainer runs `export` with a limit.

## E. Sampling and reuse

- **Reuse (valid):** 13 fixtures → automatic replay only (parity, never truth); `SpecClaim.review` → stored as the `priorAnalystReview` context reference on the example (not shown in the blind step, never a label, never a second vote); adversarial AI items → property checks only.
- **Not reusable:** audit answers as semantic labels; anything from the audit seed set (D1); `semanticKeyFor` outputs; fixture `expected`; AI suggestions.
- **Frame:** eligible spec attributes ≤ cutoff `2026-11-01T00:00:00Z`. Language derived once and frozen (`unknown` its own reported stratum). Family from a deterministic keyword classifier independent of the resolver (documented bias if legacy prefixes are used as a proxy).
- **Key design move:** the resolver is deterministic and cheap, so it is run on the **entire frame**. Every unit's `resolverStatus` (`resolved` / `withheld`) is then a _known_ population quantity. Strata are `language × family × resolverStatus`, so each metric's denominator subpopulation has a known size N_h (this is what makes §F valid).
- **Cell count, stated plainly:** 4 languages (`en`, `ru`, `uk`, **`unknown`**) × 12 families × 2 resolver statuses = **96 possible cells**. Many will be empty; empty cells are reported.
- **Pilot is a ceiling, not an order, and not a per-cell quota.** At most **72 examples in total** may be _drawn_ (never auto-exported; `export` is separate, default `--limit 5`). Allocation uses a seeded simple random sample within each cell, spread across non-empty cells by `allocateProportional`-style largest remainder with small cells taken whole. Because 72 < 96, **some non-empty cells will receive no draw — that is expected and is reported as `unsampled`**. No cell is filled artificially or backfilled from another. The first sampler deliverable is the **sampling report** (N_h, n_h, empty cells, unsampled cells, exclusions + reasons, covered share of the population), reviewed in ≈10 min. Decisions under different protocol versions are never silently pooled.
- **Consequence for statistics:** an overall population bound is only emitted when every non-empty cell of the relevant subpopulation was sampled. Otherwise the report gives per-cell results plus an explicit **covered fraction** of the population and states that the unsampled remainder is unmeasured — it never presents a covered subset as the whole population.
- **Expansion** only after G3 and only for strata with disagreement, ambiguity or high weight; allocation by observed error × weight (`allocateProportional`), never a flat quota.
- **Adversarial set (AI-assisted, separate):** `origin:"adversarial_ai"`, own report. Primarily **label-free property checks**: Class-4 terms never resolve; unknown never carries `canonicalId`; `top_speed`/`cruising_speed`-style pairs never collapse; case/delimiter/camelCase/NFKC perturbations don't change outcomes **only for explicitly defined equivalence classes of examples** (e.g. `max speed` ≡ `max-speed` ≡ `maxSpeed`), never as a universal property of all attribute names; unit-suffix handling (`_km` yes, `_min` no); missing/contradicting guards never resolve; acceleration never classifies as speed. Only property violations, or items the maintainer promotes, ever reach a card.

## F. Metrics and reporting (revised)

The three targets are **conditional ratios with different, outcome-defined denominators**, so a weighted mean of per-stratum precisions is _not_ used. Estimands, with the resolver run on the whole frame:

- R = frame units the resolver **resolved** (N_R,h known); W = units it **withheld** (N_W,h known).
- **Resolution Precision** = share of R whose assigned canonical ID the human confirms. Sample within R-strata; error share estimated and bounded with the finite-population stratified bound (population = R, strata known).
- **Withholding Precision** = share of W that is truly negative (verdict not `resolve`). Sample within W-strata; same design.
- **Withholding Recall** = (true negatives in W) ÷ (true negatives in W + true negatives hidden inside R). Not a simple sample proportion: the numerator and denominator are _estimated counts_, N_W·q_W and N_W·q_W + N_R·e_R, where e_R is the share of R that is truly a negative case (resolved although it should be withheld) and q_W the share of W that is truly negative. Interval: **conservative, componentwise** — upper bound on missed negatives (from R) and lower bound on correct withholds (= N_W minus the upper bound on non-negatives in W), each at α/2, then recall's lower bound from those extremes. Stated as conservative. Exactly: **Recall_lower = L_TN,W / (L_TN,W + U_FN,R)**, where L_TN,W = lower α/2 bound on true negatives in W (N_W minus the upper α/2 bound on non-negatives in W) and U_FN,R = upper α/2 bound on true negatives hidden in R (missed negatives).
- Weights are applied to **counts** (N_h × share), never to ratios of ratios.

**S5's first task is a written suitability check** of `stratifiedUpperBound()` (exact hypergeometric bound on the error _count_ in a finite population with known strata, SRS within stratum, ≥1 draw in every non-empty stratum): derive per metric why it applies to R and W (known N_h) and where it doesn't (recall's ratio), add hand-computed tests, and **refuse to emit a bound** when a non-empty stratum has no draws or the search is `incomplete`. The helper is not reused merely because it exists.

- **Evidence labels (never "passed"):** `exploratory`, `target_not_demonstrated`, `target_demonstrated` (bound meets target at sufficient n), `target_violated` (interval excludes target). A pilot can only emit the first two.
- **Two views of `insufficient_evidence` (never silently dropped), with different statistical status:**
  1. **Worst-case sensitivity — the PRIMARY safety measure and the only one that carries a confidence bound.** The conservative reclassification happens **in the metrics layer only**; the original human decision (`insufficient_evidence`) is never rewritten or overwritten in any data file. Every sampled unit with `insufficient_evidence` is counted _against the resolver_: in R as an error (Resolution Precision) and as a truly-negative miss (Recall); in W as not-truly-negative (Withholding Precision and Recall). The error count is then bounded over the **whole known population** of R (or W), whose size N_h is known, so the finite-population stratified bound applies with its design assumptions intact.
  2. **Conditional performance — descriptive only, NO confidence bound.** Each metric among _assessable_ units (verdict ≠ `insufficient_evidence`), always printed next to the **coverage rate** (assessable share of the sample, per cell and subpopulation). The denominator of this ratio (how many population units would be assessable) is unknown, so `stratifiedUpperBound()` does not give an exact bound for it, and none is reported. If the unassessable share is material the report states that the conditional figure may be optimistic, because the hardest cases tend to land in `insufficient_evidence`. An exact bound for conditional performance would need its own derivation and a tested estimator — explicitly out of scope for 3.2.
- **Sample-size reality — simple zero-error cases only:** for a plain ratio in which every sampled unit is assessable, 0 errors in n gives a 95% one-sided error bound of 1 − 0.05^(1/n); that needs n ≥ 299 for a 1% bound (Resolution Precision) and n ≥ 59 for a 5% bound (Withholding Precision). These numbers are **not** the sample sizes needed for the worst-case sensitivity analysis: there each unassessable unit counts as an error, so the usable n shrinks with the unassessable share. With 24 sampled and 0 errors the bound is still ≈11.7%. **No required n is stated for Withholding Recall** until S5 has derived the two-population estimator's behaviour; the tool prints the realised bound and what it would take, not a number guessed in advance.
- **Scope of every result:** figures describe the **frozen frame only** — historical material up to the cutoff `2026-11-01T00:00:00Z`. They do not establish the same quality for future reports, new languages, new sources or new attributes, and every report says so explicitly.
- Reports always list N_h/n_h/weights, exclusions + reasons, empty and unsampled cells and covered fraction, blind-vs-final change rate (diagnostic), AI-agreement rate, source-cluster concentration (reported for transparency only; the frame is a fixed finite population sampled at random within strata, so it is **not** used as a design-effect correction of the bounds), protocol versions, snapshot hash, seed, manifest hash. No point estimate appears alone. The primary metrics use `blindVerdict` only. Tier 1 stays 100%.
- **Refusal conditions for exact bounds:** any non-empty cell without a draw (see coverage rule above), a sample not drawn as a seeded SRS within cells, an `incomplete` search from `stratifiedUpperBound`, or mixed protocol versions. The tool then reports "bound not available: <reason>" instead of a number.

## G. Human effort (audit has priority; all work in short sessions)

| Step                                                      | Maintainer effort |
| --------------------------------------------------------- | ----------------- |
| S0 automated replay (nothing to decide)                   | **0 min**         |
| S0 read the replay report + triage any `resolver_differs` | ≈10–20 min        |
| S1 read protocol + decide D1–D5 (D6 resolved)             | ≈15 min           |
| S2 read sampling report                                   | ≈10 min           |
| S3–S4 test **five** review cards (blind, then reveal)     | ≈10–15 min        |
| G3: decide whether to continue                            | your call         |

- **Minimal (recommended stop point):** the rows above = **≈45–60 min total**, spread over ≥3–4 sessions.
- **Only if G3 shows value:** up to ~25 more cards ≈ 1–1.5 h (≈2 min/card with blind+reveal), chosen from the highest-risk strata.
- **Optional ceiling:** the 72-card pilot ≈ 3.5–4.5 h — a _possible_ sample, not a commitment.
- **Expanded (later, only with spare time and a concrete reason):** 360 cards ≈ 12–18 h. Former 2,160-card target ≈ 60–110 h: **not planned, not a prerequisite.**
- No recurring weekly obligation. If G3 says the evidence isn't worth more human time, annotation is **deferred** and the automated checks (S0, properties) keep running.

## H. Risks and safeguards

| Risk                                         | Mitigation                                                                                                                                                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI suggestion mistaken for ground truth      | Separate files/types; `Suggestion.status` can't be `human_reviewed`; metrics read only decisions                                                                                                         |
| **Anchoring / circular evaluation**          | Blind step 1 shows neither resolver nor AI; **`blindVerdict` is the only primary label**; post-reveal revisions are diagnostics and can never replace it; reports show change rate and AI-agreement rate |
| Biased sampling                              | Frozen frame, seed, published N_h/n_h; resolver-status strata; family classifier independent of resolver; empty/unsampled cells and covered fraction reported; no backfill                               |
| Sampling design vs exact bounds              | Plain seeded SRS within cells, no per-source cap, dedupe before freezing; bound refused when assumptions fail; concentration reported                                                                    |
| Hard cases hiding in `insufficient_evidence` | Conditional + worst-case coverage/sensitivity views                                                                                                                                                      |
| Duplicate evidence                           | `evidenceClusterId` dedupe before frame freeze                                                                                                                                                           |
| Over-pruning real evidence                   | Different attributes of one document are kept; only identical evidence collapses                                                                                                                         |
| Missing source context                       | Excerpt + provenance mandatory; `insufficient_evidence` exits cleanly                                                                                                                                    |
| Inconsistent protocols                       | `protocolVersion` on every decision; mixed versions refused unless `--allow-mixed-protocol` (reported separately)                                                                                        |
| Wrong estimator                              | §F derivation + hand-computed tests; bound refused when assumptions fail                                                                                                                                 |
| Overstated confidence                        | Evidence labels, exact bounds, auto "required n" sentence                                                                                                                                                |
| Review fatigue / creeping queue              | `--limit 5` default, on-demand only, no weekly quota, audit first                                                                                                                                        |
| Contradictory specs                          | Spec amended in the same change as the plan                                                                                                                                                              |
| Accidental production change                 | New directories only; import-graph test extended; `AUTO_APPLY_TIERS` stays `[]`                                                                                                                          |
| Audit-seed contamination                     | D1: `verification_audit` never read                                                                                                                                                                      |

## I. Implementation order and gates

1. **S0** — replay + property suite. _Gate G0:_ read report; triage any `resolver_differs`.
2. **S1 + S2** — data model, protocol, **spec amendment + plan doc**, whole-frame replay, sampler (dry run). _Gate G1:_ D1–D5 answered; _G2:_ sampling report read, decide if a pilot frame is even worthwhile.
3. **S3 – S5** — suggestions, two-step review tooling, metrics (with the §F check).
4. **Five cards.** _Gate G3:_ are the cards clear, how long did each take, did blind and final differ, were AI suggestions useful? Choose: stop and fix tooling / expand a few high-risk strata / gather evidence for one language or family / larger evaluation / defer annotation. Default = the cheapest option the evidence supports.

Build tooling before asking for significant annotation.

## J. Explicitly deferred

Production integration of the resolver; any ingest/claims/consensus/catalog/gate/Second Reader/audit change; historical reinterpretation or migrations (`renormalize-claims.ts` remains a separate approved process); alias promotion; `normalizerApplier`; non-empty `AUTO_APPLY_TIERS`; DB collection `semantic_evaluation_runs` and DB-backed snapshots (3.3/3.4); an annotation UI (only if CSV proves too slow); the 2,160-example target (aspirational only); core-registry metadata in the snapshot hash (3.3).

## Unresolved architectural decisions

- **D1** May evaluation read `verification_audit` even read-only? Recommendation: **no**.
- **D2** Files vs DB for 3.2. Recommendation: files.
- **D3** May ≤300-char source excerpts be committed (size/copyright), with full frames kept out of git? Recommendation: yes.
- **D4** Family classifier source and handling of the `unknown`-language stratum. Recommendation: deterministic keyword classifier + reported `unknown` stratum.
- **D5** Amend Phase 3 spec §15–17 and the roadmap gate as listed in §C — **recommended and made part of the first documentation change**.
- **D6 (resolved in rev. 3):** _Blind verdict is the primary evaluation label. Post-reveal revisions are retained for diagnostic analysis only._

## What the maintainer personally does

1. ≈10–20 min: read the S0 replay report and triage any differences.
2. ≈15 min: read the one-page protocol and answer D1–D5 (D6 is resolved).
3. ≈10 min: read the sampling report.
4. ≈10–15 min: five blind+reveal cards.
5. Decide at G3 whether anything more is worth your time. Everything else is automated, and nothing recurs.

## Verification (when implemented)

`npm run green` before/after each stage (only new findings block); sampler re-run gives a bit-identical manifest; ID-collision test (same attribute twice in one text); import rejects blind CSV containing AI columns and mixed protocols; metrics checked against hand-computed cases (including the 24/0 → ≈11.7% bound and a recall example with R and W); import-graph test proves no production module imports the new code; docs-paths test passes with the new doc and the amended spec.
