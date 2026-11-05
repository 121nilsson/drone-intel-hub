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

- Bounded parallel fetches with per-host pooling and `FETCH_TIMEOUT_MS`.
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
5. **Evidence brake:** a spec whose quoted evidence is not in the post (whitespace-folded) is
   dropped before the merge and promote gates; the identity decision is untouched.
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
- Extraction prompt version: **`drone-osint-v7`** in `src/shared/contracts/extraction-prompt.json`;
  validated with `AIExtractionSchema` (tolerant Zod).
- Briefing executive summary: tier-2 summarizer + shared row in `sync_state` (see README).
- Queue **Translate** uses `translateText` server function; extraction does not auto-translate
  non-Latin text before the model (see roadmap).

Settings page shows resolved providers, models, and fallback order.

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
- **Audit (`/audit`):** the stratified human audit of `verified` claims (migrations 019/020) —
  drawn with a recorded seed, hidden controls, the binomial stopping rule against the 5 % budget,
  and the second reader's agreement with the person's answers. The frozen seed set lives only in
  `verification_audit`; nothing that learns may read it.

---

## System relations and families

- **Typed relations** (`Drone.relations`, `src/entities/drone/system-hierarchy.ts`): `variant_of`,
  `derived_from`, `subsystem_of`, `effector_for`, `carried_by` (stored on the dependent entry)
  and `counterpart_to` (stored once). The inverse (`has_variant`, `parent_of`, `has_subsystem`,
  `operates_effector`, `carries`) is generated when read, never stored.
- **System class** (`Drone.systemClass`): platform, family, complex, subsystem, effector,
  payload_ew. A family is the umbrella a generic mention ("Gerans") belongs to.
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
- Fixture corpus `src/test/fixtures/extraction-corpus.ts` is defined but **not imported by any test
  yet** (roadmap item).

---

## Schema

Authoritative SQL: `migrations/001`–`020` (see README PostgreSQL table). `drizzle/` is not used at
application runtime.
