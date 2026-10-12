# Ideas to improve the system

Brainstorm backlog from a full-stack review (October 2026). Items already scoped and verified
live in [roadmap.md](./roadmap.md) — this file adds **UI/UX/product** angles and longer-horizon
ideas. When an idea becomes concrete, move it into the roadmap and drop or shorten it here.
Later numbers in each list are later passes against the current tree.

---

## Code and architecture

1. **Visible persistence failures** — `CachedRepository.save()` emits locally then `put`s async;
   failures only hit the console. Surface sync health (toast, Settings strip, retry queue) so
   Postgres deployments never look saved when they are not.
2. **Global store refresh** — Only the Sources page reloads collections during sync. A composition-root
   hook (focus, interval, post-sync) should refresh drones, candidates, and taxonomies when
   `RemoteStore` is active.
3. **React Query or remove it** — `QueryClientProvider` is wired but features use
   `useSyncExternalStore` on repos. Use queries for briefing summary, sync state, and translate;
   otherwise remove the dependency.
4. **Modular pipeline** — `pipeline.ts` is a change hotspot. Split analyze, auto-merge/promote/discard,
   and trace assembly; keep vitest as the contract.
5. **Single migration story** — Authoritative SQL is `migrations/`; `drizzle/` is unused at runtime.
   Either generate SQL from Drizzle or delete the stray tree to avoid drift.
6. **Browser pipeline off the server AI client** — `pipeline.ts` imports `chatCompletionOnce` from
   `ai-proxy.server.ts`, and the Queue page imports `promote`, `mergeInto`, and `runTwoTier` from
   that same module. `extractProcurement` calls the proxy directly, outside `IntelExtractor` and
   the provider fallback chain. Keep a browser-safe pipeline; server-only completions stay behind
   the extractor contract.
7. **Windowed collection reads** — `DocumentStore.load` returns the full array and
   `CachedRepository` keeps it, so Catalog, Feed, and Queue render every row. `claim()` is already
   bounded for workers. Add a paged query and virtualize those three views.
8. **Shared name index** — ⌘K and catalog search substring-scan `droneHaystack`. Build a token
   index on the existing name key (`phoneticKey`) and use it for the palette, the catalog, and the
   match shortlist.
9. **Contract-typed services** — `Services` exposes the concrete `Local*` repository classes, so
   every page depends on them. Type the context as `DroneRepository` and the other contracts.
10. **Source sync outside the page** — `SourcesPage` owns collect, lease, heartbeats, and a
    40-line log in React state. Run that loop beside `auto-ingest.ts`.

---

## UI

1. **One component vocabulary** — Most screens use `shared/ui/primitives`; shadcn is partial.
   Standardize dialogs, tables, forms, and focus rings on shadcn wrappers with the intel theme.
   One page-title treatment: Spectrum’s tracked mono title diverges from Briefing and Catalog,
   and that page adds a second `max-w-7xl` padding inside `AppShell`.
2. **Command palette** — Replace the hand-rolled ⌘K modal with `cmdk`: search systems, dispatches,
   sources, and queue candidates; jump to routes (`/intake?draft=…`); actions (sync sources, open
   tier-2 queue). Group hits, show recent items when the query is empty, and move the list with
   the arrow keys. Back it with the name index in Code, not a full `droneHaystack` scan.
3. **Navigation IA** — Ten flat header links are hard to scan. Group into Intel / Catalog /
   Curation / System, or use the existing sidebar component on large breakpoints.
4. **Dense data views** — Catalog, Queue, and Feed benefit from sticky-header tables, sortable
   columns, row selection, and bulk triage instead of long unstructured lists. Default Catalog to
   a compact row (name, origin, domain, one consensus figure, updated) with the card as a toggle,
   and lift duplicate groups out of the filter sidebar.
5. **Semantic status styling** — `styles.css` defines `--warning` and `--success`; map dispatch
   status, sync health, confidence, and provider state to consistent badge variants and icons.
