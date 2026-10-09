# Drone Intel Hub — Improvement Roadmap (Round 2)

> [!IMPORTANT]
> This is a corrected and re-sequenced iteration of `improvements.md`, informed by an
> independent code review. Several items from round 1 were inaccurate or overstated.
> Every claim below has been verified against the live source files.

---

## What the First Roadmap Got Right (Confirmed)

Before listing new items, three round-1 findings are fully confirmed and remain top priority:

| Finding                               | Evidence in code                                                                                                                                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `systems[]` graph edges are discarded | [`pipeline.ts:25`](src/features/intake/pipeline.ts#L25) writes `counterpartIds: []` hardcoded; `variantOf` only appears in the intake UI display, never in a write path                               |
| Cross-source dedup is missing         | `seenIds` lives on `MonitoredSource` ([`repository.ts:30`](src/shared/contracts/repository.ts#L30)), so the same headline ingested from Telegram and RSS creates two candidates                       |
| Propulsion is uncontrolled free text  | [`types.ts:49`](src/entities/drone/types.ts#L49) is `propulsion: string`; [`consensus()`](src/entities/drone/consensus.ts) only aggregates numeric claims, so "quad" vs "quadrotor" silently splinter |

---

## Corrections to Round 1

### ❌ Quick Win #1 — Telegram pagination is a no-op

Round 1 suggested bumping `parseTelegram()`'s `.slice(0, 20)` to 50.
The `t.me/s/<chan>` web-preview endpoint only ever renders the last ~20 messages regardless of what the client requests. Changing the slice constant fetches nothing more.

**Correct approach:**

- **Telegram Bot API** (`getUpdates` / `forwardMessages`) is free for bots you control. Wire it as a new `platform: "TelegramBot"` adapter.
- For third-party channels without bot access, scraping deeper requires a headless browser or the paid MTProto API. Neither is a quick win.
- **Drop this item from the quick-win list entirely.**

### ⚠️ §2.5 — `consensus.ts` is not greenfield

Round 1 said "no system evaluates claims against each other" and that the dossier shows "only the most recent value." The code disagrees.

[`consensus.ts`](src/entities/drone/consensus.ts) already computes:

- `min`, `max`, `median` across all numeric claims
- `spread`-based confidence (`high` / `medium` / `low`)
- Distinct source count

What is genuinely missing (and worth adding):

1. **`disputed` flag** — when `spread > 0.5` the claim is contested, but nothing surfaces this in the UI. A simple `disputed: boolean` on `Consensus` is a 5-line change.
2. **Date-weighted confidence** — [`SpecClaim.date`](src/entities/drone/types.ts#L7) is stored but never read by `consensus()`. Older claims should carry less weight in the final `confidence` rating.
3. **String-value agreement threshold** — the current string path picks the modal value and checks if `agree > 0.6`, but there is no `disputed` output for string specs either.

The work is a targeted patch to `consensus.ts` and its callers, **not** a new system.

### ❌ §1.4 — Heuristic pre-screen before Tier 1 is redundant

The round-1 suggestion to "run `HeuristicExtractor` as a gate before Tier 1" doesn't save anything. `HeuristicExtractor` _is_ Tier 1 when no API key is configured ([`fetch-posts.ts:114`](src/shared/infra/fetch-posts.ts#L114)). When an LLM is configured, Tier 1 is already the cheap screening model. Adding a heuristic pre-pass only inserts a third extraction step with no cost saving.

**Correct approach:** the real gate is the existing `DRONE_HINT` regex in [`auto-ingest.ts:5`](src/features/sources/auto-ingest.ts#L5). Improving _that_ filter (see §1-A below) is where relevance gains live.

### ✅ Correction — Discard button does exist

Round 1 (and the reviewer) noted "no discard action in the intake UI." The code shows this is wrong. [`intake-page.tsx:53`](src/features/intake/intake-page.tsx#L53) has a working **Discard** button that calls `candidates.update(c.id, { status: "discarded" })`. The `discarded` status is therefore real and meaningful — source reliability scoring (§3.3 from round 1) is not blocked on this.

### ⚠️ §2.1 vs §2.2 — Architecture conflict: pick one

Round 1 proposed a `system_relations` table with `REFERENCES drones(id)` foreign keys (§2.1) and also said to put it behind the `DocumentStore` contract to stay "DB-agnostic" (§2.2). These are mutually exclusive:

- Hard FKs tie the schema to Postgres and **break the localStorage fallback** the architecture is explicitly designed to preserve ([`store.ts:4`](src/shared/contracts/store.ts#L4)).
- Adding a new collection to `DocumentStore` requires changes to: `Collection` union type, `CollectionMap`, `Snapshot`, `KEYS` in `LocalStorageStore`, the Postgres `put()`/`load()` implementation, and a new migration. It is not a small addition, but it's the right one.

**Decision required before starting §2:**

> **Option A (recommended):** Add `"relations"` to `CollectionMap` and `DocumentStore`. Relations persist to localStorage in dev and Postgres in production. Loses hard FK guarantees but preserves DB-agnosticism and the single-store contract.
>
> **Option B:** Postgres-only `system_relations` table. Simpler schema, FK integrity, but means the app silently has no relation data in local/dev mode and breaks the stated architecture principle.

---

## New Improvements (Round 2)

### §1-A Improved Relevance Filter (replaces round-1 §1.4)

The single `DRONE_HINT` regex ([`auto-ingest.ts:5`](src/features/sources/auto-ingest.ts#L5)) is a flat OR-gate. Replace with a two-tier keyword model that costs nothing extra:

```ts
// Tier A: system names and domain-specific terms → ingest immediately
const PRIMARY_HINT =
  /shahed|geran|lancet|fpv|bpla|бпла|квадрокоптер|ланцет|герань|magura|kvn|loitering|kamikaze drone/i;

// Tier B: generic terms → only ingest if a Tier A term is also present
const SECONDARY_HINT = /drone|uav|ugv|usv|unmanned|jammer|РЭБ|EW\b|interceptor/i;

const isRelevant = (text: string) =>
  PRIMARY_HINT.test(text) || (SECONDARY_HINT.test(text) && text.length > 200);
```

This reduces low-signal posts ("drone" in a news headline with no system detail) from entering the pipeline while keeping high-signal system-name mentions. No LLM cost, no new dependency.

Also add Cyrillic-script language variants for major systems as synonyms in the `DRONE_HINT` — currently `шахед` and `герань` are tested but `ланцет`, `мавик`, `баба яга` are not.

### §1-B Article Body Extraction (replaces round-1 §1.2, now more concrete)

`parseWeb()` in [`fetch-posts.ts:47`](src/shared/infra/fetch-posts.ts#L47) extracts only anchor text (25–300 chars per link). For web sources this means passing fragments to the LLM rather than full paragraphs.

**Practical path:**

- Add a `mode: "article"` option to `MonitoredSource` (opt-in per source, default off).
- Server-side only: use the [`@mozilla/readability`](https://github.com/mozilla/readability) package on the raw HTML before passing to the pipeline. It strips nav/ads and returns full article text.
- Produces one large `FetchedPost` per URL rather than 25 tiny anchor-text snippets. The LLM extraction quality improves substantially.
- No browser bundle impact since this runs in the server function.

### §2-A Persist `systems[]` as `counterpartIds` (was round-1 quick win #2 — unchanged, highest priority)

Every time the LLM extracts a report it returns a `systems[]` array with `matchId` and `variantOf` already resolved to catalog IDs. The pipeline discards this ([`pipeline.ts:25`](src/features/intake/pipeline.ts#L25)).

Concretely: after a successful auto-merge or promote, iterate `extraction.systems` and write mutual `counterpartIds` edges:

```ts
// Inside pipeline.ts, after mergeSpecs():
const relatedIds = extraction.systems
  .filter((s) => s.matchId && s.matchId !== target.id)
  .map((s) => s.matchId!);

if (relatedIds.length > 0) {
  const updated = {
    ...target,
    counterpartIds: [...new Set([...target.counterpartIds, ...relatedIds])],
  };
  d.drones.upsert(updated);
  // Also write the reverse edge
  for (const relId of relatedIds) {
    const rel = d.drones.get(relId);
    if (rel && !rel.counterpartIds.includes(target.id)) {
      d.drones.upsert({ ...rel, counterpartIds: [...rel.counterpartIds, target.id] });
    }
  }
}
```

This gives free bidirectional relationship discovery without any new schema.

### §2-B `variantOf` Promotion Path

`variantOf` is detected by the heuristic ([`heuristic-ai.ts:63`](src/shared/infra/heuristic-ai.ts#L63)) and the LLM prompt explicitly requests it, but there is no intake UI path that acts on it. When an analyst promotes a candidate that has `variantOf` set, the new drone should:

1. Pre-fill `counterpartIds` with the parent system's ID.
2. Copy the parent's RF bands as a starting point (variants often share frequencies).
3. Log an evolution event `{ kind: "other", description: "Variant of <parent>", ... }`.

This is a change to [`promote()`](src/features/intake/pipeline.ts#L34) in `pipeline.ts` — about 10 lines.

### §3-A Source Reliability Scoring (now unblocked — Discard exists)

Since `status: "discarded"` is already a real intake action (confirmed above), per-source scoring is buildable now:

```ts
interface SourceStats {
  totalCandidates: number;
  promotedCount: number; // status === "promoted"
  mergedCount: number; // status === "merged"
  discardedCount: number; // status === "discarded"
  avgConfidence: number; // average extraction.confidence of all candidates
  signalRate: number; // (promoted + merged) / total
}
```

Compute this from `candidates.list()` grouped by `source` — no new persistence needed at this scale.

**Use it for:** surfacing low-signal sources in the Sources UI so analysts know which monitored channels are worth the API calls.

> [!NOTE]
> The `signalRate` metric is only meaningful once a source has ≥20 candidates processed. Sources with fewer should show "Insufficient data" rather than a misleading rate.

### §3-B Consensus `disputed` Flag and Date Decay

Targeted patch to [`consensus.ts`](src/entities/drone/consensus.ts) — not a new system:

```ts
export interface Consensus {
  display: string;
  min?: number;
  max?: number;
  median?: number;
  sources: number;
  confidence: "high" | "medium" | "low";
  disputed: boolean; // ADD: spread > 0.5 for numeric, agree < 0.5 for string
  staleAt?: string; // ADD: ISO date of oldest claim contributing to display
}
```

Date decay: weight each claim's contribution to confidence by `1 / (1 + daysSince(claim.date) / 90)`. Claims older than 180 days drop to 25% weight. The `SpecClaim.date` field is already populated for all seed data and all AI/heuristic extractions.

### §4-A Controlled Vocabulary for Propulsion

The search facet for propulsion ([`local-repository.ts:58`](src/shared/infra/local-repository.ts#L58)) does an exact string match, so "Electric" and "electric" and "Electric motor" are three distinct buckets. Seed data uses: `"Piston (MD-550)"`, `"Electric"`, `"Electric tracked"`, `"Waterjet"`, `"Outboard"`.

Two-step fix:

1. Add a `normalisePropulsion(raw: string): string` function that maps synonyms to canonical values (e.g. `"quad" | "quadrotor" | "quadcopter" → "Electric (Quadrotor)"`).
2. Call it in [`openai-compatible-ai.ts`](src/shared/infra/openai-compatible-ai.ts) at the point where `propulsion` is extracted, and in `heuristic-ai.ts` for consistency.

No schema change needed — this is pure normalisation at the extraction boundary.

---

## Revised Priority Order

Based on dependency chains and confirmed code reality:

| Priority | Item                                                        | Why                                                        |
| -------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| 1        | **§2-A** — Persist `systems[]` as `counterpartIds`          | Free signal, already computed, 20-line change              |
| 2        | **§1-A** — Improved relevance filter                        | Reduces garbage entering the pipeline, zero cost           |
| 3        | **§1-B / dedup** — `contentHash` cross-source deduplication | Confirmed duplicate problem from live run; small migration |
| 4        | **§3-B** — `disputed` + date decay in `consensus.ts`        | Data quality, contained change, no new dependencies        |
| 5        | **§4-A** — Propulsion normalisation                         | Prevents permanent catalog fragmentation                   |
| 6        | **§2-B** — `variantOf` promotion path                       | Completes the relationship model for variants              |
| 7        | **§1-B** — Article body extraction                          | Quality jump, adds `@mozilla/readability` dependency       |
| 8        | **§3-A** — Source reliability scoring                       | Value grows as candidate count grows                       |
| 9        | **§2.1/§2.2** — Full relation graph                         | After the architecture decision (Option A vs B) is made    |

### Items Removed from Round 1

| Item                          | Reason                                        |
| ----------------------------- | --------------------------------------------- |
| Quick win #1 (Telegram 20→50) | No-op — endpoint limitation, not a code limit |
| §1.4 heuristic pre-screen     | Redundant — replaced by §1-A improved filter  |
| §2.5 greenfield consensus     | Overstated — most of this already exists      |

---

## Open Architecture Decision

> **Before starting the relation graph (priority 9), decide:**
>
> - **Option A (DocumentStore route):** Add `"relations"` to `CollectionMap`. Works in localStorage and Postgres. Requires ~6 files edited plus a migration. Maintains DB-agnosticism.
> - **Option B (Postgres-only table):** A standalone SQL table with foreign keys. Simpler but permanently breaks the local fallback and contradicts the stated architecture.
>
> Option A is the recommendation — it keeps the single-store contract intact and means analysts can work offline.
