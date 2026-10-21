# Ideas to improve the system

Brainstorm backlog from a full-stack review (October 2026). Items already scoped and verified
live in [roadmap.md](./roadmap.md) — this file adds **UI/UX/product** angles and longer-horizon
ideas. When an idea becomes concrete, move it into the roadmap and drop or shorten it here.
Later numbers in each list are later passes against the current tree.

**Deep dives:** [Ingestion](#ingestion--make-collection-and-the-queue-smarter) (collection,
relevance, queue) and [Heuristics engine](#heuristics-engine--modular-multilingual-sharper)
(per-language fact packs, smarter multi-system attribution).

---

## Code and architecture

1. **Global store refresh** — Only the Sources page reloads collections during sync. A composition-root
   hook (focus, interval, post-sync) should refresh drones, candidates, and taxonomies when
   `RemoteStore` is active.
2. **React Query or remove it** — `QueryClientProvider` is wired but features use
   `useSyncExternalStore` on repos. Use queries for briefing summary, sync state, and translate;
   otherwise remove the dependency.
3. **Modular pipeline** — `pipeline.ts` is a change hotspot (922 lines: `runTwoTier`, `promote`,
   `mergeInto`, the triage gates and the trace assembly). Split analyze, auto-merge/promote/discard,
   and trace assembly; keep vitest as the contract.
4. **Single migration story** — Authoritative SQL is `migrations/`; `drizzle/` is unused at runtime.
   Either generate SQL from Drizzle or delete the stray tree to avoid drift.
5. **Windowed collection reads** — `DocumentStore.load` returns the full array and
   `CachedRepository` keeps it, so Catalog, Feed, and Queue render every row. `claim()` is already
   bounded for workers. Add a paged query and virtualize those three views.
6. **Shared name index** — ⌘K and catalog search substring-scan `droneHaystack`. Build a token
   index on the existing name key (`phoneticKey`) and use it for the palette, the catalog, and the
   match shortlist.
7. **Contract-typed services** — `Services` exposes the concrete `Local*` repository classes, so
   every page depends on them. Type the context as `DroneRepository` and the other contracts.
8. **Source sync outside the page** — `SourcesPage` owns collect, lease, heartbeats, and a
   40-line log in React state. Run that loop beside `auto-ingest.ts`.

---

## UI

1. **One component vocabulary** — Most screens use `shared/ui/primitives`; shadcn is partial.
   Standardize dialogs, tables, forms, and focus rings on shadcn wrappers with the intel theme.
   One page-title treatment: only four pages use `PageTitle` (Taxonomy, Spec Engine, Settings,
   Evaluation) while Briefing, Catalog, Dossier, Feed, Spectrum and Counterparts roll their own
   `<h1>`, and Spectrum's tracked mono title is the outlier.
2. **Command palette** — Replace the hand-rolled ⌘K modal with `cmdk`: search systems, dispatches,
   sources, and queue candidates; jump to routes (`/intake?draft=…`); actions (sync sources, open
   tier-2 queue). Group hits, show recent items when the query is empty, and move the list with
   the arrow keys. Back it with the name index in Code, not a full `droneHaystack` scan.
3. **Navigation IA** — Eleven flat header links are hard to scan. Group into Intel / Catalog /
   Curation / System, or use the existing sidebar component on large breakpoints.
4. **Dense data views** — Catalog now defaults to a compact row with a cards toggle, and Feed has a
   sticky header. Still open: row selection and bulk triage, and lifting the duplicate groups out
   of the filter sidebar.
5. **Semantic status styling** — `--warning` and `--success` exist and `Tag` has the tones, but
   the mapping is per screen. Map dispatch status, sync health, confidence, and provider state to
   one badge system.
6. **Spectrum as a frequency axis** — The section is titled “low → high” and renders a grid of
   segment cards. System names are spans, so a jammer or a drone cannot open its dossier. Draw
   one axis and link each chip to `/systems/$id`.
7. **Evidence inside the source text** — The dossier marks a disputed spec on both the phone card
   and the desktop table. Still open: highlight `claim.evidence` inside the dispatch text, so the
   quote is read in its own sentence.
8. **Small charts on the existing dark theme** — A seven-day sparkline is on each Catalog row.
   Extend that, still flat and mono: a per-source posting heatmap on Feed, and a direction marker
   on Briefing spec claims when this week's figure moved. The charts answer "what changed?"; the
   consensus table stays the record.

---

## UX

1. **Shareable analyst state** — Catalog filters and Feed filters are in the URL. Still open: Queue
   pagination is component state.
2. **Storyline: Feed → Queue → dossier** — The Feed row links to the dossier and to the intake
   queue. Still open: say _what happened_ — "merged into X", "queued for review" — on the row
   instead of leaving the outcome inside the collapsed analysis panel.
3. **First-run / no-AI path** — When `!aiConfigured`, explain what still works (heuristic ingest)
   and link to Settings; avoid silent “why is everything tier heuristic?”.
4. **Undo for catalog mutations** — Merge and remove confirm with an impact preview, and a Queue
   discard can be undone. A merged or deleted catalog entry cannot.
5. **Long-running work feedback** — Step labels exist (heuristic → tier 1 → tier 2). Still open:
   elapsed time and a cancel where it is safe.
6. **Keyboard triage, with a preview before deep analysis commits** — Promote, merge, and discard
   are mouse-only, and merge is a `<select>` of every drone. Deep analyze marks the current
   candidate discarded immediately. `j`/`k` to move, shortcuts for the three decisions, a short
   undo, and a side-by-side of the new extraction before it replaces the old one.
7. **Briefing summary that cites its inputs** — Regenerate shipped. Still open: the summary is
   plain paragraphs with no links into the week's reports, and no outlet counts.
8. **Last source run on the row** — The row shows the last sync, the error and the archive
   counts. Still open: the per-run fetched/stored/duplicate counts are derived from the archive
   rather than written onto the source record.
9. **Threshold preview** — Catalog duplicate groups open from the banner. Still open: `autoMerge`
   0.85, `autoPromote` 0.9 and `autoDiscard` 0.25 save without saying how many pending candidates
   would move; show merge / promote / discard counts for the current queue before saving.
10. **Related intelligence, the rest of it** — The rail computes all nine relation types and shows
    on dossier, spectrum, catalog, briefing and feed. Still open: the deep links it emits
    (`/spectrum?focus=`, `/specs?q=&drone=`) do not exist, and Catalog has no “5 systems updated
    this week” link into the Briefing catalog-changes panel.
11. **Spec timeline scrubber** — The dossier "Spec evolution timeline" is a static list. A spec
    needs a horizontal scrubber: hover a date to see the consensus and sources as of that day,
    pin two dates to diff them, and copy the diff. Replay `SpecClaim.date` through `consensus()`.
    `EvolutionEvent` is a prose log (date, kind, description, source) and has no old value, new
    value, or claim id, so it cannot drive the scrubber.

---

## AI and inference

1. **Regression harness** — Wire [extraction-corpus.ts](../src/test/fixtures/extraction-corpus.ts)
   into vitest; optional `LIVE_MODEL=1` job on prompt bumps (`drone-osint-v7` and beyond). The
   corpus is four short English reports, one of them with two systems. Still missing: Cyrillic, a
   post with no system, and a counter-UAS system — the cases the last benchmark actually failed.
   Shipped defaults are Groq `openai/gpt-oss-20b` and `openai/gpt-oss-120b`; the benchmark scored
   the 20b model 2/4, so the live job is what keeps the defaults honest.
2. **Contradiction workflow** — Server adjudication runs, and an analyst can rule on a claim from
   the dossier; the review list lives on `/evaluation`. Still open: a dossier list of the disputed
   specs that still need a person, so the queue of disagreements is where the analyst already is.
3. **Pipeline trace in the product** — The Feed shows the dispatch's `analysis` metadata (engine,
   model, prompt version, escalation reasons) behind "Show analysis". Still open: the
   `PipelineTrace` itself is console-only, and `RawDispatch` has no trace field.
