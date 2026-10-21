# Roadmap

Verified open work as of October 2026. Shipped behavior is documented in
[current-state.md](./current-state.md). Older brainstorming lives in [archive/](./archive/).

---

## Ingest and sources

| Priority | Item                    | Notes                                                                                                                                                                                                                                                       |
| -------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High     | Broader source adapters | Reddit, YouTube captions, procurement feeds, etc. — new `platform` values + `fetch-posts` adapters behind `FetchedPost` (see archive `improvements-round1.md`).                                                                                             |
| High     | X without bridge        | Native X API or bot-based path; today only `X_BRIDGE_BASE`, the `X_JINA_READER=1` reader path, or manual paste.                                                                                                                                             |
| Medium   | Tiered relevance        | Today: `DRONE_HINT` OR catalog pattern. Optional secondary keyword gate and language-specific lists to cut noise without missing rare system names.                                                                                                         |
| Medium   | Source list hygiene     | Seed URLs are already https-only, well-formed and unique (`src/test/seed-sources.test.ts`), and dead sources are retired (`RETIRED_SOURCE_IDS`). What is left: align [sources_list.md](./sources_list.md) with the 88 seeded sources — the doc lists seven. |

---

## AI quality and cost

| Priority | Item                                  | Notes                                                                                                                                                                                                                                                                                                                                    |
| -------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High     | Wire extraction corpus tests          | Import `EXTRACTION_CORPUS` in vitest; optional live run via env flag for regression on prompt changes. The corpus already covers two systems in one report; Cyrillic, a no-system post and a counter-UAS system are still missing.                                                                                                       |
| High     | Re-benchmark defaults                 | Run `scripts/benchmark-models.mjs` after provider/catalog changes; align `.env.local` / Settings with results ([modelbenchmark.md](./modelbenchmark.md)).                                                                                                                                                                                |
| Medium   | Conditional pre-translate on extract  | Queue has Translate; pipeline could call Riva (or tier-1) for non-Latin posts before extraction when benchmark shows variance (not mandatory for Latin).                                                                                                                                                                                 |
| Medium   | Surface provider/model drift in UI    | Settings already warns on namespaced models; extend Feed/Queue with last engine + degraded tier from persisted trace — `RawDispatch.analysis` has no degraded field yet.                                                                                                                                                                 |
| Medium   | Evidence check covers more than specs | A spec's quote is checked against the post before merge or promote. The observation arrays (`components`, `payloads`, `sensors`) are not, and a spec with neither `evidence` nor `raw` passes the check.                                                                                                                                 |
| Medium   | Procurement extraction                | Financial specs are already split out of drone specs at the pipeline boundary and written to the collection. What is missing: the LLM extractor (`openAIProcurementExtractor`) is never called, the cron path does not supply a `procurements` repository so server-side ingest drops the records, and there is no view or dossier link. |

---

## UX and operations

| Priority | Item                                | Notes                                                                                                                                                                                                                                                                                                   |
| -------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High     | Write retry queue                   | A failed put/remove and a dropped conflict now reach the analyst (a banner in the shell, and a blocking storage error with an explicit "continue in this browser" choice). What is missing: the failed write is not retried, so a transient network error loses the edit until the analyst edits again. |
| Medium   | Cross-tab / post-sync cache refresh | Sources page reloads dispatches/sources during live sync; drones/candidates/taxonomies do not — central `reload()` on focus or interval when `RemoteStore` is active.                                                                                                                                   |
| Medium   | Shareable queue pagination          | Catalog facets are in the URL (`catalog-state.ts`); Queue pagination is still component state.                                                                                                                                                                                                          |
| Medium   | Feed → dossier deep links           | Done for the dossier and the queue link. The merge/promote outcome itself is still only inside the collapsed analysis panel.                                                                                                                                                                            |
| Low      | Undo for catalog mutations          | Merge and remove confirm with an impact preview, but neither can be undone — only a Queue discard can.                                                                                                                                                                                                  |

---

## Catalog and relationships

| Priority | Item                         | Notes                                                                                                                                            |
| -------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Medium   | `variantOf` promotion polish | Counterpart edges on promote are done. Still open: copy the parent RF bands onto the variant, and write an explicit "variant of" timeline event. |
| Low      | Graph reasoning              | Richer counterpart suggestions beyond manual linking and extraction `systems[]` → `counterpartIds`.                                              |

---

## Code health

| Priority | Item                | Notes                                                                                                                                                                                             |
| -------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Medium   | React Query         | `QueryClientProvider` in `__root.tsx` but server-fn calls use ad hoc `useEffect` — use queries for briefing/sync or drop the dependency.                                                          |
| Medium   | Split `pipeline.ts` | 922 lines. The auto-actions moved out to `ingest/auto-triage.ts`, `auto-correct.ts` and `contradictions.ts`; `runTwoTier`, `promote`, `mergeInto` and the trace assembly are still in one module. |
| Low      | Shared UI helpers   | e.g. duplicate `ExpandableText` in intake and dispatches → `shared/ui`.                                                                                                                           |
| Low      | Migration tooling   | Single story for `migrations/` vs unused `drizzle/` tree (document-only today).                                                                                                                   |

---

## Explicitly not open (formerly claimed in old roadmaps)

These are **shipped**; do not re-open without a new regression:

- Readability article bodies (`article.server.ts`)
- Cross-source SimHash near-dedup (`duplicate` dispatches)
- `consensus().disputed` and contradiction adjudication
- Propulsion/installation taxonomy ids and Taxonomy UI
- Counterparts page guard for catalogs with fewer than two systems
- Zod validation on model extraction (`AIExtractionSchema.safeParse`)
- Briefing summary in-flight guard (`reqId` on `briefing-page.tsx`)
- Remote write failures visible in the UI, and no silent fallback from server storage to browser storage
- Document revisions: a stale whole-document write conflicts instead of overwriting (`016_document_rev.sql`)
- Merge and remove confirmations with an impact preview
- Catalog facets persisted in the URL
- Feed rows linking to the dossier and the queue
- A spec's evidence must occur in the post before it reaches the catalog (the "autonomy brake" in `ingest/pipeline.ts`)
- Analyst verdicts on a claim, including moving a claim to the attribute it describes
- Payload and sensor facts shown on the dossier from both the observations and the specs
- Timestamped log lines, including the ones Docker prints