6. **Spectrum as a frequency axis** — The section is titled “low → high” and renders a grid of
   segment cards. System names are spans, so a jammer or a drone cannot open its dossier. Draw
   one axis and link each chip to `/systems/$id`.
7. **Evidence inside the source text** — Provenance shows `claim.evidence` as a quotation beside
   the number. Highlight that span in the dispatch, and give a disputed spec a persistent marker
   on the row (phone cards and the desktop table), not only a tag.
8. **Small charts on the existing dark theme** — Spectrum is the only page that shows a pattern
   instead of a table. Extend that, still flat and mono: a 30-day report-frequency sparkline on
   each Catalog row, a per-source posting heatmap on Feed, and a direction marker on Briefing
   spec claims when this week's figure moved. The charts answer "what changed?"; the consensus
   table stays the record.

---

## UX

1. **Shareable analyst state** — Persist catalog filters and queue pagination in the URL (Feed and
   Intake already use search params).
2. **Storyline: Feed → Queue → dossier** — After processing, show outcome on the dispatch row
   (merged into X, queued Y) with one-click links; do not bury it under “Show analysis”.
3. **First-run / no-AI path** — When `!aiConfigured`, explain what still works (heuristic ingest)
   and link to Settings; avoid silent “why is everything tier heuristic?”.
4. **Safe destructive edits** — Merge and remove drone with confirm dialogs and
   `removalImpact` preview; optional short undo where storage allows.
5. **Long-running work feedback** — Deep analysis, briefing summary, and sync need step labels
   (heuristic → tier 1 → tier 2), elapsed time, and cancel where safe — match Settings-level
   clarity for provider fallback.
6. **Keyboard triage, with a preview before deep analysis commits** — Promote, merge, and discard
   are mouse-only, and merge is a `<select>` of every drone. Deep analyze marks the current
   candidate discarded immediately. `j`/`k` to move, shortcuts for the three decisions, a short
   undo, and a side-by-side of the new extraction before it replaces the old one.
7. **Briefing summary that cites its inputs** — The executive summary is a paragraph with no
   links into the week’s reports, and no control to regenerate before the cache TTL (about twice
   a day). Link system names and outlet counts to the dossier or the feed item, and add
   Regenerate.
8. **Last source run on the row** — The Sources log keeps forty strings in component state, so a
   reload drops them. `lastFetched` and `lastError` stick; fetched, stored, and duplicate counts
   do not. Write the last run onto the source and show it on the row.
9. **Threshold preview** — `autoMerge` 0.85, `autoPromote` 0.9, and `autoDiscard` 0.25 save
   without saying how many pending candidates would move. Show merge / promote / discard counts
   for the current queue before saving. Open Catalog duplicate groups from the existing banner.
10. **Related intelligence on the page you are already on** — A dossier, feed post, spectrum
    selection, or catalog row should show the next fact without a trip through the nav. Dossier:
    "3 counterparts share the 900 MHz band" opens `/counterparts?a=&b=` (that search already
    exists) with the pair selected. Feed: a post that names a system whose range is disputed
    links to Spec Engine filtered to that system and attribute, and from there to
    `/systems/$id#specs`. Spectrum: "Shahed-136 evades Jammer X" opens Counterparts for that
    pair. Catalog: "5 systems updated this week" opens Briefing's catalog-changes panel. Compute
    it as a pure function over the drones and dispatches the pages already hold — counterpart,
    RF overlap, jammer/link exposure, disputed spec, shared component, shared operator, same
    dispatch event, variant lineage, shared Wikidata id — then rank and dedupe into a short
    rail. `/spectrum?focus=` and `/specs?q=&drone=` do not exist yet. `/dispatches?q=` does;
    status is still local state. Subscribe the way the pages do today. A TanStack Query hook
    waits on Code item 3.
11. **Spec timeline scrubber** — The dossier "Spec evolution timeline" is a static list. A spec
    needs a horizontal scrubber: hover a date to see the consensus and sources as of that day,
    pin two dates to diff them, and copy the diff. Replay `SpecClaim.date` through `consensus()`.
    `EvolutionEvent` is a prose log (date, kind, description, source) and has no old value, new
    value, or claim id, so it cannot drive the scrubber.

