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
- **Selection** (`src/shared/infra/store.functions.ts`): `DATABASE_URL` → PostgreSQL
  (`postgres-store.server.ts`); else Lovable Cloud service role when configured; browser uses
  `LocalStorageStore` or `RemoteStore` (server functions) when Postgres is available.
- **Repositories:** write-through caches in `src/shared/infra/storage/local-repository.ts` — synchronous
  reads for the UI, async `put`/`remove` to the backing store. Failed remote writes are logged to
  the console only (no user-visible sync error yet).

`procurements` is persisted and a procurement extractor exists
(`src/shared/infra/procurement-extractor.ts`, behind the `ProcurementExtractor` contract), but
nothing in the ingest path calls it yet — no UI surface.

---

## Ingest — stage 1 (collection)

Implemented in `src/shared/infra/fetch-posts.server.ts`, `fetch-posts.ts`, and
`src/shared/infra/ingest/auto-ingest.ts` (`collectSource`).

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

Same pipeline as manual Queue paste: `runTwoTier` in `src/shared/infra/ingest/pipeline.ts`.

1. Heuristic extractor (`src/shared/infra/heuristic-ai.ts`) when `heuristicFirst` is on.
2. Tier 1 / tier 2 OpenAI-compatible models when configured (`openai-compatible-ai.ts`), with
   escalation gates (`extraction-gates.ts`).
3. Provider outage → heuristic fallback for interactive paste; queue processor can defer
   (`deferOnOutage`) so posts stay `pending`.
4. Outcomes: auto-merge, auto-promote, auto-discard, or queue candidate for analyst review.

**Post-sync automation** (`src/shared/infra/fetch-posts.server.ts`):

- Auto-triage (`auto-triage.ts`): corroboration, learned negatives, adjudication, age-out.
- Contradiction checks on disputed specs (`contradictions.ts`).
- Re-analysis of stale / failed posts when `PIPELINE_VERSION` or prompt version changes
  (`reanalysis` helpers in `auto-ingest.ts`).

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
- Extraction prompt version: **`drone-osint-v5`** in `src/shared/contracts/extraction-prompt.json`;
  validated with `AIExtractionSchema` (tolerant Zod).
- Briefing executive summary: tier-2 summarizer + shared row in `sync_state` (see README).
- Queue **Translate** uses `translateText` server function; extraction does not auto-translate
  non-Latin text before the model (see roadmap).

Settings page shows resolved providers, models, and fallback order.

---

## Observability

- **`PIPELINE_TRACE`:** per-item lines to server console (`src/shared/infra/pipeline-trace.ts`).
- **Feed:** dispatch `analysis` metadata (engine, model, prompt version, escalation reasons) on
  `dispatches-page.tsx`.
- **Sources:** live sync progress via polling `getSyncState`.

---

## Reference import

On-demand Wikipedia/Wikidata catalog import from the Catalog page (`wikipedia.server.ts`,
`wiki-specs.ts`). Not part of scheduled ingest or briefing panels.

---

## Testing

- Runner: `vitest` — suites under `src/test/` (normalization, pipeline, ingest, providers, etc.).
- Quality gate script: `npm run green` / `green:save`.
- Fixture corpus `src/test/fixtures/extraction-corpus.ts` is defined but **not imported by any test
  yet** (roadmap item).

---

## Schema

Authoritative SQL: `migrations/001`–`007` (see README PostgreSQL table). `drizzle/` is not used at
application runtime.
