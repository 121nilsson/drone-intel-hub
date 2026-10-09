# Drone Intel Hub — Improvement Roadmap

> [!NOTE]
> This document focuses on two themes: (1) getting more signal out of the open web,
> and (2) mapping relationships between systems so the catalog can reason about
> what it knows rather than just storing it.

---

## 1. Richer Open-Web Ingest

### 1.1 Expand Source Coverage

The current fetcher ([`fetch-posts.ts`](src/shared/infra/fetch-posts.ts)) handles Telegram channels, RSS/Atom feeds, and generic web scraping. Many high-signal open sources are not yet covered:

| Source Type | Examples | Priority |
|---|---|---|
| **Reddit threads** | r/WarInUkraine, r/ukraine, r/geopolitics | High |
| **Twitter/X** | Requires paid API — worth budgeting for | High |
| **YouTube transcripts** | OSint channels (e.g. Defense Express) via caption API | Medium |
| **Academic preprints** | arXiv cs.RO / eess.SP for RF/payload advances | Medium |
| **Patent feeds** | USPTO/EPO RSS for new drone tech from known manufacturers | Medium |
| **GitHub releases** | Flight-controller firmware tags (Betaflight, ArduPilot) | Low |
| **Procurement portals** | NATO, Ukrainian MoD, US SAM.gov contract awards | High |
| **Sanctions lists** | OFAC, EU, UK updates — flag newly-listed component makers | High |

**Implementation approach:** add a new `platform` variant (e.g. `"Reddit"`, `"YouTube"`) to `MonitoredSource` and a corresponding fetch adapter in `fetch-posts.ts`. Each adapter stays behind the existing `FetchResult` interface, so the pipeline needs no changes.

### 1.2 Structured Article Parsing

The web scraper in `parseWeb()` extracts anchor text only — barely enough. A structured article parser would capture full paragraphs:

- Use **Mozilla Readability** (already a common npm package) server-side to strip navigation chrome and extract the article body before passing it to the pipeline.
- For PDF reports (Jane's equivalents, think-tank PDFs), run **pdf-parse** or call a document-intelligence API.
- Produce a `FetchedPost` per article, not per link — this dramatically increases the semantic density that the `IntelExtractor` receives.

### 1.3 Deduplication Across Sources

Currently `seenIds` is per-source, so the same story crossing from Telegram to RSS to Twitter is ingested three times as three separate candidates. Add a global content-hash fingerprint:

```ts
// Add to FetchedPost
contentHash: string; // SHA-256 of normalised text (lowercase, no punctuation)
```

Store seen hashes in a PostgreSQL table (`seen_content_hashes`) and skip any post whose hash already exists. This reduces noisy duplicates without changing the pipeline contract.

### 1.4 Smarter Relevance Filter

The current relevance check is one regex ([`DRONE_HINT`](src/features/sources/auto-ingest.ts)):

```ts
const DRONE_HINT = /drone|uav|ugv|usv|fpv|shahed|geran|lancet|.../i;
```

This is a single-pass OR gate. Better alternatives:

- **Tiered keywords:** a primary list (system names, "BPLA", "SHAHED") that trigger ingest directly, plus a secondary list ("RF", "frequency", "motor") that only trigger if a primary term is also present.
- **Language detection:** auto-detect Cyrillic vs Latin and apply language-specific keyword sets (Russian военный дрон, Arabic مسيّرة).
- **Entropy score:** posts with very low information density (e.g. a single emoji, a price quote with no context) should be skipped. A simple character-count and word-count gate is cheap and effective.
- **Heuristic confidence pre-screen:** run the `HeuristicExtractor` first (it's free) as a gate. Only call the expensive LLM tier if the heuristic returns `confidence > 0.2`.

### 1.5 Scheduled & Adaptive Polling

Sources are synced on demand or by a single cron. Consider:

- **Per-source sync intervals** stored in `MonitoredSource.syncIntervalMinutes`. High-traffic Telegram channels could poll every 15 minutes; a monthly procurement portal every 24 hours.
- **Backoff on error:** if `lastError` is set, double the interval (up to a max) so transient failures don't spam the server.
- **Webhook / EventSource push** for sources that support it (e.g. Telegram Bot API webhooks) — zero-latency ingest with no polling overhead.

---

## 2. System Relationship Mapping

The catalog stores `counterpartIds` on each `Drone`, but the relationship graph is thin — mostly manually maintained. The improvements below make the system automatically discover and reason about how drones relate to each other.

### 2.1 Automatic Relationship Inference

When the LLM extracts a report, it already returns a `systems[]` array and `variantOf` links. Extend the pipeline to persist these as first-class graph edges:

```ts
// New entity
interface SystemRelation {
  fromId: string;          // drone id
  toId: string;            // drone id
  kind: RelationKind;
  confidence: number;
  source: string;
  date: string;
}

type RelationKind =
  | "variant_of"       // Geran-3 → Geran-2
  | "successor_of"     // Lancet-3 → Lancet-1
  | "intercepted_by"   // Shahed-136 ← Gepard AA
  | "jammed_by"        // Mavic 3 ← Luch EW
  | "component_of"     // Viber-X motor → Shahed-136
  | "operates_alongside" // seen in same mission report
  | "manufactured_by"; // supply chain
```

Add a `relations` table in a new migration:

```sql
create table if not exists system_relations (
  id          text primary key,
  from_id     text not null references drones(id),
  to_id       text not null references drones(id),
  kind        text not null,
  confidence  real not null default 0,
  source      text not null,
  created_at  timestamptz not null default now()
);
create index on system_relations (from_id);
create index on system_relations (to_id);
create index on system_relations (kind);
```

**Populate from:** the `systems[]` extraction field (already present — just not persisted as graph edges), analyst annotations, and the counterpart page (already in the UI).

### 2.2 Graph Traversal for Counterpart Suggestions

Currently, [`counterparts-page.tsx`](src/features/counterparts/counterparts-page.tsx) lists counterparts that are manually linked. With the graph:

- **1-hop:** direct relations (variants, successors, interceptors).
- **2-hop:** "drones that this drone is often seen alongside also tend to be countered by X".
- **Influence clustering:** systems that share origin + component + RF-band cluster together — useful for tracking families (all Shahed variants, all Lancet variants) and recommending links.

Implement a `RelationRepository` behind the same `DocumentStore` contract so the graph is DB-agnostic.

### 2.3 Shared Attribute Similarity Scoring

Two drones may be related without ever being explicitly mentioned together. Use spec similarity to surface hidden connections:

- **RF band overlap:** two systems sharing the exact same uplink + video frequencies are very likely from the same design family or supply chain.
- **Propulsion fingerprint:** matching motor KV + wingspan + MTOW is a strong variant signal.
- **Component origin clustering:** systems sharing ≥ 2 supply-chain components (same manufacturer + part) are almost certainly related.

Run this as a background job that writes low-confidence `relation` edges for human review. A simple cosine similarity over normalised spec vectors is enough to start.

### 2.4 Temporal Evolution Linking

The `evolution[]` array tracks changes per drone, but there is no cross-system timeline. Add a **cross-system event timeline** view:

- When drone A gets a payload upgrade, check if any other drone in the catalog received the same upgrade within ±60 days. If so, surface a suggested `operates_alongside` or `variant_of` relation.
- Flag when a spec that was unique to one system (e.g. a specific RF frequency) appears on a new system — potential tech transfer or countermeasure bypass.

### 2.5 Confidence Decay & Contradiction Detection

The `SpecClaim` type holds multiple claims per attribute with source + date, but no system evaluates them against each other. Add:

- **Contradiction scoring:** if two sources report wildly different values for the same spec (e.g. range: 50 km vs 200 km), flag it as a disputed claim rather than silently picking the latest.
- **Confidence decay:** claims older than a configurable threshold (e.g. 180 days for operational specs) automatically downgrade their weight in searches and briefings.
- **Consensus display:** show min/max/median across all claims in the dossier, not just the most recent value.

The `consensus.ts` entity already exists — extend it to emit a `disputed: boolean` flag when stddev across claim values exceeds a threshold.

---

## 3. Analytics Improvements

### 3.1 Cross-Catalog Trend Signals

Today the briefing is a one-shot LLM summary. Add structured analytics computed from the raw data:

| Signal | How to compute | Value |
|---|---|---|
| **New system rate** | Count `createdAt` by week | Detect acceleration in new drone types |
| **Domain shift** | % Air/Land/Sea by quarter | Track if adversary pivots from air to maritime |
| **RF band adoption** | Frequency of each band over time | Predict which frequencies will be jammed next |
| **Origin concentration** | Component `origin` distribution | Supply-chain choke-point analysis |
| **Candidate backlog** | Pending vs promoted over time | Pipeline health KPI |

Materialise these as simple SQL views or aggregation queries — no separate analytics DB needed at this scale.

### 3.2 Watchlist & Alerting

Let analysts configure a **watchlist**:

```ts
interface WatchlistRule {
  id: string;
  name: string;
  trigger: "new_system" | "spec_changed" | "new_relation" | "keyword_match";
  filter: { domain?: Domain; origin?: string; specKey?: string; keyword?: string };
  notifyOn: "ingest" | "promote" | "merge";
}
```

On each sync, evaluate rules against the batch and emit in-app notifications (and optionally email/webhook). This turns the hub from a passive catalog into an active intelligence feed.

### 3.3 Source Reliability Scoring

Track per-source accuracy:

```ts
interface SourceStats {
  sourceId: string;
  totalCandidates: number;
  promotedCount: number;      // became new entries
  mergedCount: number;        // enriched existing entries
  discardedCount: number;
  avgConfidence: number;
}
```

Use this to weight LLM extraction — a source with 90% merge/promote rate gets its candidates auto-merged at a lower confidence threshold. A low-accuracy source requires higher confidence before acting. Surfaces which monitored channels are actually worth the API cost.

---

## 4. Data Quality & Schema

### 4.1 Controlled Vocabularies

Several free-text fields (propulsion, origin, operators) lead to duplicates (`"quad"` vs `"quadrotor"` vs `"quadcopter"`). Introduce:

- A `normalise()` step after extraction that maps raw AI output to canonical values.
- Configurable controlled vocabulary lists per field (stored in the DB, editable in settings).

### 4.2 Media & Evidence Attachments

Specs currently cite a source URL string. Link evidence more richly:

```ts
interface SpecClaim {
  value: number | string;
  source: string;
  date: string;
  mediaUrl?: string;   // screenshot, video timestamp, image
  excerpt?: string;    // quoted sentence from the source
}
```

The intake page can let analysts paste a quote alongside the raw report, and the AI can extract `excerpt` automatically from the relevant sentence.

### 4.3 Unified Search With Relation Context

The current `search()` on `DroneRepository` is keyword + facet only. Extend it to:

- Accept a **graph expansion** flag: `search("shahed", { expandRelations: true })` also returns all variants and related systems.
- Rank results by relation proximity to the seed query (BFS depth 1 first, then depth 2).
- This makes the briefing summariser dramatically more context-aware.

---

## 5. Quick Wins (Low Effort, High Impact)

| # | Change | Files affected |
|---|---|---|
| 1 | Increase Telegram fetch limit from 20 to 50 posts | [`fetch-posts.ts`](src/shared/infra/fetch-posts.ts) L32 |
| 2 | Persist `systems[]` edges to `counterpartIds` automatically on auto-merge | [`pipeline.ts`](src/features/intake/pipeline.ts) L25 |
| 3 | Add `contentHash` deduplication across sources | `auto-ingest.ts`, new migration |
| 4 | Expose sync report history in the Sources UI | [`sources-page.tsx`](src/features/sources/sources-page.tsx) |
| 5 | Add `disputed` flag to `SpecAttribute` when claims contradict | [`types.ts`](src/entities/drone/types.ts), `consensus.ts` |
| 6 | Log per-source extraction cost (tokens used) for API spend tracking | [`openai-compatible-ai.ts`](src/shared/infra/openai-compatible-ai.ts) |
