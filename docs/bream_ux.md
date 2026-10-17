# Bream UX — Best Ideas for Making DRONE//INT the Best OSINT App Out There

Scope: UI/UX only. Backend, ingest, and model logic are assumed to keep improving underneath. The goal is to make the app feel like a **serious OSINT cockpit**: dense but legible, auditable, analyst-paced, and trusted enough that an intelligence user would choose it over spreadsheet + wiki.

Current surfaces taken as the baseline: `Briefing (/)`, `Catalog`, `System Dossier`, `Counterparts`, `Spectrum`, `Queue`, `Feed`, `Sources`, `Spec Engine`, `Taxonomy`, `Settings`, plus the `DRONE//INT` shell with the `⌘K` search modal.

---

## 0. Core thesis: what “best OSINT UI” means here

1. **Provenance is the product.** Every number on screen is a claim with a source; the UI should make that inseparable, not a secondary “show details” toggle.
2. **Analyst time is the scarce resource.** Surfaces should reduce hops: evidence beside the number, dossier beside the feed row, comparison beside the spec, and “next best fact” without leaving the page.
3. **Handle ugly truth.** Disputed specs, stale sources, failed fetches, no-AI modes, and low confidence are first-class states, never hidden behind success styling.
4. **Two modes, one shell.** A _monitoring_ mode (briefing, feed, spectrum) should scan fast; an _analysis_ mode (dossier, counterparts, spec engine) should let you dwell and compare. Same theme, different density.
5. **Audit by default.** Who saw what, when it changed, which report, which model, and which threshold led to a decision should be replayable.

---

## 1. Information architecture and navigation

### 1.1 Group the flat nav

Current header has ten equal links. Group them into a persistent cluster with one visual home each:

- **Monitor**: Briefing, Feed, Sources, Queue
- **Catalog**: Catalog, System Dossier (contextual), Taxonomy
- **Analysis**: Counterparts, Spectrum, Spec Engine
- **System**: Settings

On desktop, use the existing `components/ui/navigation-menu` pattern with hover-revealed sections instead of a single row. On mobile, keep the drawer but add section headers and counts (“Queue (14)”).

### 1.2 Persistent “watchlist / pinned systems”

Analysts care about a handful of systems during a shift. Add a collapsible left rail (`resizable-panels` is already a dependency) containing:

- pinned dossiers,
- currently focused spec or RF band,
- unread candidate count,
- last sync time.

Make it hideable; remember width in `localStorage`.

### 1.3 Page-level context crumbs

Each page should show where you are in the workflow: `Feed → Event #42 → Shahed-136 (disputed range) → Spec Engine`. Breadcrumbs reduce the “where am I” cost that flat top nav causes.

### 1.4 Route deep links everywhere

Extend URL state beyond Feed/Intake/Counterparts. Add at least:

- `/catalog?q=&domain=&origin=&sort=`
- `/dossier view with #specs, #rf, #events, #counterparts fragments`
- `/spectrum?focus=<band or system>`
- `/specs?q=&drone=&attr=&status=disputed`
- `/feed?status=&source=&event=`
- `/queue?view=dense&sort=confidence`

This makes findings shareable and embeddable in reports.

### 1.5 Command palette that acts like an analyst tool

Replace the current `⌘K` modal with `cmdk` (already installed). Features:

- fuzzy search across drones, dispatches, sources, queue candidates, and recent pages,
- actions: “Sync sources now”, “Open dossier”, “Run deep analysis on candidate”, “Jump to Settings > thresholds”,
- empty state shows recents + “newly updated this week”,
- arrow keys, Enter, Esc,
- result rows show type icon, secondary meta, and destination path,
- keyboard hint tooltips in every list (`j/k`, `/`, `?` help overlay).

### 1.6 Tabs for dense pages

Briefing, Dossier, and Counterparts should use shadcn `tabs` internally to swap panes without route changes:

- Dossier tabs: Identity, Specs, RF/links, Components, History, Claims, Counterparts.
- Briefing tabs: Summary, New systems, Spec changes, Top reported, Latest reports, Catalog changes.

This keeps the top nav stable while letting the analyst drill.

---

## 2. Theming, density, and visual language

### 2.1 One component vocabulary

Everything should pass through `shared/ui/primitives` + shadcn wrappers in the intel theme. Pick one canonical style:

- headers: `font-mono uppercase tracking-widest` for app chrome only (not body text),
- one page-title treatment across all pages,
- one focus ring (`ring-2 ring-primary/60 ring-offset-2 ring-offset-background`),
- one disabled style,
- one empty state.

Spectrum’s divergent padding (`max-w-7xl` inside `AppShell`) should be removed so pages don’t double-nest.

### 2.2 Density toggle

Add a global `Compact / Comfortable / Analyst` density setting:

- Compact: 22px rows, 10px text, no card padding.
- Analyst: data tables with sticky headers, 32px rows, inline badges.
- Comfortable: current card/list style.

Apply via a `data-density` attribute on `html` and Tailwind variants.

### 2.3 Semantic status palette

Define and actually use status tokens:

- `disputed` = red/amber with pulse dot,
- `pending` = slate,
- `auto-merged` = green muted,
- `failed` = red,
- `stale` = amber,
- `unverified source` = orange,
- `outage` = orange with icon.

Badges should combine color + icon + label; never color alone (accessibility).

### 2.4 Typography for numbers

All numeric values, confidence, counts, dispatch IDs, source timestamps: `font-mono tabular-nums`. Spec values should right-align in tables. Use ` Intl` formatting for large numbers.

### 2.5 Motion budget

- No layout shifts for live sync updates; use subtle fade (120ms) and number morph.
- Keep skeleton loaders that match final layout.
- Disable animations when `prefers-reduced-motion`.

---

## 3. Evidence and provenance UX (make it the differentiator)

### 3.1 Inline evidence highlighting

In any spec or dossier view, the cited evidence should be highlighted inside the dispatch/sentence:

- quote rendered as a chip with `“…range 800 km…”` and hover shows full sentence,
- clicking jumps to the Feed dispatch and scrolls/highlights the span,
- disputed specs get a persistent left-border marker on every view (row, card, chart).

### 3.2 Claim ledger on dossiers

Each system dossier should have a Claims tab:

- every claim with value, unit, source, date, model, confidence,
- filter by attribute, source, confidence, disputed,
- sort by recency, consensus weight, confidence,
- group by attribute with a small consensus band at top,
- expand to show tier-1/tier-2 rationale when persisted,
- “copy citation” produces analyst-ready text: value + source link + retrieval date + pipeline version.

### 3.3 Evidence quality badges

For each claim:

- `quoted in source`, `paraphrased`, `derived`, `imported reference`,
- `model-extracted`, `heuristic`, `manual analyst`,
- freshness (days since source).

These should be filterable in the Spec Engine.

### 3.4 Source reliability overlay

Sources should carry a reliability/track-record panel:

- yields, post quality, promotion history, false positives,
- last fetch + counts,
- a mini sparkline of relevance ratio over the last N ticks.
  This makes “this figure comes from a low-yield source” visible without opening Settings.

### 3.5 Dispute ribbon

Disputed specs should show a persistent ribbon with:

- number of sources disagreeing,
- spread (min/max),
- date range of claims,
- link to a dispute drawer where the model’s adjudication rationale and “mark supported” actions live.

---

## 4. Briefing page

### 4.1 Make the briefing genuinely scannable

- top row: 4 KPI tiles (`New systems`, `Spec changes`, `Reported systems`, `Queue candidates`) with delta arrows and time ranges,
- each card links to the corresponding panel/filter,
- executive summary as an expandable block at top, with system names and outlet counts as links to dossier/feed,
- “Regenerate now” button with progress (heuristic → tier 1 → tier 2) and disabled state with reason,
- timestamp of last generation + provider/model used.

### 4.2 Direction markers on claims

When a figure moved this week, show ▲/▼ next to it with delta (e.g. `800 → 950 km`) and click to see which claims changed it.

### 4.3 Watchlist merge

Let users pin systems to the briefing: “changes for my systems” strip at top, and “systems I track went quiet”.

### 4.4 Briefing as artifact

- “Copy markdown briefing”,
- “Export PDF” with charts,
- “Share link” to a frozen briefing snapshot (read-only).

### 4.5 Honest AI state

When AI is unavailable, show a banner explaining what the briefing can and cannot contain, and link to Settings. Do not imply AI-generated content when it is heuristic-only.

---

## 5. Catalog page

### 5.1 Default compact row

Default view should be a dense table:
`Name | Cyrillic | Origin | Domain | Consensus figure | Updated`
with an optional card toggle. Filters in a left rail, not a sidebar soup.

