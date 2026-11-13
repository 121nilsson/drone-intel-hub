# Current state

Last reviewed: October 2026. This document describes what is **built and wired** in the repository
today. For planned work see [roadmap.md](./roadmap.md). For operator setup see [../README.md](../README.md).

---

## App surface

| Page           | Route           | Feature slice                 |
| -------------- | --------------- | ----------------------------- |
| Briefing       | `/`             | `src/features/briefing/`      |
| Catalog        | `/catalog`      | `src/features/catalog/`       |
| System dossier | `/systems/$id`  | `src/features/dossier/`       |
| Counterparts   | `/counterparts` | `src/features/counterparts/`  |
| Spectrum       | `/spectrum`     | `src/features/spectrum/`      |
| Evaluation     | `/evaluation`   | `src/features/evaluation/`    |
| Queue          | `/intake`       | `src/features/intake/`        |
| Feed           | `/dispatches`   | `src/features/dispatches/`    |
| Sources        | `/sources`      | `src/features/sources/`       |
| Spec Engine    | `/specs`        | `src/features/dynamic-specs/` |
| Taxonomy       | `/taxonomy`     | `src/features/taxonomy/`      |
| Settings       | `/settings`     | `src/features/settings/`      |

Shell navigation and ⌘K search live in `src/shared/ui/app-shell.tsx`.

---

## Data and storage

- **Contract:** `DocumentStore` in `src/shared/contracts/store.ts`.
- **Collections:** `drones`, `candidates`, `sources`, `dispatches`, `procurements`, `taxonomies`,
  `taxonomy_candidates`.
- **Selection** (`src/shared/infra/storage/store.functions.ts`): `DATABASE_URL` → PostgreSQL
  (`src/shared/infra/postgres/postgres-store.server.ts`); else Lovable Cloud service role when
  configured; browser uses `LocalStorageStore` or `RemoteStore` (server functions) when Postgres is
  available.
- **Repositories:** write-through caches in `src/shared/infra/storage/local-repository.ts` — synchronous
  reads for the UI, async `put`/`remove` to the backing store.
- **Revisions:** a write carries the revision the cache last read. A stale whole-document write is
  refused, the cache reloads and the caller's replay is reapplied; a cache that cannot reapply keeps
  the stored copy rather than the unsaved edit. The revision lives in the store, never in
  `updatedAt` (`migrations/016_document_rev.sql`).
- **Failures are visible:** a rejected put/remove, a dropped conflict and a failed attach are reported
  to the shell (a banner, and a blocking storage error offering browser storage as an explicit
  choice). The composition root never falls back from server storage to localStorage on its own.

`procurements` is persisted and financial specs are split out of the drone specs at the pipeline
boundary and written to the collection (`src/shared/infra/ingest/pipeline-run.ts`). The LLM extractor
(`src/shared/infra/procurement-extractor.ts`, behind the `ProcurementExtractor` contract) runs in the
pipeline when a provider is configured, the server-side sync supplies the `procurements` repository
(`fetch-posts.server.ts`), and the Procurement page (`src/features/procurement`) shows the records.

---

## Ingest — stage 1 (collection)

Implemented in `src/shared/infra/sources/fetch-posts.server.ts`, `fetch-posts.ts`, and
`src/shared/infra/ingest/collect.ts` (`collectSource`; `auto-ingest.ts` is a barrel over the stage modules).

- Bounded parallel fetches with per-host pooling and `FETCH_TIMEOUT_MS`. A fetch that times out,
  hits a network error, or gets a 429 or 5xx is retried once after 500 ms; another 4xx is not.
- **Fetch history:** every fetch of a source writes a row to `source_fetch_log`
  (`migrations/024_source_fetch_log.sql`, `src/shared/infra/sources/fetch-log.server.ts`), kept 90
  days and pruned once per sync. `yieldDrift` (`src/entities/source/health.ts`) reads a source's own
  history: `failing` after five failed fetches in a row, `quiet` when ten successful fetches
  returned nothing from a source that used to yield. The row's relevant count is always 0, because
  relevance is counted per batch in stage 2, not per source.
