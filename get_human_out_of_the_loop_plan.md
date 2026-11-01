# Getting the human out of the loop

**Status:** revised before implementation — Phase 0 and part of Phase 1 have landed, and §16 records what changed in this revision.
**Goal:** the system verifies, corrects, learns and promotes without a person in the approval path, while remaining legible enough to audit.
**Non-goal:** remove people from policy, appeals or catastrophic-risk decisions. The target is no human _bottleneck_, not no human _oversight_.

---

## 1. The actual problem

The human is not currently a UI bottleneck. The human is the **root of trust**.

`analystVerdicts` is the only reference in the system that is not a model's opinion, and it feeds six loops:

- `referenceSpecs` — what the heuristic is scored against (`src/shared/infra/evaluation/evaluation.ts`)
- `analystFixtures` — the live regression corpus
- `trustScores` — whether a generated rule may auto-activate (`src/shared/infra/evaluation/autonomy.ts`)
- `correctionTrust` — whether a deterministic correction may be applied (`src/shared/infra/ingest/auto-correct.ts`)
- `checkTrust` — the confidence bar for contradiction adjudication (`src/shared/infra/ingest/contradictions.ts`)
- the miner's sample — analyst-reviewed reports are always included (`src/shared/infra/evaluation/hypotheses.ts`)

If we simply delete the review queues, the system starts grading itself against its own previous output. **The replacement for the analyst is evidence, not another model's opinion.**

**Two caveats on "evidence", because the whole plan leans on the word.**

The deterministic checks do not test whether a claim is _true_. They test whether the extractor read the post correctly: the quote is really in the post, the figure is measured in the attribute's unit, it is inside the physical bounds, the sentence names this system. That catches misreading, mis-filing and unit slips — real, cheap and worth having — but a post that simply states a wrong figure passes all four. An AI entailment judge adds a _second reader of the same text_, not a second source. So neither is grounds to call a claim "verified" in the sense of "known true".

Two things therefore have to exist **before Phase 3 removes any human gate**, not in Phase 4 alongside the audit loop as originally planned:

- **A stratified human audit, as sampling rather than a queue.** A sample of `verified` claims, stratified by family and language, read by a person who is not working through an approvals list. This is the only measurement of _verified precision_ — of how often "verified" means "right". Without it, "95% of claims verified" measures how much text we could mechanically check, not how correct anything is.
- **A frozen human-verified seed set.** A small set of claims with human ground truth, never seen by any learner, reported next to every score for the life of the system. It is the anchor that a self-referential reference otherwise lacks, and it survives every change of model, prompt or rule set.

The same reasoning applies to coverage: a 95% precision number on 5% verified coverage is not evidence, and a "verified" label built only from internal-consistency checks is not precision. Every score in this plan is reported next to both the coverage it was measured over and the seed set it agrees with.

The second problem is the learning ceiling. `mineHypotheses` emits five rule kinds (`add_stopword`, `add_alias`, `add_cue`, `context_filter`, `add_unit_scale`). That learner will converge to the best rule set those kinds can express, then stop. Autonomy makes the plateau arrive faster and makes it visible; it does not widen the hypothesis space. That requires a second change: a failure classifier and a portfolio of learners.

---

## 2. What "out of the loop" means

- No approval queue for routine claims, rules, corrections or contradictions.
- A claim can reach consensus without `SpecClaim.review`.
- A generated rule can go live without `rule_decisions.actor = 'analyst'`.
- A deterministic correction can apply without an analyst review.
- A contradiction resolves from evidence, or stays `unresolved`; it does not wait for a person.
- Human attention is exception-driven: failed audits, appeals, policy, catastrophic-risk review.
- Every automatic action is recorded with before/after, evidence, checks, confidence and reversal path.

Human review remains available as an **override**, not a prerequisite.

---

## 3. Design principles

1. **Deterministic checks outrank opinion, but they are not evidence of truth.** A claim is mechanically checkable when the quote is in the source, the units are consistent and the system identity holds — not because a model or an analyst asserted it. What those checks establish is that the extractor read the post correctly, never that the post is right (§1).
2. **No self-judging.** The extractor cannot verify itself; the verifier cannot promote itself; the promoter cannot audit itself.
3. **Withhold, don't ask.** When evidence is insufficient, the claim becomes `uncertain`: stored, shown, and — from Phase 3 — not counted toward consensus. It enters an automatic verification queue, never a human one. In Phase 1 it is still counted (§4.1): the measurement comes before the withholding.
4. **Reversible beats approved.** Prefer canary + automatic rollback over a human gate.
5. **Heuristics own invariants; AI owns interpretation.** Units, bounds, dimensions, dates, name keys and evidence containment are deterministic. Semantic support, attribute choice and identity ambiguity are AI work. Neither alone can promote.
6. **Error budgets, not zero-error policy.** Zero errors always requires a human. Define acceptable error rates per risk tier and enforce them automatically.
7. **The judge, the holdout and the seed set are not proposers.** Nothing that learns may change the verifier, the frozen holdout or the human-verified seed set, and no learner is ever scored against data it was fitted on.
8. **No unbounded regex, no silent self-modification.** Rule proposals stay declarative. Code proposals are a separate, opt-in, sandboxed risk class.

---

## 4. Target architecture

### 4.1 Claim lifecycle

```
extraction (heuristic + AI)
  → verification
      → verified        counts toward consensus
      → uncertain       stored, shown, does not count
      → rejected        stored with reason, does not count
  → catalog / consensus
  → nightly self-audit
  → error signal
  → failure classifier
  → proposal → sandbox → holdout → shadow → canary → promote
  → monitor → rollback → learn
```