4. **Extraction schema, then one repair** — The proxy sends `response_format: json_object` only, so
   valid JSON missing most keys still becomes an extraction after the tolerant parse. Send the
   extraction schema where the provider accepts it. On schema failure, one repair prompt, then the
   next provider. A partial object should not count as success.
5. **Calibrate confidence from analyst decisions** — Merge, promote, and discard trust the model’s
   own score (0.85 / 0.9 / 0.25). Record those outcomes against the confidence that was shown and
   fit the thresholds from that history. Score specs separately from identity so a sure name
   cannot carry an unsure figure.
6. **Per-tier output cap** — The completion body sets no `max_tokens`. Reasoning models in the
   benchmark wrote on the order of 14k characters and took 45–75s, inside the 90s provider
   timeout. Cap output per tier so one completion cannot occupy the provider slot.
7. **Why this value, on the claim** — The claim sheet shows the claimed value, the evidence quote,
   the model, the engine, the confidence and the full source post. Still open: the tier-1 and
   tier-2 prompts and replies themselves — `PipelineTrace` records engines, escalation reasons and
   counts, not the transcript (see item 3).
8. **Context packaging** — The catalog shortlist is phonetic-and-stem based and capped at 30. Still
   open: chunk very long articles with per-chunk attribution, an alias index to cut wrong
   `matchId` and unnecessary tier-2 spend, and optional conditional pre-translate for non-Latin
   before extract (Queue Translate is manual today).