- **Web / RSS bodies:** Mozilla Readability via `src/shared/infra/article.server.ts` (server-only;
  `linkedom` + `@mozilla/readability`). Index pages follow top links; RSS teasers can be expanded.
  Disable with `FETCH_ARTICLE_BODIES=0`.
- **Telegram:** public `t.me/s/<handle>` preview (~20 latest posts).
- **X:** optional `X_BRIDGE_BASE` RSS bridge; otherwise sources error with a clear message.
- **Near-duplicate suppression:** 64-bit SimHash (`src/entities/dispatch/simhash.ts`); duplicates
  stored as `duplicate` stubs pointing at the canonical dispatch.
- **Event clustering:** URL-based grouping after processing (`src/entities/dispatch/events.ts`).
- **Relevance (before AI):** `DRONE_HINT` regex or dynamic catalog name/alias pattern
  (`buildCatalogPattern`); non-matching posts → `irrelevant`.

---

## Ingest — stage 2 (processing)

Same pipeline as manual Queue paste: `runTwoTier` in `src/shared/infra/ingest/pipeline-run.ts`.

1. Heuristic extractor (`src/shared/infra/heuristic-ai.ts`) when `heuristicFirst` is on.
2. Tier 1 / tier 2 OpenAI-compatible models when configured (`openai-compatible-ai.ts`), with
   escalation gates (`src/entities/drone/extraction-gates.ts`).
3. Provider outage → heuristic fallback for interactive paste; queue processor can defer
   (`deferOnOutage`) so posts stay `pending`.
4. Outcomes: auto-merge, auto-promote, auto-discard, or queue candidate for analyst review.
5. **Evidence brake** (`src/shared/infra/ingest/evidence-brake.ts`): a spec whose quoted evidence
   is not in the post is dropped before the merge and promote gates; the identity decision is
   untouched. The text is folded the way the verifier folds it (NFKC), so the two agree. A figure
   an AI tier produced gets one repair call per post, at most twelve items (`requote` on the
   extractor): the reply is kept only when the passage is in the post and carries the figure's
   digits, and any failure of the call drops the figure as before. Drops and repairs are counted on
   the dispatch's `analysis` (`droppedForEvidence`, `requoted`).
6. **Activity split:** figures that count events (launched, intercepted, delivered, produced,
   kills, ordered) leave the specs in `mergeSpecs` and become `Drone.activity` records with
   quantity, bound, counted unit and period (`src/entities/drone/activity.ts`). The catalogue
   repair moves the ones stored as specs before this existed. Shown in the dossier's Activity
   panel; never in consensus.

**Post-sync automation** (`src/shared/infra/sources/fetch-posts.server.ts`):

- Auto-triage (`auto-triage.ts`): corroboration, learned negatives, adjudication, age-out.
- Contradiction checks on disputed specs (`contradictions.ts`).
- Re-analysis of stale / failed posts when `PIPELINE_VERSION` or prompt version changes
  (`requeue.ts` and `retraction.ts`, re-exported by `auto-ingest.ts`).
- Re-analysis after a rule is quarantined: the posts behind the claims the rule shaped are set
  back to pending, so they are read again without it (see Claim lineage and self-repair).

**Concurrency:** `sync_state` throttle; dispatch rows claimed with `FOR UPDATE SKIP LOCKED` when
Postgres leases are available (`004_dispatch_lease.sql`).

---

## Normalization

Runs on the extraction write path (`normalizeExtraction` in `src/entities/normalization/apply.ts`,
spec semantics in `src/entities/drone/spec-engine.ts`).

- Numeric units, currency strings, RF frequencies → IEEE/NATO bands (recomputed from MHz where
  possible).
- Propulsion and installation → taxonomy ids (`taxonomy.ts`); unknown strings →
  `taxonomy_candidates` for the Taxonomy page.
- Catalog facets use normalized ids (`local-repository.ts` search).

Design background: [normalization.md](./normalization.md).

---

## AI and providers

- Browser never holds server env keys; chat goes through server functions / `chatCompletionOnce`
  (`ai-proxy.server.ts`).
- Multi-provider fallback: NVIDIA, Groq, OpenRouter, Mistral (`ai-providers.ts`) with cooldowns,
  pacing (`PROVIDER_RPM`), and per-tier model ids.