Every claim carries its verification record. Every action that changes a claim carries a ledger event.

**In Phase 1 the states are recorded but change nothing else.** `uncertain` and `rejected` are stored and shown; consensus still counts them, because `claimCounts` reads only `review`, `autoCorrection` and `adjudication`. The diagram above is the _target_, reached in Phase 3. Until then the UI must say so — that uncertainty is measured, not withheld — or an analyst will trust a number that has not changed.

### 4.2 Verification contract

New file: `src/shared/contracts/verification.ts`

```ts
export type VerificationVerdict = "pass" | "fail" | "uncertain";

export type VerificationKind =
  | "evidence_span"
  | "unit_dimension"
  | "bounds"
  | "identity"
  | "ai_entailment"
  | "cross_source"
  | "reference";

export interface VerificationCheck {
  id: string;
  kind: VerificationKind;
  verdict: VerificationVerdict;
  confidence?: number;
  detail?: string;
  evidence?: string;
  sourceId?: string;
  model?: string;
  verifierVersion: string;
  at: string;
}

export interface ClaimVerification {
  state: "verified" | "uncertain" | "rejected";
  checks: VerificationCheck[];
  confidence: number; // calibrated, 0..1
  coverage: number; // share of applicable checks that ran
  independentSources: number;
  challenger?: {
    verdict: VerificationVerdict;
    detail?: string;
    model?: string;
  };
  verifierVersion: string;
  at: string;
}
```

Add to `SpecClaim` in `src/entities/drone/types.ts`:

```ts
verification?: ClaimVerification;
```

Keep `review` as the analyst override. Keep `adjudication` and `autoCorrection`; they become inputs to verification, not parallel truths.

### 4.3 Verification pipeline

New folder: `src/shared/infra/verification/`

Order matters — cheap and deterministic first:

1. **Evidence span.** Locate the claim's `evidence`/`raw` in the dispatch text after whitespace folding. No span → fail. (The evidence brake already does a version of this.)
2. **Unit and dimension.** Canonical value, unit, dimension, currency scale, date consistency. A unit slip or impossible figure is a deterministic fail/fix.
3. **Bounds.** Physical and domain bounds per spec family.
4. **Identity**, as set out in §4.6. Use alias/name keys first; an AI judge only for ambiguous multi-system reports. The point is multi-system reports: in a post naming several systems, the drone's own name appears _somewhere_ almost by definition, so matching the whole post would pass trivially — exactly the misattribution the check exists to catch. Identity is anchored to the sentence carrying the evidence.
5. **AI entailment.** Ask a **different provider/model** from the extractor: "Does this text state this value for this attribute of this system? Answer supported / unsupported / uncertain, with the exact span." Do not show the extractor's rationale; that anchors the judge.
6. **Cross-source.** Independent outlets or official references. Weight by measured source precision and independence, not raw count. Reposts and syndication do not corroborate.
7. **Reference.** Wikipedia/Wikidata, manufacturer pages, official documents where available. High authority, but allow newer catalog evidence to disagree.
8. **Challenge.** On disagreement between checks, a second independent judge reviews both verdicts and the evidence. Still uncertain → `uncertain`, not a human ticket.

Cost control:

- Batch all claims from one article into one verification call.
- Deterministic checks first; only ambiguous or high-impact claims reach AI.
- Cheap model for the first pass, stronger model for disagreements.
- Cache by `(text hash, claim, verifier version)`.
- Nightly audit samples rather than re-verifying everything.

### 4.4 Verified reference

Replace `referenceSpecs`'s stored-extraction reference with a `verifiedReference` built from verified catalog claims:

- `verified` claims count as expected positives.
- `rejected` claims count as expected negatives.
- `uncertain` claims are excluded from scoring, not counted as misses.
- Analyst `review` still overrides when present.

This reference feeds:

- evaluation (`evaluateHeuristic`)
- regression fixtures (`analystFixtures` → `verifiedFixtures`)
- mining (`mineHypotheses`)
- shadow scoring (`shadowStep`)
- contradiction adjudication

Until coverage is high, mix references explicitly and report coverage next to every score. A 95% precision number on 5% verified coverage is not evidence.

### 4.5 Error budgets

Set 2026-11-01; calibrate with production data.

| Risk tier | Examples                                           | Error budget | Measured by                                                     | Gate                                                          |
| --------- | -------------------------------------------------- | ------------ | --------------------------------------------------------------- | ------------------------------------------------------------- |
| Low       | Unit scales, value normalizers                     | 5%           | Sampled audit (§9, Phase 2): upper 95% bound ≤ 5%               | Immediate; canary 1h                                          |
| Medium    | Cue rules, context reroutes, attribute moves       | 2%           | Escape rate from the ledger, once Phase 4 has a reversal record | 24h shadow; canary 24h                                        |
| High      | Aliases, stopwords, lexicon terms, identity merges | 0.5%         | Not measurable by sampling at this volume; the human gate stays | 48h shadow; full sandbox; two judges; canary 24h; auto-revert |

An action that exceeds its budget is rolled back and the category is paused. The human sees an exception, not a queue.

**An error, for the audit, is a reading error:** an audited `verified` claim whose post does not state that value for that attribute of that system. The auditor separately flags a figure the post does state but that is plainly wrong; that is reported, never counted against the budget, because no reader of the text could have caught it.