---

## AI and inference

1. **Regression harness** — Wire [extraction-corpus.ts](../src/test/fixtures/extraction-corpus.ts)
   into vitest; optional `LIVE_MODEL=1` job on prompt bumps (`drone-osint-v5` and beyond). The
   corpus is four short English reports. Add Cyrillic, a post with no system, two systems in one
   report, and a counter-UAS system — the cases the last benchmark actually failed. Shipped
   defaults are Groq `openai/gpt-oss-20b` and `openai/gpt-oss-120b`; that benchmark scored the
   20b model 2/4 and the prompt is now `drone-osint-v4`, so the live job is what keeps defaults
   honest.
2. **Pipeline trace in the product** — `PipelineTrace` and `PIPELINE_TRACE` logs are rich; persist
   full trace on dispatch/candidate and show it in Queue/Feed, not only in Docker logs.
3. **Honest provider routing** — Document or implement tier route ordering in `ai-providers.ts` so
   Settings “Providers” matches runtime (namespaced model drift warnings already exist).
4. **Contradiction workflow** — Server adjudication exists; add analyst triggers, re-check, and a
   dossier list of disputed specs still needing review.
5. **Context packaging** — Chunk very long articles with per-chunk attribution; improve catalog
   shortlist beyond stem matching (alias index, optional retrieval) to cut wrong `matchId` and
   unnecessary tier-2 spend. Optional conditional pre-translate for non-Latin before extract
   (Queue Translate is manual today); still check evidence against the original text.
6. **Evidence must occur in the post** — The prompt demands a verbatim quote, and nothing checks
   that the quote is in the raw text. Before merge or promote, require each spec’s evidence to be
   a substring of the post (same whitespace fold). Drop the spec when it is not; keep the identity
   decision.
7. **Extraction schema, then one repair** — The proxy sends `response_format: json_object` only, so
   valid JSON missing most keys still becomes an extraction after the tolerant parse. Send the
   extraction schema where the provider accepts it. On schema failure, one repair prompt, then the
   next provider. A partial object should not count as success.
8. **Calibrate confidence from analyst decisions** — Merge, promote, and discard trust the model’s
   own score (0.85 / 0.9 / 0.25). Record those outcomes against the confidence that was shown and
   fit the thresholds from that history. Score specs separately from identity so a sure name
   cannot carry an unsure figure.
9. **Per-tier output cap** — The completion body sets no `max_tokens`. Reasoning models in the
   benchmark wrote on the order of 14k characters and took 45–75s, inside the 90s provider
   timeout. Cap output per tier so one completion cannot occupy the provider slot.
10. **Why this value, on the claim** — Settings shows which provider will be asked. Clicking a
    spec claim should show what was asked: the heuristic observation, the tier-1 prompt and
    reply, the tier-2 prompt and reply when that tier ran, then the consensus inputs. Confidence
    badges on AI-derived fields are only partial today (`extractionConfidence`, engine, and model
    on the claim). `PipelineTrace` records engines, escalation reasons, and counts — not the
    prompts or replies — so this depends on persisting that transcript (see item 2).

---

## Quick wins (high leverage, small surface)

| Idea                                              | Touches                                      |
| ------------------------------------------------- | -------------------------------------------- |
| Wire extraction corpus tests                      | `src/test/`, prompt JSON                     |
| Feed outcome deep links                           | `dispatches-page.tsx`, dispatch types        |
| `ExpandableText` shared component                 | `intake-page`, `dispatches-page`             |
| `PIPELINE_TRACE` summary in Feed UI               | `pipeline.ts` persistence, Feed              |
| “AI not configured” banner                        | `services.tsx`, `app-shell` or Settings link |
| Drop specs whose evidence is absent from the post | merge/promote path, extraction prompt        |
| Cap completion tokens per tier                    | `ai-proxy.server.ts`                         |
| Last source run on the row                        | source record, `sources-page.tsx`            |
| Catalog "updated this week" → Briefing changes    | `catalog-page.tsx`, briefing catalog changes |