---

## Quick wins (high leverage, small surface)

| Idea                                           | Touches                                      |
| ---------------------------------------------- | -------------------------------------------- |
| Wire extraction corpus tests                   | `src/test/`, prompt JSON                     |
| `ExpandableText` shared component              | `intake-page`, `dispatches-page`             |
| `PIPELINE_TRACE` summary in Feed UI            | `pipeline.ts` persistence, Feed              |
| “AI not configured” banner                     | `services.tsx`, `app-shell` or Settings link |
| Cap completion tokens per tier                 | `ai-proxy.server.ts`                         |
| Last source run on the row                     | source record, `sources-page.tsx`            |
| Catalog "updated this week" → Briefing changes | `catalog-page.tsx`, briefing catalog changes |
| `lang` field on `RawDispatch` at collect       | `auto-ingest.ts`, dispatch types             |

---

## Ingestion — make collection and the queue smarter

Ideas for **stage 1** (fetch → `pending` dispatch) and **pre-model** enrichment. Today: parallel
fetch with host pooling (`fetch-posts.ts`), Readability bodies (`article.server.ts`), platform
filters (`content-filters.ts`), SimHash dedupe, `DRONE_HINT` + `buildCatalogPattern` relevance,
then `processPending` with leases. Build on that rather than replacing it.

### Collection quality

1. **Language tag on every dispatch** — Detect script (Latin / Cyrillic / mixed) at ingest and
   store `lang` on `RawDispatch`. Use it to pick filter packs, heuristic fact modules, and
   optional pre-translate — without reintroducing fetch-time English-only drops (removed from
   Telegram for good reason).
2. **Per-outlet parser profiles** — Readability is the default, but some sites need a named
   profile: selector for article root, strip known paywall/chrome, or “index page → follow first
   N article links only”. Register on `MonitoredSource` (or `007_source_endpoints` metadata) so
   Militarnyi vs TWZ vs GitHub releases do not share one strategy.
3. **Structured blocks before the model** — When Readability returns HTML-ish structure, preserve
   headings and list items as markdown sections in `dispatch.text`. Specs in bullet lists and
   infobox-like tables are easier for both heuristics and the model than one flat paragraph.