**Why only the low budget is measured by sampling.** Proving an error rate below a bound needs roughly `3 / bound` clean samples: about 60 for 5%, 150 for 2% and 600 for 0.5%, and more with any error found. At 70–200 new claims a day, a medium or high budget cannot be proven by a person reading a sample, so those tiers are measured from the reversals the ledger records, or keep their gate. Phase 3 removes gates for low risk only, which is the one budget a sample can establish.

**Why aliases and stopwords are high risk, not low.** The table originally put them in the lowest tier on the reasoning that a word is smaller than a number. The blast radius is the opposite. An alias decides _which system_ a passage is filed under, and the catalogue records the consequence in `src/entities/drone/alias-policy.ts`: the alias "interceptor drones" resolved a Defense Express post about Patriot onto **Bars**. Every claim in that post was then filed against the wrong system — and removing the alias afterwards does not file them back, because nothing records which claims arrived through it. A wrong unit scale stays on one claim and is undone by undoing the claim.

So an alias or stopword proposal needs the strongest gate, and its reversal path must include **re-filing the claims that arrived under it**, not just deleting the alias. Deleting an alias without re-filing leaves the catalogue quietly wrong in a way no later check will notice. Unit scales and normalizers move down to low: their effect stays local and reversing the correction reverses the claim.

### 4.6 Identity: the evidence sentence

The identity check asks "does the passage this figure came from name this system", never "does the post mention this system". The procedure, in order:

1. **Locate the sentence by containment**, never by character offsets: folding (NFKC, lowercasing, whitespace collapsing) changes string length, so an offset computed on the raw text points at the wrong place after folding. Find the sentence whose folded text contains the folded evidence quote. If the quote crosses a sentence boundary, try **pairs of adjacent sentences** — an evidence string may span "…range of" / "2,000 km." and belongs to both.
2. **Pass** only if that sentence (or pair) names this system by name, alias or phonetic key.
3. **Fail** if it names only another distinctive catalogued system, and this one is absent.
4. **Otherwise `uncertain`.** Not `pass`.

The fallback was originally "the post names only one catalogued system → pass". That is unsound: a post about Shahed can carry a sentence about a jammer without naming it, and a single-system post can still contain a claim that is not about that system. So the single-system case is recorded as `uncertain` with a lower confidence, and the claim does not count as verified.

`sentenceOf` is deterministic and needs no model. Only a report that names several systems _and_ whose sentence is ambiguous reaches the AI judge of §4.3 step 5.

**Matching is shared, not re-implemented.** The verifier must use the same strict matcher the extractor already applies (`mentionsName`: exact token boundaries so "Geran-2" never matches "Geran-5", plus the phonetic key for `Ланцет-3`/`Lancet-3`). Two definitions of identity would let the verifier pass a claim the extractor would never file, or reject one it did. That matcher belongs in `src/entities/drone/name-key.ts`, next to `mentionsPhonetic`, with `src/shared/infra/heuristics/names.ts` re-exporting it rather than keeping its own copy — a lower layer may not import `shared/infra`, so the direction has to be entities → re-export, not the reverse. Today `names.ts` holds the only copy, and the verifier re-implements it lossily, so this is a change to both files, not a move of an existing shared helper.

**Performance.** Identity runs once per claim _per catalogued drone per name_, and a backfill multiplies that out, so the regex must be compiled once per name rather than per call. `names.ts` gets that today from `getRe`; when the matcher moves down, give `name-key.ts` its own small compiled-pattern `Map` rather than importing `shared/infra/heuristics/regex-cache`, which would break the same layer direction the move exists to respect.

**Expect the verified share to drop when this lands.** Most quoted fragments do not name a system, so making the fallback `uncertain` will lower measured "verified" coverage, possibly a lot. That number is the honest one. Record before/after coverage in the same change and report it as a correction, so the drop is not later mistaken for a regression.

---

## 5. Beyond the DSL plateau

### 5.1 Failure classifier

Replace "every error is a rule" with a classifier that names the **kind of fix**:

```
verified error
  → failure classifier (heuristics + AI)
      lexical gap          → rule
      unit/format gap      → normalizer
      attribute ambiguity  → context rule / prompt
      missing concept      → schema / taxonomy
      language/domain gap  → model route / retrieval
      parser defect        → code patch (opt-in)
```

This is the escape hatch. `mineHypotheses` already counts `differentReading` as a parser defect for a human; that count becomes a proposal stream instead.

### 5.2 Proposal model

New contract: `src/shared/contracts/proposals.ts`

```ts
export type ProposalKind =
  "rule" | "normalizer" | "prompt" | "schema" | "model_route" | "code_patch";

export type RiskTier = "low" | "medium" | "high";

export interface Proposal {
  id: string;
  kind: ProposalKind;
  risk: RiskTier;
  target: string;
  payload: Record<string, unknown>;
  rationale: string;
  evidence: { candidateId: string; source: string; span: string }[];
  proposedBy: "heuristic" | "ai" | "audit" | "analyst";
  createdAt: string;
}
```

`apply` is a registry (`PROPOSAL_APPLIERS[kind]`), not a serialized function. A proposal is data; the applier knows how to apply that kind. This keeps proposals auditable and prevents an AI from smuggling arbitrary code through a payload.

### 5.3 The learning ladder