### 5.2 Duplicate groups made visible

Lift duplicate groups (catalog dupes, alias matches, shared Wikidata) out of the filter sidebar into a dedicated “Needs merge” rail with counts and quick actions.

### 5.3 Sort, pin, multiselect

- sortable columns including “most reported this week”, “last updated”, “confidence”,
- row selection for bulk actions: tag, merge review, add to watchlist, export,
- bulk actions bar at bottom when rows selected (sticky).

### 5.4 Micro-charts on rows

30-day report-frequency sparkline per system; hover shows dates and counts.

### 5.5 Quick-open dossier

Entire row clickable to dossier; secondary button opens in new tab (modifier click). Keep an “open in graph” icon.

### 5.6 Facet URLs + saved views

Catalog filters persist to URL and can be saved as named views: “My watched Shaheds”, “Disputed RF”, “New this week”.

---

## 6. System dossier

### 6.1 Sticky dossier header

A top mini-header within the dossier:

- name, Cyrillic, aliases, origin, domain, manufacturer,
- confidence/last-seen badge,
- quick actions: pin, compare, share, delete (with undo/impact preview),
- tabs beneath.

### 6.2 Spec evolution scrubber

Replace the static “Spec evolution timeline” with a horizontal Scrubber:

- hover a date shows consensus and sources as of that day,
- pin two dates for diff with copy diff,
- disputed markers on timeline,
- replay `SpecClaim.date` through `consensus()`.

### 6.3 Related intelligence rail

A right rail computing “next best fact” as pure function over data:

- counterparts sharing RF band,
- disputed specs linked to Spec Engine filtered,
- systems in same dispatch event,
- variant lineage,
- shared components/operator,
- “3 dispatches this week” link.

### 6.4 Counterpart and RF chips

Chips that link directly to `/counterparts?a=&b=` or `/spectrum?focus=`.

### 6.5 Delete safety

Confirm destructive deletes with `removalImpact` preview and optional 10s undo toast; explain “it won’t be auto-promoted again”.

### 6.6 Evidence map per system

A compact table: source → claim → value → date, with one-click jump to feed and highlight.

---

## 7. Counterparts page

### 7.1 Visual comparison first

Instead of lists, use a side-by-side envelope comparison:

- two selected systems,
- EW and kinetic metrics as aligned bars/ranges,
- RF band overlap highlighted,
- “who sees whom first” and “who can jam whom” markers.

### 7.2 Graph of relationships

Force-directed or layered graph:

- nodes: systems, variants, counterparts,
- edges: variant-of, adversary-of, shared RF, shared component,
- click opens dossier,
- filters by domain, relationship type, confidence.

### 7.3 Pair suggester

Suggest candidate counterparts based on:

- similar RF signatures,
- similar envelope (range/endurance/speed),
- shared Wikidata origin or manufacturer,
- manual link with reason.

### 7.4 Compare more than two

Allow 3–4 systems in a comparison matrix with spec rows; export to CSV/markdown.

---

## 8. Spectrum page

### 8.1 Real frequency axis

Don’t render cards by category. Draw one horizontal frequency axis with:

- jammer blankets and drone links as lanes/bands,
- clickable chips linked to `/systems/$id`,
- RF band overlap tooltips,
- fiber-immune links visually distinct,
- zoom and pan, keyboard navigation.

### 8.2 Band details drawer

On click, drawer shows:

- systems in band,
- jammers in band,
- gaps and overlaps,
- “open counterpart pair” links.

### 8.3 Compare scenarios

Toggle between “as reported” and “normalized/consensus” bands; highlight conflicting claims.

---

## 9. Queue / Intake page

### 9.1 Keyboard triage mode

- `j/k` move selection,
- `p` promote, `m` merge, `d` discard,
- `e` expand evidence,
- `u` undo last action (short-lived),
- queue counter and progress bar,
- bulk triage selection.

### 9.2 Preview before deep analysis commits

Deep analyze should not mark current candidate discarded immediately; show side-by-side extraction diff with accept/reject.

### 9.3 Merge UX

Merge is currently a `<select>` of every drone. Replace with:

- suggested matches on top with score,
- searchable popover,
- “create new” fallback,
- compare current extraction to target dossier before merge.

### 9.4 Triage confidence and impact

Show why an action is suggested:

- confidence, auto-promotion guards, outlet track record,
- “this name has been discarded 3 times from different outlets”,
- “2 independent outlets corroborate”.

### 9.5 Long-running feedback

Deep analysis, sync, briefing need:

- step labels (heuristic → tier 1 → tier 2),
- elapsed time,
- cancel where safe,
- failure reason and retry.

### 9.6 Paste UX

- drag-and-drop file/text,
- URL preview fetch indicator,
- duplicate detection before submit,
- language detection indicator,
- “deep analysis” toggle visibly changes expected cost/time.

### 9.7 Candidate context

Each candidate row should show:

- source + outlet reliability,
- match candidate dossier link,
- disputed specs already in system,
- similar candidates grouped,
- age-out countdown.

---

## 10. Feed page

### 10.1 Outcome on the row

Every dispatch should show outcome prominently:

- merged into X,
- promoted X,
- queued Y,
- discarded,
- irrelevant,
- duplicate → canonical,
  with one-click links to dossier/system and Queue.

### 10.2 Dispatch drawer

Clicking a row opens a drawer instead of expanding inline only:

- full text with highlighted evidence spans,
- metadata (engine, model, prompt version, escalation reasons),
- event cluster link,
- outcome/actions,
- translate button.

### 10.3 Filtering and saved views

- filter by status, source, event, language, outcome type, date,
- saved views and per-source presets,
- URL query sync,
- text highlighting in search.

### 10.4 Event clustering view

Switch Feed between “rows” and “story events”:

- event card with outlets, first seen, latest, key systems/specs,
- “outlets covering” avatars,
- canonical link.

### 10.5 Per-dispatch fetch metadata

Show content length, readability fallback, fetch profile, readability score; useful for diagnostics.

### 10.6 Batch triage from Feed

Select dispatches and send to queue or mark irrelevant in bulk.

---

## 11. Sources page

### 11.1 Last run on the row

Persist fetched/stored/duplicate counts + last error on source, not just UI log. Row shows:

- status pill,
- last fetched,
- fetched/stored/duplicates,
- silence indicator,
- pause/off reason.

### 11.2 Source profile health

- sparkline of yield,
- reliability score breakdown,
- edit profile (parser, URL, cadence),
- “test fetch now” with preview.

### 11.3 Group by platform

Tabs or grouped lists for Telegram/RSS/web/X; platform-specific empty states and setup hints.

### 11.4 Sync log as artifact

Keep the 40-line log but persist recent runs; searchable, copyable, and linked to dispatch IDs.

### 11.5 Silent-platform alert

When most proven sources of one platform go silent, show a named alert and “likely parser drift”.

### 11.6 First-run / no-AI path

When no AI provider is configured, show a banner: what still works (heuristic ingest), and direct link to Settings. Avoid silent “why tier heuristic?” confusion.

---

## 12. Spec Engine and Taxonomy

### 12.1 Spec Engine as matrix

- systems × attributes matrix with consensus/dropout states,
- filter by disputed, confidence, source, category,
- inline evidence on hover,
- “why this value?” drawer with consensus inputs and claim list.

### 12.2 Attribute lifecycle

Show status: observed → normalized → promoted → disputed → resolved; manage unknown attributes with clear ownership and sample values.

### 12.3 Taxonomy

- clusters of unknown terms with examples and suggested canonicals,
- one-click promote/map,
- per-term usage count and trend,
- “terms added this week”.

### 12.4 Dispute management

Dedicated “Disputed specs” queue:

- system, attribute, claim range, sources,
- model adjudication result and rationale,
- analyst can mark supported claim / keep unresolved,
- links to dossier and Spec Engine filtered.

---

## 13. Cross-page “related intelligence” system

Build a pure function over drones, dispatches, claims, counterparts, RF data. For any entity, compute ranked short list of:

- counterpart sharing RF,
- jammer/drone exposure,
- disputed spec,
- same dispatch event,
- variant lineage,
- shared component/operator/Wikidata,
- updated this week.

Render as compact links rail on dossiers, feed rows, spectrum selections, catalog rows. This is one of the highest-leverage UX improvements for analyst flow.

---

## 14. Search, filtering, and query UX

### 14.1 Shared filter components

Create one `FacetFilterBar` with chips, counts, URL sync, and “clear all”. Reuse in Catalog, Feed, Spec Engine, Queue.

### 14.2 Multi-field quick search

Search input interprets prefixes:

- `name:`, `source:`, `band:`, `spec:`, `status:`, `country:`
  with autocomplete and visual tokens.

### 14.3 Saved searches and alerts

Let analysts save named filters and optionally get “new matches since last visit” badge in nav.

### 14.4 Fuzzy + Cyrillic aware

Name search must respect existing name-key normalization (Cyrillic transliteration), not just Latin substring.

---

## 15. Analyst ergonomics and precision

### 15.1 Keyboard-first everywhere

Publish a single “Keyboard shortcuts” help overlay (`?`) and consistent shortcuts across pages:

- navigation: `g b`, `g c`, `g f`, `g q`, etc.
- search `/`, palette `⌘K`,
- j/k in lists, Enter open, Space select,
- triage keys in Queue.

### 15.2 Undo and recovery

- short-lived undo for merge/discard/delete/promote,
- show “Action undone” with context,
- audit trail records action + analyst + timestamp (even local),
- undo disabled after dependent actions.

### 15.3 Hover cards for dense entities

Hovering a system name should show a mini dossier card: origin, domain, one consensus figure, updated, last source. `hover-card` already exists.

### 15.4 Copy and export

- copy link, copy citation, copy markdown,
- export table CSV,
- export dossier PDF with claims and sources.

### 15.5 Confirmations with impact

Destructive actions show impact preview (affacted claims/candidates) and optional dry-run count before commit.

### 15.6 Threshold preview

Settings thresholds should show how many current queue items would move under new values before saving.

### 15.7 Analyst notes

Allow private notes on systems, candidates, dispatches, and claims with timestamps. Keep them separate from claims.

---

## 16. OSINT visualizations (needed to be “best out there”)

Prioritize flat, mono-theme visuals that answer “what changed?”:

### 16.1 Geospatial (new capability)

- map of reported activity by system/country over time,
- operator coverage,
- events plotted from dispatch metadata where location exists,
- filter by date range and system,
- cautious UX: clearly mark uncertain locations.

### 16.2 Entity graph

- network of systems, variants, counterparts, components, sources,
- filter by relationship type, confidence, updated range,
- “show me all systems that share RF with X”.

### 16.3 Timeline / event river

- chronological view of events, spec changes, new systems,
- filters by system/source/type,
- click to Feed/Dossier.

### 16.4 RF spectrum

Real axis as above.

### 16.5 Source heatmap

Per-source posting/relevance heatmap over time to show cadence and drift.

### 16.6 Trend sparklines

Small, inline, flat charts on catalog rows, source rows, and spec attributes.

### 16.7 Dispute and confidence charts

- claim spread chart for disputed specs,
- confidence distribution histogram in Spec Engine.

---

## 17. Explainability and trust UX

### 17.1 Pipeline trace in product

Persist full trace on dispatch/candidate and show in Queue/Feed:

- engine, model, prompt version,
- escalation reasons,
- heuristic observations,
- extraction diff by tier.

### 17.2 “Why this value?”

Each spec value should expose:

- heuristic observation,
- tier-1 prompt/reply (when allowed),
- tier-2 adjudication,
- consensus inputs,
- thresholds that accepted it.

### 17.3 Provider honesty

Settings and surfaces should show actual provider/model used for a given operation, fallback chain, cooldowns, and “degraded tier” states.

### 17.4 Model/claim separation

Display AI-derived identity confidence and spec confidence separately. A sure name must not imply sure figure.

### 17.5 Data quality indicators

- completeness score per system,
- missing key fields,
- stale figure age,
- source count and diversity,
- contradiction weight.

---

## 18. Performance, scale, and reliability UX

### 18.1 Windowed reads + virtualization

Catalog, Feed, Queue should virtualize long lists and use paged query instead of loading all rows into memory.

### 18.2 Loading and staleness

- skeletons matching final layout,
- stale-while-revalidate indicators,
- “last updated” per view,
- background refresh on focus when RemoteStore active.

### 18.3 Offline / outage messaging

- no-AI banners,
- source failures grouped by platform,
- retry actions,
- “last successful sync” and degraded mode indicator in shell.

### 18.4 Remote write failure visibility

Toast + Settings banner when Postgres sync fails; retry queue; don’t look saved when not.

### 18.5 Error boundaries that help

Page-level error boundary with “try again” and copy error (already has root); include route context.

---

## 19. Accessibility and internationalization

### 19.1 A11y basics