4. **PDF and attachment lane** — Think-tank and MoD PDFs: extract text server-side (`pdf-parse` or
   a document API), one `FetchedPost` per PDF, same `FetchedPost` contract as RSS.
5. **Unicode-normalize before SimHash** — Whitespace and punctuation are already collapsed; NFKC is
   not, so “same story, different quotes/hyphens” still dedupes less reliably than it should.
6. **Thread-aware Telegram** — Group replies/forwards under a parent message id when the preview
   HTML exposes it; optionally ingest threads as one dispatch with quoted context separated by
   `---` so attribution sees who said what.
7. **Entropy and length gate** — Cheap pre-filter: skip posts under N words or with extreme
   punctuation/emoji ratio before they consume relevance checks (distinct from “irrelevant” —
   mark `low_signal` so Feed does not look like a failed fetch).
8. **Fetch metadata on the row** — Store `contentLength`, `readabilityScore` (or “fell back to
   anchors”), and `fetchProfile` on the dispatch for Sources diagnostics (“this outlet always
   yields teasers”).

### Relevance and prioritization

9. **Tiered relevance** — **Primary** triggers: catalog pattern, known system designation regex,
   counter-UAS names. **Secondary** triggers: RF/EW vocabulary only count if a primary hit exists
   in the same post (cuts “GPS jamming in city X” with no system). Today the two are one OR, and
   `DRONE_HINT` mixes RF/EW vocabulary into the primary trigger.
10. **Source language hints** — `MonitoredSource.notes` exists but does not bias the keyword lists;
    `DRONE_HINT` hardcodes Cyrillic tokens instead.
11. **Learned irrelevance from auto-discard** — Names the pipeline discards repeatedly (already in
    auto-triage learned negatives) can also downgrade future fetch priority for that outlet, not
    only block auto-promote.
12. **Cadence by yield class** — Fast and slow lanes by yield already exist (`entities/source/cadence.ts`):
    a source that never produced a drone post goes to the hourly lane. Still open: “produced tier-2
    escalations → fast lane” is not a criterion, so any source with one relevant post keeps the
    fast lane.

### Queue and processing ergonomics

13. **Segment long dispatches in the worker** — Before `runTwoTier`, split on `\n\n` or headings
    over a char budget; run heuristic per segment; merge extractions with segment ids for
    traceability. Reduces “spec from paragraph 1 attributed to system in paragraph 4”.
14. **Two-phase queue drain** — The heuristic runs first inside `runTwoTier`, per post. A real
    pass A over the whole queue — heuristic only, marking obvious irrelevant or duplicate-in-text —
    before any model budget is spent would save provider RPM on busy sync days.
15. **Ingest regression fixtures** — The platform parsers are covered by inline HTML snippets in
    `src/test/fetch-posts.test.ts`. Move them to golden files under `src/test/fixtures/fetch/`
    (Telegram block, WordPress RSS, Readability article) so a parser change cannot silently empty
    a feed.

---

## Heuristics engine — modular, multilingual, sharper

Today’s engine is already split: `src/shared/infra/heuristics/` (names, facts, pricing, regex
cache and per-class extractors) plus per-language lexicons in `src/shared/lexicons/`
(en, uk, ru, sv). `heuristic-ai.ts` is the adapter: it holds `scan()`, the confidence formula and
`contextForSystem()`. It does a lot well — token-safe `mentions()`, `detectNames()` /
`resolveSystems()` with phonetic catalog match, **per-clause** context splitting (also on line
breaks) for multi-system specs, lexicon-driven measure regex, and **language-grouped magnitudes**
for prices. Tier 1 and tier 2 differ only by a `deep` confidence bump in `scan()` — room to grow
without touching the AI contract (`IntelExtractor`).

### Language-specific layers

1. **Counter-UAS cues** — Range, speed and warhead cue phrases exist per language. The
   counter-UAS side is partial: “перехоплення” appears only inside “дальність перехоплення”, and
   there is no “збиття” or “РЭБ” cue. Add packs incrementally; run the same `measure()` helper
   with different cue patterns.