- Extraction prompt version: **`drone-osint-v8`** in `src/shared/contracts/extraction-prompt.json`,
  which also carries a hash of the prompt text; `src/test/prompt-guard.test.ts` pins the pair, so
  the text cannot change without both being bumped. Replies are validated with
  `AIExtractionSchema` (tolerant Zod).
- Briefing executive summary: tier-2 summarizer + shared row in `sync_state` (see README).
- Queue **Translate** uses `translateText` server function; extraction does not auto-translate
  non-Latin text before the model (see roadmap).

Settings page is read-only: it shows the resolved providers, models, the translation route and
fallback order, and the built-in thresholds. Nothing is typed in the browser, and a key never
lives there (an old browser copy is removed on load). Translation runs on its own server-side
route (`translateCompletion`: `TRANSLATE_PROVIDER`, `TRANSLATE_MODEL`, then each provider's
translation model), so the browser's model setting is never sent. English text is not sent at
all (`detectLanguage`, entities/normalization/language.ts): NVIDIA's Riva-Translate reads its
system message as a language pair (`ru-en`, `uk-en`) and, given English and an instruction, answers
in a language of its own choosing. The route sends the pair for Russian and Ukrainian and the plain
instruction for other languages, which Riva follows. The dossier summary shows one thing at a time
(`summaryView`): the scraped text with a status line while a brief is generated, then the brief,
with a translation only when no brief is coming. A claim's value is shown as its reading
(`cleanReading`: "up to 500 km", "approx. 46 km/h") with the stated phrase beside it, on the audit
page, the provenance sheet and the claim timeline; the qualifier is read beside the figure
(`qualifierBeforeFigure`). This is display only: what is stored, and what consensus and the
verifier read, is unchanged.

---

## Observability

- **`PIPELINE_TRACE`:** per-item lines to server console (`src/shared/infra/pipeline-trace.ts`).
- **Log lines are timestamped:** every line the app writes carries an ISO-8601 UTC time
  (`src/lib/log-timestamp.ts`, installed by the `plugins/log-timestamp.ts` nitro plugin before the
  first line is written).
- **Feed:** dispatch `analysis` metadata (engine, model, prompt version, escalation reasons) on
  `dispatches-page.tsx`.
- **Sources:** live sync progress via polling `getSyncState`.
- **Autonomy (`/autonomy`):** deterministic verification coverage (verified / uncertain /
  rejected / not yet checked), the claims worth a look, the `autonomy_events` decision ledger
  (migration 018) and rule decisions. Verification is measured only; it does not change consensus.
  Three more panels read through the `AutonomyInsights` contract
  (`src/shared/contracts/autonomy-insights.ts`): the second reader's false supports on injected
  errors, the verified share per prompt version, and the sources whose fetches are failing, quiet
  or unsteady. Ledger rows carry a readable label per event kind
  (`src/features/autonomy/event-labels.ts`).
- **Audit (`/audit`):** the human audit of `verified` claims (migrations 019/020/026) — the formal
  evaluation (200 claims drawn once in proportion to language strata, one exact analysis against
  the 5 % budget, `incomplete` is never a pass), earlier draws kept as information, hidden
  controls, and the second reader's agreement with the person's answers as it stood at the draw. The frozen seed set lives only in
  `verification_audit`; nothing that learns may read it.
  Every batch of 25 or more carries two kinds of hidden control (`controlMix`): altered figures,
  which test whether the figure is read, and a rejected claim whose sentence names another system
  (`misread`), which tests whether a parent or sibling variant is accepted as this system. A
  panel lists the answers the second reader contradicted (`readerDisagrees`) for a second look,
  kept beside the answer (`second_look`, migration 023) and never replacing it.

---

## System relations and families

- **Typed relations** (`Drone.relations`, `src/entities/drone/system-hierarchy.ts`): `variant_of`,
  `derived_from`, `subsystem_of`, `effector_for`, `carried_by` (stored on the dependent entry)
  and `counterpart_to` (stored once). The inverse (`has_variant`, `parent_of`, `has_subsystem`,
  `operates_effector`, `carries`) is generated when read, never stored.