| Layer                                            | Learns                                                                    | Ceiling                                | Risk        |
| ------------------------------------------------ | ------------------------------------------------------------------------- | -------------------------------------- | ----------- |
| 0. Deterministic normalization                   | Units, bounds, currency, dates                                            | Long tail of formats                   | Low         |
| 1. Lexical/context DSL                           | Words, aliases, cues, reroutes, unit scales                               | Cannot express thresholds or structure | Low         |
| 2. Richer declarative DSL                        | Numeric guards, bounded sequences, exclusion contexts, conditional scales | Fixed grammar                          | Low–medium  |
| 3. Prompt / retrieval / few-shot                 | Which instructions and examples produce better extraction                 | Model-dependent                        | Medium      |
| 4. Schema / taxonomy induction                   | New spec keys, mappings, system classes                                   | Key sprawl without governance          | Medium      |
| 5. Model routing / fine-tuning / distillation    | Per-language, per-source, per-domain accuracy                             | Data- and cost-bound                   | Medium–high |
| 6. Code generation for parser/normalizer defects | New parsing logic, new structures                                         | Highest capability, highest risk       | High        |

The current system is at 0–1. The autonomy work doesn't jump to 2 by itself, but it provides the verified reference and ledger needed to evaluate any layer with the same rigor.

### 5.4 Learning controller

- Track marginal gain per proposal kind per week: acceptance rate, ΔF1, escape rate, cost per verified gain.
- If rule yield falls below a threshold for N days, stop mining rules and trigger the next layer.
- Allocate verification and mining budget like a portfolio, not a fixed schedule.
- Record plateau events in the ledger so the switch is visible.

This is the meta-learning loop: notice the current learner has stopped paying, and change the kind of hypothesis.

### 5.5 Holdout and metamorphic tests

- A frozen holdout corpus that no learner ever sees.
- Metamorphic tests:
  - Change a unit expression → normalized value must not change.
  - Remove the supporting sentence → the claim must disappear.
  - Paraphrase the sentence → the same claim should survive.
  - Add a distractor system name → identity must not move.
- Per-family and per-language deltas, not only global F1.
- A proposal that only improves the training corpus and not the holdout is rejected.

---

## 6. Clarity: the decision ledger

"Clear what is happening" means: for every number, you can see what changed it, why, and whether it was reversed.

### 6.1 Ledger

New migration: `migrations/018_autonomy_events.sql` (idempotent, like the rest).

**The migration is additive and uncommitted, so edit it in place** rather than adding `019` — define the columns now, before any production row depends on the absence of one. It is currently staged (`A`); restage after editing so the index does not keep the old copy. The shape below is the target; the landed table carries only `kind`/`subject`/`category`/`actor`/`verdict`/`detail`/`created_at` and must gain the rest before writers exist.

```sql
create table if not exists autonomy_events (
  id text primary key,
  at timestamptz not null default now(),
  actor text not null,
  actor_kind text not null check (actor_kind in
    ('heuristic','ai','verifier','rule','audit','analyst','system')),
  action text not null,
  target_collection text not null,
  target_id text not null,
  before jsonb,
  after jsonb,
  reason text,
  checks jsonb,
  confidence double precision,
  reversible boolean not null default true,
  reversed_by text references autonomy_events(id),
  correlation_id text
);

create index if not exists autonomy_events_at_idx on autonomy_events (at desc);
create index if not exists autonomy_events_target_idx on autonomy_events (target_collection, target_id);
create index if not exists autonomy_events_correlation_idx on autonomy_events (correlation_id);
```

Every automatic action writes one event: claim verified/rejected, correction applied/reverted, rule promoted/quarantined, schema added, model route changed, audit failed.

**Two rules on what the ledger holds.**

_Decisions are kept forever; heartbeats are pruned._ A `verification_run` event says "the loop ran at 04:15 and checked 300 claims" — useful for a week, worthless in a year. A `correction_applied` or `rule_promoted` event is the record that a claim changed and why, and `reversed_by` is a foreign key into that history: pruning it would break the reversal chain and destroy exactly the audit the ledger exists for. Prune only the heartbeat kinds, by an explicit allow-list, never by age across the whole table.

_Add an event kind in the same change as its writer._ The contract currently lists kinds nothing writes (`verification_rejected`, `verification_confirmed`, `correction_applied`, `correction_rolled_back`). A type that promises an event the system never emits makes the ledger look more complete than it is, and the reader cannot tell "nothing was rejected" from "no one wrote the event". Each kind is added back by the change that starts emitting it.

### 6.2 `/autonomy` page

New route under Engine in `src/shared/ui/nav-pages.ts`, feature slice `src/features/autonomy/`.

- **What changed (24h):** claims added, corrected, moved, rejected, reverted; rules promoted/quarantined; corrections applied/rolled back. Each row links to the source and dossier.
- **Loop health:** ingest → extract → verify → learn → shadow → promote → audit, with counts, coverage, failure rate, rollback rate.
- **Exceptions, not approvals:** failed re-verifications, rollbacks, coverage drops, source-quality regressions.
- **Error budget:** per category, current rate vs budget.
- **Decision ledger:** filter by actor, action, target, date, correlation id; open before/after and checks.

### 6.3 Per-claim clarity

On the dossier and provenance sheet:

- `verified by 4 checks · 2 independent sources · challenger agrees`
- `uncertain: evidence span missing`
- `auto-corrected from 12 km`
- `reverted by audit at 06:00`
- **Explain** opens the verification record, not just the source text.

### 6.4 Daily digest

Generated from the ledger, not free-form AI:

> Rule `add_cue:range` went live at 04:15, changed 14 claims in 9 systems; 2 were reverted at 06:00 because the evidence span was missing.

