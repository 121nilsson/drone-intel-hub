# flint_ll_alpha.md — UI/UX ideas

Top-notch UI/UX improvement ideas for the drone OSINT app, drafted against the current tree
(Briefing, AppShell, Queue, Dossier, intel graph).

## 1. Analyst cockpit: keyboard triage with decision preview

The core loop is ingest → queue → decide, and today it is mouse-first.

- `j` / `k` move through the queue; `1` / `2` / `3` apply promote / queue / discard.
- Decision badges on cards; `u` undoes the last decision.
- Deep analysis currently marks a candidate discarded immediately — add a preview step
  (side-by-side new extraction vs current) before anything commits.

## 2. Briefing becomes the tactical pulse

`/` is the home, but today it is a report archive rather than a pulse.

- Add a "right now" strip above the panels: top movers by 7-day report delta, open disputed
  specs, failing sources, first-seen systems.
- Analysts open the app to answer "what matters right now" — not to read a weekly log.

## 3. Geographic layer

OSINT without a map is half-blind.

- Add a geo surface: reported locations, origin countries, counterpart pairs, RF overlap.
- Route `/map`, or a geo panel in Briefing / Counterparts.

## 4. Relationship graph as a first-class view

The intel graph already computes edges (counterparts, RF overlap, shared component, shared
operator, variant lineage, disputed spec). Render it as a graph view, not just chips.

## 5. Shareable briefings

One-click export of the weekly briefing (print/PDF or markdown snapshot). Analysts forward
briefs without needing the app open.

## 6. Evidence-first reading

- Claims deep-link into source posts with the quote highlighted.
- Disputed claims get persistent markers.
- Per-claim "why this value" panel: heuristic observation → tier prompts → consensus.

## 7. Command palette as command surface

Upgrade the hand-rolled ⌘K to `cmdk`: systems, dispatches, sources, actions; recents;
grouped results; keyboard nav; backed by the name index.

## 8. Temporal intelligence

- 30-day sparklines on catalog rows; per-source posting heatmap on Feed.
- Direction markers on briefing spec claims; spec timeline scrubber.

## 9. Operational chrome

- AI/provider status in the shell, sync health on rows, long-running work feedback
  (steps, elapsed, cancel).

## 10. Polish system

One component vocabulary, focus rings, empty states, skeletons, responsive tables → cards,
bulk triage, semantic status styling.