- **System class** (`Drone.systemClass`): platform, family, complex, subsystem, effector,
  payload_ew. A family is the umbrella a generic mention ("Gerans") belongs to.
- **Flight profile** (`Drone.flightProfile`, set from the dossier's Relations panel through
  `setFlightProfile`): `ballistic` swaps the general plausibility bounds for ballistic ones
  (`plausibleBounds` in `src/entities/drone/auto-correction.ts`) - Mach 1-25 speed, an apogee of
  up to 2 000 km, a launch mass up to 250 t - for both the verifier's bounds check and the unit-slip
  and implausible-figure detection. Only an analyst sets it, because it loosens a check; setting it
  redoes the bounds check of the entry's verified claims at once (`recheckDroneBounds`) and keeps
  every other check as it was. A merge keeps either entry's profile.
- **One reader:** `resolveRelations`, `lineage`, `familyRoot` read typed relations and the legacy
  `variantOfId`/`variantIds`/`counterpartIds` together while the repair copies the legacy links
  over. Catalogue operations `linkSystems`, `unlinkSystems`, `reviewRelation`, `setSystemClass`
  write both, and unlink on both sides.
- **Family review** (`/families`, `src/entities/drone/family-audit.ts`): proposals derived from the
  catalogue's names - families, unlinked variants, misfiled aliases, one family under two entries.
  Each is applied by an analyst through an existing operation; a declined one is remembered.
- **Migration:** the catalogue repair copies `variantOfId`/`variantIds`/`counterpartIds` into typed
  relations (`legacyRelationsToMigrate`); the legacy fields stay until every reader is moved.
- **Dossier:** a Relations panel (`src/features/dossier/system-relations-panel.tsx`) lists every
  relation from the entry's side, with Unlink, the reports' suggested relations with Confirm /
  Reject, a form to link another system by a stored kind, and the kind of system; a breadcrumb
  under the title shows the family chain. The counterparts page, catalogue cards, related-intel
  graph and briefing digest read relations through `resolveRelations` too. Labels live in
  `src/shared/ui/relation-labels.ts`.
- **Inherited specs** are a comparison view only (`compileEffectiveSpecs`), labelled with the parent.
- **Not built yet:** relation suggestions at ingest (lexicon lineage cues writing candidate
  relations - the Relations panel already reviews candidates), and the family comparison view
  that shows inherited specs (`compileEffectiveSpecs` exists, nothing renders it).

## Analyst review

- A verdict lives on the claim (`SpecClaim.review`, `src/entities/drone/claim-review.ts`): confirmed,
  or rejected for a reason — wrong figure, wrong unit or parse, about another system, or about
  another attribute. It outranks the contradiction check and the auto-corrector.
- **Moving a claim** to the attribute it describes (`moveClaim`) keeps it on the record where the
  post put it, stops it counting there, and files it under the attribute the analyst names.
- A rejected claim stays on the record but no longer counts towards the consensus value.

---

## Claim lineage and self-repair

First slices of ten improvements to `get_human_out_of_the_loop_plan.md` (its §17). Everything here
is either bookkeeping, measurement, or a loop with its own switch; consensus reads none of it, and
`AUTO_APPLY_TIERS` is still empty.

- **Lineage** (`SpecClaim.lineage`, `src/entities/drone/claim-lineage.ts`): a new claim records the
  prompt version and hash, the pipeline version, the rule-set version, the ids of generated cue and
  context-filter rules that shaped its spec, the name or alias that resolved the post to the system
  (`name`, `alias` or `rule_alias`), and the post's content hash on auto-merged claims. A claim
  without lineage means unknown; only the content hash is backfilled. Unit-scale rules do not
  record their id yet.
- **Replay after quarantine** (`src/shared/infra/evaluation/rule-sandbox-replay.server.ts`,
  `RULE_REPLAY`): when an active rule is quarantined, by the circuit breaker or an analyst, the
  posts behind the claims it shaped are set to pending with `reanalyze`, at most 200 per
  quarantine, and the ledger gets `rule_replay_requested`. Stopword and unit-scale rules leave no
  lineage and replay nothing.