The AI writes prose; the ledger supplies facts and links.

### 6.5 Alerts

- Rollback rate above budget.
- Verification coverage drop.
- Promotion spike.
- Source-quality regression.
- Model/provider drift.
- Audit failure cluster.

---

## 7. Policy changes

### 7.1 Rule promotion

`PROMOTION_POLICY` in `src/shared/infra/evaluation/autonomy.ts`:

| Dimension        | Current                                 | New                                                        |
| ---------------- | --------------------------------------- | ---------------------------------------------------------- |
| Human trust      | 20 analyst decisions, 95%               | removed for low risk; kept for medium/high                 |
| Verified support | none                                    | ≥ N independent verified reports                           |
| Coverage         | none                                    | ≥ 80% of scored claims verified                            |
| Holdout          | none                                    | no regression, and no disagreement with the seed set       |
| Shadow           | 48h, 5 hits, 0 conflicts, 95% precision | risk-tiered: 24h medium, 48h high; low may skip shadow     |
| Canary           | none                                    | 24h / limited exposure, auto-revert                        |
| Daily cap        | 2/day                                   | keep                                                       |
| Conflict rule    | 0 conflicts                             | keep for all tiers; no measured-rate tolerance for aliases |

`activateLocked` currently calls `sandboxRule(id, "fast")`. Change activation to **full sandbox** for medium/high risk, and always for autonomous promotion. The 2/day cap bounds the cost. Aliases are high risk (§4.5), so they never take the fast path.

### 7.2 Auto-correction

- Deterministic unit slips and impossible figures apply when the kind of correction has earned it, and never to a claim an analyst has confirmed. **Keep `earned-trust.ts`; do not replace it with immediate application.** It already does what this section originally proposed to invent — apply per kind while analysts agree, recompute every run, and un-apply everywhere when agreement falls — and its rollback is the reason a bad corrector cannot persist. What changes is the evidence behind the tally: `correctionTrust` reads verification outcomes as well as analyst verdicts, so a kind can earn trust from machine-checked cases. Analyst verdicts stay the heavier signal and continue to override.
- Attribute moves apply when heuristic cue and AI verifier agree; record `movedFrom` and make it reversible.
- Name/alias changes apply after cross-source verification; reversible, **and their reversal re-files the claims that arrived through them** (§4.5).
- Any correction later contradicted by stronger evidence is un-applied automatically.
- `correctionTrust` becomes evidence-backed earned trust: the same mechanism, a wider evidence base. It is not replaced by a single confidence threshold.

### 7.3 Contradictions

- `checkTrust` becomes `sourceQuality` + evidence entailment.
- **State the limit plainly: entailment cannot arbitrate most contradictions.** When a spec sheet says 2,000 km and an interview says 1,200 km, both claims are faithful to their own source. Entailment confirms that each post said what it said; it does not say which is right, and source quality only ranks outlets. So the expected outcome for a genuine conflict is `unresolved`, surfaced through the existing `consensus.disputed` flag — not a machine pick.
- The judge picks the better-supported claim only when it has grounds: one side's span is missing, its units are wrong, or its identity does not hold. Otherwise it leaves the spec `unresolved`.
- An unresolved spec stays visible; it does not wait for a person.
- Analyst review remains an override and a high-weight signal.

### 7.4 Evaluation and mining

- `analystVerdicts` remains supported but is no longer required.
- `referenceSpecs` → `verifiedReference`.
- `analystFixtures` → `verifiedFixtures` (with analyst fixtures still layered in when present).
- `mineHypotheses` reads verified failures, not stored extraction.
- `shadowStep` scores against verified reference; uncertain claims are excluded, not counted as misses.

---

## 8. Repo change map

| Area           | Files                                                                              | Change                                                              |
| -------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Types          | `src/entities/drone/types.ts`                                                      | Add `SpecClaim.verification`                                        |
| Contracts      | `src/shared/contracts/verification.ts`, `proposals.ts`                             | New verification and proposal contracts                             |
| Verification   | `src/shared/infra/verification/*`                                                  | Deterministic checks, AI judge, ensemble, source quality, reference |
| Evaluation     | `src/shared/infra/evaluation/evaluation.ts`                                        | `verifiedReference`, coverage-aware scoring                         |
| Autonomy       | `src/shared/infra/evaluation/autonomy.ts`                                          | Replace human trust with evidence policy                            |
| Sandbox        | `src/shared/infra/evaluation/sandbox.ts`                                           | `sandboxProposal`, per-family deltas                                |
| Rule server    | `src/shared/infra/evaluation/rule-sandbox.server.ts`                               | Full sandbox on activation, evidence promotion                      |
| Mining         | `src/shared/infra/evaluation/hypotheses.ts`                                        | Failure classifier + proposal kinds                                 |
| Corrections    | `src/shared/infra/ingest/auto-correct.ts`                                          | Evidence trust, immediate deterministic fixes                       |
| Contradictions | `src/shared/infra/ingest/contradictions.ts`                                        | Evidence/source-quality bar                                         |
| Trust          | `src/shared/infra/ingest/earned-trust.ts`                                          | Verification outcomes instead of analyst tallies                    |
| Ledger         | `migrations/018_autonomy_events.sql`, `src/shared/infra/autonomy/ledger.server.ts` | New event log                                                       |
| UI             | `src/features/autonomy/*`, `src/routes/autonomy.tsx`                               | New page                                                            |
| UI             | `src/features/evaluation/*`                                                        | Queues become audit/exception views                                 |
| UI             | `src/features/dossier/provenance-sheet.tsx`                                        | Per-claim verification badges and Explain                           |
| Nav            | `src/shared/ui/nav-pages.ts`                                                       | Add Autonomy under Engine                                           |
| Docs           | `AGENTS.md`, `docs/current-state.md`, `docs/roadmap.md`                            | Update after each phase                                             |

