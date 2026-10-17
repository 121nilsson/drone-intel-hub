# Roadmap

Verified open work as of October 2026. Shipped behavior is documented in
[current-state.md](./current-state.md). Older brainstorming lives in [archive/](./archive/).

---

## Ingest and sources

| Priority | Item                    | Notes                                                                                                                                                           |
| -------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High     | Broader source adapters | Reddit, YouTube captions, procurement feeds, etc. — new `platform` values + `fetch-posts` adapters behind `FetchedPost` (see archive `improvements-round1.md`). |
| High     | X without bridge        | Native X API or bot-based path; today only `X_BRIDGE_BASE` or manual paste.                                                                                     |
| Medium   | Tiered relevance        | Today: `DRONE_HINT` OR catalog pattern. Optional secondary keyword gate and language-specific lists to cut noise without missing rare system names.             |
| Medium   | Source list hygiene     | Fix or remove permanently broken seed URLs (https-only fetch); keep [sources_list.md](./sources_list.md) aligned with parsers.                                  |

---

## AI quality and cost

| Priority | Item                                 | Notes                                                                                                                                                        |
| -------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| High     | Wire extraction corpus tests         | Import `EXTRACTION_CORPUS` in vitest; optional live run via env flag for regression on prompt changes.                                                       |
| High     | Re-benchmark defaults                | Run `scripts/benchmark-models.mjs` after provider/catalog changes; align `.env.local` / Settings with results ([modelbenchmark.md](./modelbenchmark.md)).    |
| Medium   | Conditional pre-translate on extract | Queue has Translate; pipeline could call Riva (or tier-1) for non-Latin posts before extraction when benchmark shows variance (not mandatory for Latin).     |
| Medium   | Surface provider/model drift in UI   | Settings already warns on namespaced models; extend Feed/Queue with last engine + degraded tier from persisted trace (today partial on dispatch `analysis`). |
| Low      | Procurement extraction               | `extractProcurement()` + `procurements` collection exist; wire into pipeline and add a view or dossier link.                                                 |

---

## UX and operations

| Priority | Item                                | Notes                                                                                                                                                                 |
| -------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High     | Remote write failures visible       | `CachedRepository.save()` only `console.error`s failed `put` — toast or Settings banner when Postgres sync fails.                                                     |
| Medium   | Cross-tab / post-sync cache refresh | Sources page reloads dispatches/sources during live sync; drones/candidates/taxonomies do not — central `reload()` on focus or interval when `RemoteStore` is active. |
| Medium   | Shareable catalog filters           | Persist catalog facet state in URL (like `/dispatches?q=`).                                                                                                           |
| Medium   | Feed → dossier deep links           | Show merge/promote/queue outcome on each dispatch with links to `/systems/$id` and Queue.                                                                             |
| Low      | Confirm destructive catalog actions | Merge/remove with impact preview (`removalImpact` already exists).                                                                                                    |

---

## Catalog and relationships

| Priority | Item                         | Notes                                                                                                    |
| -------- | ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| Medium   | `variantOf` promotion polish | Counterpart edges on promote; optional copy of parent RF bands and explicit “variant of” timeline event. |
| Low      | Graph reasoning              | Richer counterpart suggestions beyond manual linking and extraction `systems[]` → `counterpartIds`.      |

---

## Code health

| Priority | Item                | Notes                                                                                                                                    |
| -------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Medium   | React Query         | `QueryClientProvider` in `__root.tsx` but server-fn calls use ad hoc `useEffect` — use queries for briefing/sync or drop the dependency. |
| Medium   | Split `pipeline.ts` | Large module; extract auto-actions and trace assembly without behavior change.                                                           |
| Low      | Shared UI helpers   | e.g. duplicate `ExpandableText` in intake and dispatches → `shared/ui`.                                                                  |
| Low      | Migration tooling   | Single story for `migrations/` vs unused `drizzle/` tree (document-only today).                                                          |

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