- **Probation** (`src/shared/infra/evaluation/rule-sandbox-probation.server.ts`, `RULE_PROBATION`):
  a generated rule the circuit breaker quarantined at least seven days ago returns to shadow once
  (`rule_probation_started`) and must pass the unchanged promotion policy again. Aliases and
  stopwords never return, an analyst's quarantine is never undone, and a second quarantine is
  final.
- **Source probe** (`runSourceProbes` in `src/shared/infra/sources/fetch-posts.server.ts`,
  `SOURCE_PROBE`): a source the health check turned off gets one probe fetch a week, at most two
  probes per sync and eight per source. A probe that returns posts re-enables it
  (`source_reenabled`). A source an analyst turned off is never probed.
- **Identity follows "It …"** (`src/entities/drone/verification-identity.ts`): an evidence sentence
  that names no system and opens with a continuation word passes at 0.6 when the sentence before
  names this system and no other, and every passage carrying the quote is such a sentence.
- **Reposts are one source** (`src/entities/drone/verification-sources.ts`): two outlets whose
  posts have near-identical content hashes count as one independent source for a claim.
- **Injected controls** (`src/shared/infra/verification/controls.server.ts`, `verification:controls`
  hourly, `migrations/025_verifier_controls.sql`): the second reader is shown verified claims whose
  figure was changed to one the post does not contain. A "supported" is a false support, reported
  overall and per attribute family and language against the 5 % budget
  (`src/entities/drone/verifier-controls.ts`). It shares the second reader's token ceiling and
  switch, never reads `verification_audit`, and writes nothing to the catalogue.
- **Verified share per prompt version** (`verificationByPromptVersion`,
  `src/entities/drone/verification-coverage.ts`).

---

## Verified reference and evaluation

The heuristic is scored against what the catalogue has judged, not just what the AI stored
(`src/shared/infra/evaluation/reference.ts`, re-exported by `evaluation.ts`; plan §4.4):

- `verifiedReference(c, verifiedVerdicts(catalog))` maps each stored spec to its claim's verdict:
  machine-verified claims count as expected positives (even when the AI dropped them), rejected
  ones as expected negatives, and claims the verifier could not decide are **excluded** from every
  score — not counted as misses. An analyst's `review` still overrides the verifier in both
  directions. A claim nobody has judged falls back to the stored reading, so an unverified
  catalogue behaves exactly as before.
- `ReferenceCoverage` (overall and per spec key) travels with every `EvalReport`, and is shown
  beside the F1 numbers on the Evaluation page, in the sandbox verdict and in the shadow line:
  `ref 62% of 140` — the share of scored claims resting on a verified or analyst verdict.
- Regression fixtures come from `verifiedFixtures` (verified → expect, rejected → forbid,
  uncertain → neither); analyst-decided candidates keep their `review-` fixture ids, machine-only
  ones get `verified-`. Mining keeps its analyst-reviewed sample but scores against the verified
  reference; `shadowStep` and contradiction adjudication do the same.
- **Seed-set agreement** (`seed-agreement.server.ts`, shown on the Evaluation page): the frozen
  seed set — the claims a person answered in the audit — is read once more by today's heuristic.
  A "yes" answer must be found, a "no" must not be produced, "cannot tell" is excluded, and the
  disagreement bound is the audit's own Clopper-Pearson bound. Reporting only, read-only on
  `verification_audit`: nothing that learns imports it (plan §3, principle 7).
- The second reader (`SpecClaim.entailment`) and the challenger remain measurement-only until the
  audit earns them a vote.

---

## Reference import

On-demand Wikipedia/Wikidata catalog import from the Catalog page (`src/shared/infra/wikipedia/`,
`src/features/catalog/reference-import.ts`). Not part of scheduled ingest or briefing panels.

---

## Testing

- Runner: `vitest` — suites under `src/test/` (normalization, pipeline, ingest, providers, etc.).
- Quality gate script: `npm run green` / `green:save`.
- Fixture corpus `src/test/fixtures/extraction-corpus.ts` is replayed by
  `src/test/extraction-corpus.test.ts`.

---

## Schema

Authoritative SQL: `migrations/001_init.sql`–`027_audit_integrity.sql` (see README PostgreSQL table). `drizzle/` is not used at
application runtime.