Keep `src/shared/infra/services.tsx` as the only composition root. Wire verification there; features depend on contracts.

---

## 9. Phased delivery

### Phase 0 — Foundations, no behaviour change

- Add verification/proposal contracts and types.
- Add `autonomy_events` migration and ledger writer.
- Build `/autonomy` read-only from existing `task_runs`, `rule_decisions` and the new ledger.
- Add per-claim verification placeholder badges (`unverified`).
- Update docs.

**Exit:** `tsc`, lint, tests green; ledger records a manual test event; `/autonomy` renders existing logs.

### Phase 1 — Deterministic verification

- Evidence span, unit/dimension, bounds, identity checks (§4.6: sentence-anchored, containment-based, single-system fallback = `uncertain`).
- Claim states `verified` / `uncertain` / `rejected`; backfill existing claims.
- Show badges and Explain on the dossier.
- Keep all current human gates; this phase only measures.
- **Record before/after "verified" coverage** when the identity fallback lands, so the expected drop is on the record as a correction rather than read later as a regression.

**Exit:** ≥80% of new claims have at least deterministic verification; coverage visible; no loss of existing behaviour.

### Phase 2 — Independent AI verifier, verified reference, and the audit that makes it trustworthy

- Batched AI entailment with a different provider/model.
- Challenger on disagreement.
- `verifiedReference` wired into evaluation, mining and shadow.
- Report reference coverage next to every F1/precision number.
- **Stratified human audit of `verified` claims** (sampling, not a queue) — the measurement of verified precision (§1).
- **Frozen human-verified seed set**, reported next to every score from here on.
- Human review still available; no gate removed yet.

**Exit:** the reference covers the share of scored claims measured in Phase 1 (the ≥70% figure is provisional until Phase 1 reports real coverage); **audited verified precision is at or above the low-risk error budget**; evaluation is stable or better on holdout and on the seed set; no regression on the existing corpus.

Phase 2 does not close until the audit exists. A verified reference with no measured precision is the confidence loop §1 warns about, and Phase 3 is not allowed to build on it.

**Build order.** (1) Deterministic verification runs on the server against the whole archive — the browser holds only the newest 3,000 posts, which left 565 claims "not in the archive" whose post was there. (2) Seed set and audit sampler. (3) AI verifier, measured against the seed set before it may make a claim `verified`. (4) Challenger. (5) `verifiedReference` in evaluation, with coverage and seed-set agreement next to every score. (6) The audit runs to its stopping rule.

**Step 3, as built.** The second reader runs hourly on the claims the deterministic checks leave uncertain and on every audited claim, one call per post, at a model that extracted none of that post's claims (`VERIFIER_PROVIDERS`, nemotron-super first). It is shown the post and the bare claims, never the extractor's quote, and must answer with a passage the post contains or the answer is `uncertain`. Its verdict is stored as `SpecClaim.entailment` and read by nothing but the measurement on the Audit page: its "supported" against the person's answers, with the same upper bound as the audit. It gains a vote only through a later change, once that bound is within the low-risk budget over at least 100 answered claims.

**Why a person, and what the person is for.** Not because a person reads better than a model — not assumed, and checked: every batch carries hidden controls (claims the deterministic checks already proved misread), and a batch whose auditor passes a control is not counted. The person is there because their errors are independent of the extractor's and the verifier's: two models that share a blind spot agree, and are both wrong. That independence is weakest where the auditor reads through machine translation, so audits record whether the post was read in the original or translated, and a translated audit is reported as such.

**The question the auditor answers** is one, fixed: _does the post state this value for this attribute of this system?_ — yes / no / cannot tell, plus an optional "the post says it, but it is plainly wrong" flag (§4.5).

**Audit protocol — sequential, so a clear result costs little.** Verified claims are drawn at random with a recorded seed, English first, then Ukrainian, then Russian, spread across attribute families. The first draw is 100 (50 cannot pass: even zero errors leaves the bound at 5.8%), then batches of 50, each followed by a stopping rule computed exactly from the binomial tail, one-sided at 95%, against the 5% budget:

| Answered | Pass       | Fail (proven worse than 5%) | Otherwise        |
| -------- | ---------- | --------------------------- | ---------------- |
| 100      | ≤ 1 error  | ≥ 10 errors                 | draw 50 more     |
| 150      | ≤ 2 errors | ≥ 13 errors                 | draw 50 more     |
| 200      | ≤ 4 errors | ≥ 16 errors                 | stop: not proven |

"Cannot tell" answers are not errors and not passes; they are excluded and reported. A family with ≥ 2 errors in its first 20 is flagged on its own, whatever the overall result. The auditor may ask for another batch at any time for a tighter number.

**Seed set.** 150 claims, frozen once: the first 100 audited verified claims, plus 25 `rejected` and 25 `uncertain` drawn the same way — without negatives a verifier that says "verified" too easily would agree with it perfectly. It is stored apart from `SpecClaim.review` (`verification_audit`, migration 019), because every learning loop reads the analyst's review; nothing that learns may read the seed set. A first session is about 150 claims at 30–45 s each with the quote highlighted: about 1.5 hours, more only when the result is borderline.