2. **Extend the magnitudes** — Polish (`mln`, `mld`), German, Turkish as sources appear; keep
   longest-first flattening (already documented in code) when adding tokens.
3. **Language-specific STOP and title-line rules** — Cyrillic month stopwords are in, but
   `isTitleLine()` matches only ASCII capitals, so an all-caps Cyrillic headline is still read as
   body prose.
4. **Do not broadcast document RF** — When `systems.length > 1`, document-level `rfBands` on the
   root extraction can mislead; prefer per-slice bands only (partially done — the root extraction
   still carries all specs and bands).
5. **Per-spec confidence** — Replace one global `confidence` with heuristics: catalog match +
   high-quality evidence substring → higher; guessed domain/origin from a single keyword → lower.
   Feeds escalation gates and auto-triage more honestly.
6. **Table and list rows** — Detect markdown/plain tables (`|`, aligned columns) and attribute a
   row to the system named in the first column.
7. **Negative patterns registry** — Data file of headline false positives (munition names, operation
   codenames, unit designations) merged with `CAPABILITY_ADJECTIVE` and `STOP`; version in repo,
   not hardcoded strings only.
8. **Windowed context, not only clauses** — `contextForSystem` splits on `.!?;` and on line breaks.
   Some outlets use em-dashes or colons. Also take ±N characters around each `mentionsName` hit and
   union overlapping windows before `extractFacts(local)`.
9. **Paragraph-level primary subject** — First-mentioned system in a paragraph gets facts found
   there unless another name appears in the same sentence (simple “closest name wins” baseline
   before any ML).
10. **Component graph** — `components[]`, `payloads[]` and `sensors[]` are fed from the extractor
    already. Still open: the common OSINT phrasings (“fitted with …”, “based on … chipset”, “uses
    … autopilot”) are not recognised as such.
11. **Negative observation** — The pipeline checks that a spec’s evidence occurs in the post before
    merge or promote. The observation arrays are not covered: a payload or sensor name with no
    quote in the post still reaches the catalog, and a spec with neither `evidence` nor `raw`
    passes the check.

### Tier 1 vs tier 2 heuristic (make “deep” mean something)

12. **Tier 1 = screen** — Names + catalog match + “any specs?” boolean + relevance hints for gates;
    skip expensive regex passes when no names detected.
13. **Tier 2 = full parse** — All fact modules, multi-system attribution, counter-UAS block, higher
    recall regex set (accept more false positives; AI tier still validates).
14. **Observations-only mode** — Output explicit `metadata.heuristicObservations` list for the
    model prompt (already passed as JSON context) with stable ids so the model can confirm/reject
    each line.

### Feedback and quality loop

15. **Analyst corrections as training data** — When an analyst changes `matchId` or drops a spec
    on promote, log (anonymized) pattern → decision for future STOP/negative lists (opt-in). The
    verdict is stored on the claim today; the pattern → decision log is not.

### Interaction with ingestion

16. **Run language detection once in ingest** — Heuristic loads the language pack based on the
    dispatch tag, not a full-text guess every time.
17. **Pre-segmented text from ingest** — If stage 1 stores sections, heuristic runs per section
    then merges — same contract as idea “Segment long dispatches” above.

---

## Ingestion ↔ heuristics quick matrix

| Ingest idea                         | Heuristic idea that pairs with it                       |
| ----------------------------------- | ------------------------------------------------------- |
| Language tag on dispatch            | Per-language fact packs and STOP lists                  |
| Structured markdown body            | Table/list row attribution                              |
| Segment long dispatches             | Windowed `contextForSystem` per segment                 |
| Tiered relevance                    | Tier 1 heuristic screen before model                    |
| Fetch metadata (`readabilityScore`) | Down-rank or skip deep regex when body is headline-only |