- all interactive elements focusable,
- visible focus rings,
- keyboard operable tables/drawers/tab lists,
- ARIA labels for icon buttons,
- color + icon + text status,
- reduced motion respected,
- screen-reader-friendly live regions for sync progress.

### 19.2 Language support

- UI labels in English initially but extraction confidence should expose `lang`,
- RTL readiness for future,
- fonts cover Cyrillic/Ukrainian/Russian,
- evidence highlighting must preserve original script.

### 19.3 Time and locale

- relative + absolute timestamps,
- timezone display,
- ISO date on hover.

---

## 20. Onboarding, empty states, and progressive disclosure

### 20.1 First-run tour

Guided tour:

- what heuristic vs AI does,
- how claims work,
- how Queue triage works,
- how thresholds affect auto actions.

### 20.2 Contextual empty states

Each empty page should explain why and what to do:

- no sources monitored,
- no drones yet → suggest import reference catalog,
- no claims for a system → show import/ingest actions,
- no AI → explain degraded mode.

### 20.3 Sample dataset / demo mode

Optional seeded read-only dataset for evaluation and demos.

### 20.4 Inline help

Small “?” popovers next to confidence, consensus, disputed, auto-triage, and cadence explaining behavior in plain language.

---

## 21. Collaboration and sharing (makes it real OSINT)

### 21.1 Analyst identities

Even lightweight local profiles: name, initials, role; actions attributed to an analyst.

### 21.2 Annotations and review queues

- assign disputed specs to analysts,
- “needs review” flags with owner and due date,
- comments on systems/candidates/claims.

### 21.3 Shareable artifacts

- share dossier view links,
- export case file (system + claims + timeline + notes) as PDF/Markdown.

### 21.4 Audit log

Immutable-ish log of changes: source syncs, merges, promotions, discards, setting changes.

---

## 22. Quick wins (highest leverage, smallest effort)

1. Put outcome + dossier/queue links directly on Feed rows.
2. Replace command palette modal with `cmdk`.
3. Group the ten flat nav links into four clusters.
4. Remove double `max-w-7xl` padding in Spectrum.
5. Add density toggle via `data-density`.
6. Make disputed specs visually persistent everywhere (border + icon).
7. Inline evidence with a hover chip and jump-to-dispatch.
8. Keyboard shortcuts + `?` help overlay.
9. Persist catalog/queue/feed filters in URL.
10. Show last fetch counts on source rows.
11. Add “AI not configured” banner with link to Settings.
12. Add undo toast for triage actions.
13. Save and show named catalog views.
14. Add hover dossier cards on system names.
15. Show threshold impact counts before saving Settings.

---

## 23. What not to do

- Don’t build a generic chat assistant UI; this is an evidence tool, not a chatbot.
- Don’t hide low confidence behind “success” colors.
- Don’t add decorative animations that move layout during sync.
- Don’t make tables card-based by default for huge collections.
- Don’t require clicks to see provenance; put it on the row.
- Don’t mix inconsistent page titles and padding; fix the shell first.

---

## 24. Suggested sequencing (12-week)

- **Weeks 1–2:** Shell/nav cleanup, command palette (`cmdk`), density toggle, semantic status tokens, disputed styling everywhere, evidence chip.
- **Weeks 3–4:** URL state for filters, Feed outcome links, Source last-run row, remote-write failure toasts, AI-not-configured banner.
- **Weeks 5–6:** Dossier scrubber, claims ledger, related-intelligence rail, hover cards.
- **Weeks 7–8:** Keyboard triage mode + preview-before-commit + merge UX.
- **Weeks 9–10:** Spectrum frequency axis, counterpart graph/comparison matrix, catalogs compact table.
- **Weeks 11–12:** Geospatial + entity graph pilots, trend sparklines, dispute management queue, onboarding tour.

---

## 25. Success measures

Track these as the UX improves:

- median time from Feed row to dossier with evidence highlighted (target < 2 sec interaction),
- triage actions per minute in Queue (target up),
- share of disputed specs resolved without extra clicks (target up),
- number of “where did this number come from?” support questions (target down),
- user-reported trust in heuristic-only mode (survey),
- catalog views saved and reused (engagement).

---

_These ideas are intentionally product-level and prioritize analyst flow, auditability, and provenance. They can be routed into `docs/roadmap.md` once accepted, with the implementation-focused ones kept there and the UX-specific ones summarized back here._