**After Phase 2:** 15 verified claims a week under the same rule, so drift — a new source, a model change — is measured rather than assumed. A skipped week leaves the week unmeasured; nothing waits on it.

### Phase 3 — Remove human gates for **low** risk only

- Replace `minDecisions`/`minTrust` with evidence policy, for low-risk categories.
- Full sandbox on activation.
- Auto-apply deterministic corrections where the kind has earned trust (§7.2).
- Canary and auto-revert.
- Review queues become audit queues; no routine approvals.
- Medium and high risk keep their gates until Phase 4.

**Exit:** a generated **low-risk** rule can go live with zero analyst decisions; corrections apply without review; escape rate within budget for 30 days.

### Phase 4 — Self-audit, delayed labels, medium and high risk

- Nightly stratified re-verification; downgrade and revert on failure.
- Delayed labels from procurement, Wikipedia/Wikidata, official sources and later reports.
- Error budgets enforced per category.
- Medium-risk gates removed after a clean window; high-risk gates (aliases, stopwords) last.

**Exit:** 95% of automatic actions audited within 24h; escape rate within high-risk budget; rollback works end-to-end; a reverted alias re-files the claims it carried.

### Phase 5 — Learning portfolio

- Failure classifier.
- Proposal kinds: normalizer, prompt, schema, model route.
- Learning controller and plateau detector.
- Layer 2 DSL expansion (numeric guards, bounded sequences, exclusion contexts).
- Layer 3 prompt/retrieval optimization.

**Exit:** at least two non-rule proposal kinds produce a measured holdout gain; plateau detector fires and switches learners.

### Phase 6 — Optional higher layers

- Schema/taxonomy induction (layer 4).
- Model routing / distillation (layer 5).
- Code patch proposals (layer 6), opt-in only:
  - pure functions in a restricted module
  - no network/filesystem/imports
  - static checks
  - metamorphic + unit tests
  - sandbox, canary, auto-revert

Do not enable layer 6 until the verifier, holdout and audit loop have a long clean record.

---

## 10. Test strategy

- Unit tests for every deterministic check (span, units, bounds, identity).
- Contract tests for `ClaimVerification` and `Proposal`.
- Fixture tests: verified corpus + frozen holdout + negative corpus.
- Metamorphic tests for units, paraphrases, distractors and sentence removal.
- Evaluation tests: uncertain claims excluded; coverage reported; no silent drop.
- Promotion tests: evidence-only path, full sandbox, canary, rollback.
- Ledger tests: every automatic action writes one event; reversal links both ways.
- Migration tests: idempotent `018`.
- UI tests: `/autonomy` renders exceptions and diffs; per-claim Explain opens checks.
- Existing `npm run green` must stay green at every phase.

---

## 11. Metrics and exit criteria

Track from day one:

- **Verification coverage:** share of claims with deterministic + AI checks.
- **Verified precision:** sampled audit of `verified` claims.
- **Escape rate:** verified claims later reverted / verified claims.
- **Time to detect / time to revert.**
- **Human exception rate:** human actions per 1,000 claims (target: near zero, exceptions only).
- **Proposal yield:** accepted proposals / proposed, by kind.
- **Plateau signal:** rule yield and ΔF1 trend; trigger threshold.
- **Cost per verified claim.**
- **Review queue depth:** should contain exceptions, not routine work.

Overall success: routine ingestion produces zero human approvals, automatic actions stay within their error budgets, and every change is explainable from the ledger.

---

## 12. Risks and mitigations

| Risk                           | Mitigation                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| Self-confirmation              | Different extractor/verifier providers; deterministic checks; frozen holdout; challenger |
| Model collusion or shared bias | Independent prompts/providers; no shared rationale; adjudication on evidence             |
| Goodharting                    | Per-family/language/source metrics; holdout; metamorphic tests; random audits            |
| Data poisoning                 | Source independence graph; evidence containment; source quality; anomaly detection       |
| Cost blow-up                   | Deterministic first; batching; caching; cheap first pass; sample audits                  |
| Runaway automation             | Error budgets; canary; daily caps; category pause; kill switch                           |
| Silent code risk               | Defer code proposals; pure functions; static checks; tests; canary                       |
| Ledger noise                   | One event per meaningful action; stable IDs; filters; daily digest                       |
| Backfill problems              | Additive fields; missing verification = `unverified`, never `verified`                   |
| CloudStore revision gap        | Do not claim conflict safety in Cloud mode; fix separately or document                   |

---

## 13. What not to do

- Do not delete `review`; it becomes the override.
- Do not let the extractor verify itself, even with a different prompt.
- Do not let the learner change the verifier or the holdout.
- Do not add unbounded regex to the DSL.
- Do not auto-delete claims or systems; use soft-delete, canary and revert.
- Do not treat uncertain claims as misses or as truth.
- Do not remove high-risk gates before the audit loop has a clean record.
- Do not ship a dashboard that shows job status without decision status.

---

## 14. Open questions

Two questions this list used to carry are **closed by the code as it stands**, and are recorded here so they are not reopened:

- ~~Deployment topology: single container or multiple instances?~~ **Multiple.** `withActivationLock` in `src/shared/infra/evaluation/rule-sandbox.server.ts` takes a `pg_advisory_lock` specifically so two processes do not sandbox at once, and `task_runs` exists to serialise scheduled work. Shadow and mining therefore need the same treatment, not a new decision.
- ~~Does an analyst override remain the highest authority, even over verification?~~ **Yes.** `claimCounts` in `src/entities/drone/claim-review.ts` already returns the analyst's verdict first, in both directions, before `autoCorrection` or `adjudication`. `verification` is recorded and never overrules it.

