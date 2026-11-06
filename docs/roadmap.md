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

| Priority | Item                                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Medium   | Heuristic gaps the corpus found       | `extractMoney` emits no `unit_cost` for a range ("$15,000-$20,000"); a single figure works. It also returns "Baba" and "Yaga" for the two-word name "Baba Yaga" (and splits "Silver Shield"). Found when the extraction corpus ran in vitest (`src/test/extraction-corpus.test.ts`, with `LIVE_EXTRACTION=1` for a live provider); its fixture uses one figure and asserts no system name for that post. `parseMoneyRange` in `entities/normalization/currency.ts` already reads ranges. |
| High     | Find a better extraction model        | Re-benchmarked 2026-11-06 (`--provider=NAME`, results in [modelbenchmark.md](./modelbenchmark.md)): NVIDIA's recommended model is gone from the account, and no configured model scores above 2/4 on the strict `matchId` grading. Next: try new candidates per provider and re-run before changing a default.                                                                                                                                                                           |
| Medium   | Conditional pre-translate on extract  | Queue has Translate; pipeline could call Riva (or tier-1) for non-Latin posts before extraction when benchmark shows variance (not mandatory for Latin).                                                                                                                                                                                                                                                                                                                                 |
| Medium   | Surface provider/model drift in UI    | Settings already warns on namespaced models; extend Feed/Queue with last engine + degraded tier from persisted trace — `RawDispatch.analysis` has no degraded field yet.                                                                                                                                                                                                                                                                                                                 |
| Medium   | Evidence check covers more than specs | A spec's quote is checked against the post before merge or promote. The observation arrays (`components`, `payloads`, `sensors`) are not, and a spec with neither `evidence` nor `raw` passes the check.                                                                                                                                                                                                                                                                                 |

---

## UX and operations

| Priority | Item                                | Notes                                                                                                                                                                 |
| -------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Medium   | Cross-tab / post-sync cache refresh | Sources page reloads dispatches/sources during live sync; drones/candidates/taxonomies do not — central `reload()` on focus or interval when `RemoteStore` is active. |
| Medium   | Shareable queue pagination          | Catalog facets are in the URL (`catalog-state.ts`); Queue pagination is still component state.                                                                        |
| Medium   | Feed → dossier deep links           | Done for the dossier and the queue link. The merge/promote outcome itself is still only inside the collapsed analysis panel.                                          |
| Low      | Undo for catalog mutations          | Merge and remove confirm with an impact preview, but neither can be undone — only a Queue discard can.                                                                |

---

## Catalog and relationships

| Priority | Item                         | Notes                                                                                                                                            |
| -------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Medium   | `variantOf` promotion polish | Counterpart edges on promote are done. Still open: copy the parent RF bands onto the variant, and write an explicit "variant of" timeline event. |
| Low      | Graph reasoning              | Richer counterpart suggestions beyond manual linking and extraction `systems[]` → `counterpartIds`.                                              |

---

## Autonomy plan (`get_human_out_of_the_loop_plan.md`)

| Priority | Item                                     | Notes                                                                                                                                                                                                                                                                                  |
| -------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High     | Run the first audit                      | Phase 2 closes only when the `/audit` session runs to its stopping rule (≈150 claims, the project owner) and the seed set freezes; verified precision is then measured, not assumed. Seed-set agreement is already reported beside the evaluation scores (`seed-agreement.server.ts`). |
| Deferred | Challenger                               | Plan §4.3 step 8: a second judge on disagreement between checks. Nothing to arbitrate until the second reader earns a vote from the audit, so it stays deferred.                                                                                                                       |
| Gated    | Contradictions on the verified reference | `checkTrust` (`src/shared/infra/ingest/contradictions.ts`) still sets its confidence bar from analyst decisions. It moves to source quality plus evidence with the §7.3 rework, in Phase 3.                                                                                            |
| Gated    | Uncertain → `unconfirmed`                | Decided 2026-11-04 (plan §14): from Phase 3, uncertain claims are shown as unconfirmed and never counted; a spec with only uncertain claims keeps its value under that label.                                                                                                          |
| Gated    | Phase 3 gate removal                     | Low-risk promotion without analyst decisions, canary/auto-revert — not before audited verified precision is at or above the 5 % budget (plan §9).                                                                                                                                      |
| Medium   | Proposal appliers                        | `admitProposal` checks and risk-tiers `rule` proposals only (`shared/infra/proposals`). Next: route mined hypotheses through it, then an apply/revert side with its ledger event kind, added in the same change as its first writer.                                                   |

---

## Code health

| Priority | Item              | Notes                                                                           |
| -------- | ----------------- | ------------------------------------------------------------------------------- |
| Low      | Shared UI helpers | e.g. duplicate `ExpandableText` in intake and dispatches → `shared/ui`.         |
| Low      | Migration tooling | Single story for `migrations/` vs unused `drizzle/` tree (document-only today). |

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
- A spec's evidence must occur in the post before it reaches the catalog (the "autonomy brake" in `ingest/pipeline-run.ts`)
- Procurement extraction: the LLM extractor runs in ingest (`pipeline-run.ts`), the server-side sync supplies the `procurements` repository, and the data shows on the Procurement page and the dossier's Contracts panel
- `pipeline.ts` split into `pipeline-run`, `-actions`, `-slice`, `-triage`, `-types` and `-internal` (the old file is a barrel)
- Analyst verdicts on a claim, including moving a claim to the attribute it describes
- Payload and sensor facts shown on the dossier from both the observations and the specs
- Timestamped log lines, including the ones Docker prints