Decided by the project owner, 2026-11-01:

- ~~Cost ceiling per day for verification and judges.~~ **0.5M output tokens and 5M input tokens a day**, enforced in code with a daily counter that stops the verifier and records the stop. Measured volume (20–45 posts a day, ~1.5k input and ~300 output tokens per post in one call) uses a few percent of it; a reasoning model's thinking counts as output and can use it about five times faster.
- ~~Which languages are highest priority for the first audit?~~ **English, then Ukrainian, then Russian.**
- ~~What error budget is acceptable per category?~~ **5% / 2% / 0.5%** for low / medium / high, with how each is measured (§4.5).
- ~~How large must the audit sample be, and who samples?~~ **Sequential batches of 50 to a stopping rule** (§9, Phase 2): 100 claims settle a good verifier, 200 at most. The system draws the sample with a recorded seed; the project owner audits.

Still open:

1. Are code-patch proposals in scope at all, or deferred indefinitely?
2. Should uncertain claims appear in consensus as `unconfirmed`, or stay entirely out?

---

## 15. First slice

Build Phase 0 + Phase 1 together:

- `ClaimVerification` contract and `SpecClaim.verification`.
- Deterministic verifier: evidence span, units, bounds, identity.
- `autonomy_events` migration and ledger writer.
- `/autonomy` page with existing logs + new verification coverage.
- Per-claim badges and Explain on the dossier.
- Backfill and coverage report.
- No gate removed yet.

That gives the system a machine-verifiable reference and makes the loop legible before any autonomy is switched on. Phase 2 then replaces the human reference; Phase 3 removes the gates.

---

## 16. Revision log

This revision was written before Phase 2 started, after Phase 0 and part of Phase 1 had landed, and changes the plan's sequencing rather than only its wording.

| #   | Change                                                                                                                                                                                  | Why                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | §1 and §3: deterministic checks establish that the extractor read the post correctly, not that the post is right; "verified" is not "true"                                              | The plan equated mechanical checkability with evidence of truth, then planned to build a reference on it                                     |
| 2   | Stratified human audit and frozen seed set moved from Phase 4 to **Phase 2**, as a gate on Phase 3                                                                                      | Verified precision had no measurement anywhere before the human reference was replaced and gates removed                                     |
| 3   | §4.5: aliases and stopwords moved **low → high** risk; unit scales moved **high → low**                                                                                                 | A wrong alias files claims under the wrong system and removal does not re-file them; a wrong unit scale is local and reversible              |
| 4   | §4.5/§7.2: reversing an alias must **re-file the claims that arrived through it**                                                                                                       | Deleting an alias alone leaves the catalogue quietly wrong with no record of which claims it carried                                         |
| 5   | New §4.6: identity is anchored to the **evidence sentence** by containment (never offsets), with adjacent-sentence pairs, and the single-system fallback is **`uncertain`, not `pass`** | Offset arithmetic breaks under folding; matching the whole post passes trivially in multi-system reports, which is the case the check is for |
| 6   | The strict name matcher moves to `src/entities/drone/name-key.ts` with a compiled-pattern cache, re-exported by `shared/infra/heuristics/names.ts`                                      | A lower layer may not import `shared/infra`; two definitions of identity would drift; identity runs per claim × drone × name                 |
| 7   | §7.2: **keep `earned-trust.ts`**, widen its evidence to verification outcomes; drop "apply immediately"                                                                                 | The mechanism already exists, already auto-rolls-back, and the proposal would have replaced it with a weaker one                             |
| 8   | §7.3: contradictions usually stay `unresolved` and surface through `consensus.disputed`; the judge picks only on broken evidence                                                        | Both sides of a real conflict are faithful to their own source, so entailment cannot arbitrate                                               |
| 9   | §6.1: decision events are kept forever, only heartbeat events pruned; event kinds are added with their writers; `018` edited in place and restaged                                      | `reversed_by` is a foreign key into history; unused event kinds make the ledger look more complete than it is                                |
| 10  | §9: Phase 3 removes gates for **low risk only**; Phase 2's coverage target is set from Phase 1's measured coverage; Phase 1 records before/after coverage                               | The ≥70% figure was invented before any measurement, and the identity fix will lower the verified share by design                            |
| 11  | §14: deployment topology and analyst-override authority **closed** by `withActivationLock`/`task_runs` and `claimCounts`; audit sample size added                                       | They were answered by code already in the tree                                                                                               |
| 12  | §4.1: Phase 1 records states without changing consensus, and the UI must say so                                                                                                         | The diagram shows the Phase 3 target; presenting it as current would let an analyst trust a number that has not changed                      |
| 13  | §4.5: budgets set to 5% / 2% / 0.5%, each with how it is measured; only the low budget by sampling                                                                                      | Proving a bound needs about `3 / bound` clean samples; 0.5% would need ~600 audits                                                           |
| 14  | §9 Phase 2: build order, sequential audit with a stopping rule, hidden controls, translated audits labelled, 150-claim seed set in its own table; §14 four questions closed             | A fixed 200-claim audit spends hours a good verifier does not need; a seed set kept in `SpecClaim.review` would be read by every learner     |
| 15  | §9 Phase 2: deterministic verification moves to the server                                                                                                                              | The browser holds the newest 3,000 posts; run there, 565 claims were judged "not in the archive" while their post was                        |
