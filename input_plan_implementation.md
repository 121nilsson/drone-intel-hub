# Implementation plan — the input side (ingest quality)

> [!NOTE]
> This is the detailed plan for item **4** of the five-point roadmap ("Fix the input side — it's
> the ceiling on quality"). Everything below is verified against the current source; file:line
> references are included so each step is directly actionable.
>
> Scope is deliberately narrow: **stage 1 only** (collection and the dispatch queue). Nothing in
> `processPending`, the pipeline, or the entity model changes except the new dedupe fields.

---

## 0. What we are fixing, and why it matters

Phases are lettered A–E and executed in the order A → C → B → E → D (§7 explains why).

| # | Problem | Evidence | Cost today |
|---|---|---|---|
| A | No fetch timeout | `fetch-posts.ts:102`, `:108` — bare `fetch(url, { headers: UA })` | One hung host serialises the whole sequential pass (`fetch-posts.server.ts:95-108`) |
| A | Sequential collection | `fetch-posts.server.ts:95-108` — `for` loop, `await` per source | ~79 hosts × latency = minutes before stage 2 even starts |
| C | No cross-source dedupe | `auto-ingest.ts:218` — id is `sourceId\|externalId` only | One story from Telegram + RSS + Web = 3 dispatches = 3 AI calls, and 3 claims in `consensus()` (inflating the `sources` count with one fact) |
| B | Anchor-text-only Web parsing | `fetch-posts.ts:72-85` | 29 Web sources yield headline snippets, not article bodies |
| D | X/Twitter unsupported | `fetch-posts.ts:96-97` | 8 seeded high-signal sources never contribute |
| E | No yield telemetry | `sources-page.tsx:408-413` shows "N posts stored" only | Operator cannot tell that some of the 79 sources produce zero drone-related posts |

**The core insight for C:** duplicate ingest is not just wasted API spend. Every duplicate becomes
a *distinct* `SpecClaim.source` value, so `consensus()`'s `sources: number`
(`entities/drone/consensus.ts:62`) counts the same outlet three times. That silently inflates the
`confidence: "high"` gate (`sources >= 3`, `consensus.ts:108`). Deduplication is therefore a
**correctness fix**, not just a cost fix.

---

## 1. Ground rules this plan follows

- Pure logic goes in `entities/` or `features/`; I/O adapters go in `shared/infra/`.
- New server-only code lives in `*.server.ts` and is imported lazily — the browser bundle must not
  pull a DOM parser (see `AGENTS.md`).
- Storage stays swappable: no store-specific logic leaks into a feature.
- The repo is Lovable-connected — commit incrementally, never force-push or rewrite pushed
  history (`AGENTS.md`).
- Every phase ends with tests in `src/test/` and a green `npm test` (183 existing cases must stay
  green).

---

## 2. Phase A — Fetch safety: deadline + bounded concurrency

**Effort:** small (~1 session). **Do this first** — it is the only phase that fixes a live outage
mode (a hung host stalling everything).

### A1. One deadline per source, shared by its follow-up requests

`src/shared/infra/fetch-posts.ts` — replace the two raw `fetch` calls with a small helper. The
signal is created **once per `fetchOne` call** so Phase B's article follow-ups cannot multiply the
budget.

```ts
const UA = { "User-Agent": "Mozilla/5.0 (compatible; DroneINT/1.0)" };

/** A single source must not be able to hold a sync pass open. 15s covers slow RSS hosts
 *  without letting one dead endpoint eat the 8-minute AI window. Bounds a hang, does not
 *  police latency - the same reasoning as PROVIDER_TIMEOUT_MS (ai-proxy.server.ts:80-85). */
export const FETCH_TIMEOUT_MS = 15_000;

type TextResult =
  | { ok: true; body: string; status: number }
  | { ok: false; error: string; status: number };

async function getText(url: string, timeoutMs: number): Promise<TextResult> {
  // `0` disables the deadline, matching the PROVIDER_TIMEOUT_MS convention the README documents.
  const signal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
  try {
    const r = await fetch(url, { headers: UA, ...(signal ? { signal } : {}) });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}`, status: r.status };
    return { ok: true, body: await r.text(), status: r.status };
  } catch (e) {
    // AbortSignal.timeout rejects with a TimeoutError whose message is platform-specific
    // ("The operation was aborted due to timeout"), so classify it here. Same test as
    // transportError (ai-proxy.server.ts:95-100).
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError")
      return { ok: false, error: "Fetch timeout", status: 0 };
    return { ok: false, error: e instanceof Error ? e.message : "Fetch failed", status: 0 };
  }
}
```

Then in `fetchOne`, thread `timeoutMs` through:

```ts
export async function fetchOne(
  source: Pick<MonitoredSource, "platform" | "handle">,
  opts: FetchOptions = {},
) {
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  if (source.platform === "X") { /* D */ }
  if (source.platform === "Telegram") {
    const chan = source.handle.replace(/^@|^https?:\/\/t\.me\/(s\/)?/, "").split("/")[0] ?? "";
    if (!/^[A-Za-z0-9_]{3,64}$/.test(chan)) return { ok: false, error: "Invalid Telegram handle" } as const;
    const r = await getText(`https://t.me/s/${chan}`, timeoutMs);
    // Existing wording for an HTTP status; a transport failure keeps its own message rather
    // than becoming "Telegram 0".
    if (!r.ok) return { ok: false, error: r.status ? `Telegram ${r.status}` : r.error } as const;
    return { ok: true, posts: parseTelegram(r.body, chan) } as const;
  }
  if (!/^https:\/\//.test(source.handle)) return { ok: false, error: "URL must start with https://" } as const;
  const r = await getText(source.handle, timeoutMs);
  if (!r.ok) return { ok: false, error: r.error } as const;
  const isFeed = source.platform === "RSS" || /<rss|<feed/i.test(r.body.slice(0, 500));
  return { ok: true, posts: isFeed ? parseRss(r.body) : /* B */ parseWeb(r.body, source.handle) } as const;
}
```

Wire `FetchOptions` (declared in A3/B) and keep every existing error string byte-identical —
`fetch-posts.test.ts:21`, `:123`, `:132` assert on them.

**Env override.** `fetch-posts.ts` is a shared module that also ships to the browser, so it must
not read `process.env` directly (the browser has none — see how every other env read sits in a
`*.server.ts` file). The server side supplies the knob instead:

```ts
// fetch-posts.server.ts — `0` disables, matching the README's PROVIDER_TIMEOUT_MS convention.
const FETCH_TIMEOUT_MS = Number(process.env["FETCH_TIMEOUT_MS"] ?? 15_000);
const fetcher = (s: MonitoredSource) => fetchOne(s, { timeoutMs: FETCH_TIMEOUT_MS, ... });
```

`PROVIDER_TIMEOUT_MS` and `FETCH_TIMEOUT_MS` are different numbers for a reason: a provider
completion legitimately takes 90 s, a source page should not.

### A2. Bounded-concurrency pool

New file `src/shared/infra/pool.ts` (pure, no I/O — directly testable):

```ts
export interface PoolProgress<T> { done: number; total: number; item: T | null }

/**
 * Runs `worker` over `items` with at most `limit` in flight and never lets one rejection
 * kill the batch (returns settled results, in input order).
 *
 * `key` optionally serialises items that share a key - several monitored sources point at one
 * host (five GitHub release atoms, for instance), and parallel requests to the same host both
 * trip its rate limit and look abusive.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  opts: { key?: (item: T) => string; onSettled?: (p: PoolProgress<T>) => void } = {},
): Promise<PromiseSettledResult<R>[]>;
```

Sketch: keep a `Map<key, number>` of in-flight counts; when a worker settles, decrement and refill
from the next eligible index. `results[index] = settledResult` preserves ordering.

`FETCH_CONCURRENCY = 6` exported from `fetch-posts.ts` — 79 sources over 6 lanes is ~13 rounds;
with a 15s deadline the worst-case collection pass is bounded by (rounds × 15s) rather than
(79 × latency).

Also add `sourceHost` to the same file, used as the pool `key` server-side:

```ts
/** Host a source's requests actually hit, for per-host politeness in the pool. */
export function sourceHost(s: Pick<MonitoredSource, "platform" | "handle">): string {
  if (s.platform === "Telegram") return "t.me";
  try { return new URL(s.handle).hostname; } catch { return "unknown"; }
}
```

### A3. `FetchOptions` — the seam for B, C and D

```ts
// fetch-posts.ts (shared)
export interface FetchOptions {
  /** Per-request timeout for the source page and any follow-ups. */
  timeoutMs?: number;
  /** Article body extraction. Injected by the server; absent in the browser. See B. */
  articleText?: (html: string, url: string) => Promise<string | null>;
  /** Links per page whose bodies are fetched. Default 3. See B. */
  maxFollows?: number;
  /** Total requests per source, the page itself included. Default 1 + maxFollows. */
  maxRequests?: number;
  /** Operator-supplied RSS bridge base for X/Twitter. See D. */
  xBridgeBase?: string;
}
```

Why an injected callback instead of importing the parser directly: `fetch-posts.ts` sits on the
client's import path — `source-fetch.functions.ts` re-exports its `FetchedPost` type and
`auto-ingest.ts:3` imports that type — so a static `import("jsdom")` there would drag a DOM parser
into the browser chunk. Injection keeps the dependency server-only and the shared module pure.

### A4. Rewrite the server loop

`src/shared/infra/fetch-posts.server.ts:95-108` becomes:

```ts
const fetcher = (s: MonitoredSource) =>
  fetchOne(s, {
    timeoutMs: FETCH_TIMEOUT_MS,
    ...(extractArticleText ? { articleText: extractArticleText } : {}),
    ...(process.env["X_BRIDGE_BASE"] ? { xBridgeBase: process.env["X_BRIDGE_BASE"] } : {}),
  });

let done = 0;
const results = await mapWithConcurrency(targets, FETCH_CONCURRENCY, async (s) => {
  const started = Date.now();
  const c = await collectSource(s, fetcher, dispatches);
  sources.update(s.id, { lastFetched: new Date().toISOString(), lastError: c.error });
  return { ...c, durationMs: Date.now() - started };
}, {
  key: sourceHost,
  onSettled: ({ item }) => { done++; return report(fetchingProgress(item?.name ?? "", done, targets.length)); },
});
```

Concurrency safety note: `LocalSourceRepository.update` / `LocalDispatchRepository.add` are fully
synchronous (`local-repository.ts:166-170`, `:197-201` — they mutate `this.items`, then
fire-and-forget the store write). Because they contain no `await`, concurrent workers cannot
interleave a read-modify-write. **Do not add an `await` inside those two methods** while this change
is live — that is what makes the pool safe without an extra lock.

`CollectReport` gains **required** `durationMs: number` and `duplicates: number`. `SyncReport` gains
the same two as **optional** — the `QUEUE_ROW` pushes (`fetch-posts.server.ts:113-120` in the
cooldown path and `:161-173` at the end of stage 2) describe queue work rather than one source, so
they simply omit them rather than inventing a zero. `durationMs` is what makes a slow source visible
in `last_result` instead of being invisible inside a long sequential pass.

Extend the source-row report so the numbers survive into `sync_state.last_result` and the activity
log (`fetch-posts.server.ts:100-107`):

```ts
for (const r of results) {
  const c = r.status === "fulfilled" ? r.value : null;
  reports.push({
    source: c?.source ?? "Unknown",
    fetched: c?.fetched ?? 0,
    relevant: 0,
    merged: 0,
    queued: 0,
    duplicates: c?.duplicates ?? 0,
    durationMs: c?.durationMs ?? 0,
    // A rejected worker is a source that threw - collectSource normally returns errors instead,
    // so this only happens on a bug or a serialisation failure, and it must still be reported.
    ...(c ? (c.error ? { error: c.error } : {}) : { error: "Collection failed" }),
  });
}
```

### A5. Rewrite the browser's "Fetch all feeds"

`sources-page.tsx:272-290` — same pool, `onSettled` drives `setWork(fetchingProgress(...))`.
The manual button keeps its current semantics; it just stops being serial. Per-source "Sync"
buttons are untouched.

### A6. Tests

`src/test/pool.test.ts` (new):
- runs with `limit` in flight, no more (track a live counter)
- preserves input order in results
- a throwing worker does not reject the batch (`status: "rejected"` for that index only)
- `key` serialises same-key items while other keys run in parallel
- `onSettled` fires once per item, with `done/total` correct

`src/test/fetch-posts.test.ts` (extend), following the abort-signal cases already in
`ai-proxy-rate.test.ts:292-303`:
- passes an `AbortSignal` to `fetch` — `expect(init?.signal).toBeInstanceOf(AbortSignal)`
- a fetch that throws `{ name: "TimeoutError" }` returns `{ ok: false, error: "Fetch timeout" }`
  (the same classification `transportError` uses, so `providerErrorKind`'s `/timeout/i` branch
  keeps working on the stored string)
- a network `TypeError` still surfaces its message verbatim
- `timeoutMs: 0` omits the signal entirely (the documented disable path)
- existing suites keep passing unchanged (they stub `fetch` and ignore the signal)

---

## 3. Phase C — Cross-source near-duplicate suppression

**Effort:** medium (~1.5–2 sessions). This is the cost/correctness win and should land **after A,
before B** (it shrinks the queue that B then feeds).

### C1. Why exact hashing is not enough

The same story arrives as a Telegram post, an RSS title+description, and a website headline. Text
differs (prefixes, boilerplate, truncation) while the *content* is identical. We need fuzzy
matching.

**Choice: 64-bit SimHash over word unigrams + bigrams**, compared by Hamming distance.

- Order-insensitive by construction — good for forwards and re-ordered sentences.
- Robust to small edits (a changed sentence moves ~1 bit).
- Pure JS, synchronous, no crypto dependency (avoids making `collectSource` async on
  `crypto.subtle` and avoids `content_hash` collisions across locales).
- 40 lines, directly unit-testable.

### C2. New pure module — `src/entities/dispatch/simhash.ts`

```ts
/** Lowercase, strip URLs, drop punctuation, collapse whitespace. */
export function normalizeForHash(text: string): string;

/** 64-bit SimHash as 16 hex chars (two u32 halves; FNV-1a per token feature). */
export function simHash64(text: string): string;

/** Bits that differ between two fingerprints. */
export function hammingDistance(a: string, b: string): number;

/** True when two fingerprints are close enough to be the same story. */
export function isNearDuplicate(a: string, b: string, tolerance = DUPLICATE_TOLERANCE): boolean;

/** Below this length a fingerprint is unstable, so short posts are never deduped. */
export const MIN_CHARS_FOR_DEDUPE = 120;
/** Bits of the 64 that may differ and still be called the same story. */
export const DUPLICATE_TOLERANCE = 3;
```

### C3. Model changes — `src/entities/dispatch/types.ts`

```ts
export type DispatchStatus = "pending" | "processed" | "irrelevant" | "failed" | "duplicate";

export interface RawDispatch {
  // ... unchanged
  /** SimHash of `text` at ingest time. Undefined on documents stored before dedupe existed. */
  contentHash?: string | undefined;
  /** For `status: "duplicate"`: the canonical dispatch this post duplicates. */
  duplicateOf?: string | undefined;
}
```

A duplicate is stored, not dropped: the row keeps `sourceId`, `url`, `publishedAt` and points at the
canonical post, so corroboration survives ("this story was also carried by X") — which is exactly
the signal an OSINT tool wants — while the text is stripped so only one copy is ever sent to the
model. This mirrors the existing `irrelevant` stub pattern (`auto-ingest.ts:328`).

### C4. Migration + store plumbing

`migrations/006_dispatch_content_hash.sql`:

```sql
-- Near-duplicate fingerprint. The same story arriving from Telegram, RSS and a website is
-- ingested once and merged once, instead of three times producing three candidates and three
-- SpecClaims that all cite one fact.
-- Lives in a real column (not the jsonb document) so the mirror-index pattern used by
-- source_id/status/lease_* holds, and so lookups do not depend on the load cap.
alter table dispatches add column if not exists content_hash text;
create index if not exists dispatches_content_hash_idx
  on dispatches (content_hash) where content_hash is not null;
```

Then:
- `PostgresStore.upsert` dispatches branch (`postgres-store.server.ts:103-111`): add
  `content_hash` to the column list and both clauses.
- `CloudStore.row()` dispatches case (`cloud-store.server.ts:40-42`): add `content_hash: d.contentHash ?? null`.
- `LocalStorageStore`: no change — the document rides along in JSON.

> The dispatch `status` is free text everywhere (no enum), so adding `"duplicate"` needs no
> migration. Note that `migrations/` only runs on a fresh volume; `006` must be applied by hand
> on an existing database (same as `002`/`004`, documented in `README.md`).

### C5. Repository contract — `src/shared/contracts/repository.ts`

```ts
export interface DispatchRepository {
  // ... unchanged
  /**
   * Id of an already-stored dispatch whose text this fingerprint duplicates, or null.
   * Optional: a repository without it simply never suppresses duplicates.
   */
  duplicateOf?(fingerprint: string): string | null;
}
```

Implementation in `LocalDispatchRepository` (`local-repository.ts:187-230`) — the cache already
holds the newest ~3000 dispatches, so the check is in-memory and **no new store call is needed for
any backend**:

```ts
/** Newest dispatches first only: a duplicate almost always lands in the current or last sync. */
const DUP_SCAN_WINDOW = 2000;

// Inside LocalDispatchRepository:

/** fingerprint -> id, for the exact-match fast path (re-posts, forwards). */
private fingerprints = new Map<string, string>();
/** id -> fingerprint, so a document's entry can be dropped when its text changes. */
private fingerprintIds = new Map<string, string>();

/**
 * Fingerprint a document, lazily, so dispatches stored before the column existed need no data
 * migration. Only documents *with text* are indexed: the `irrelevant` and `duplicate` stubs have
 * their text stripped (auto-ingest.ts:328 and C6), and indexing a stub would let an exact match
 * point at the stub instead of at the canonical post it points to.
 */
private hashOf(d: RawDispatch): string | null {
  if (!d.text) return null;
  const fp = d.contentHash ?? simHash64(d.text);
  this.fingerprints.set(fp, d.id);
  this.fingerprintIds.set(d.id, fp);
  return fp;
}

override async attach(store: DocumentStore) {
  await super.attach(store);
  // A reload replaces `this.items` (claim() does exactly this at local-repository.ts:224), so
  // the index is dropped and rebuilt lazily rather than trusted across the swap.
  this.fingerprints.clear();
  this.fingerprintIds.clear();
}

duplicateOf(fp: string): string | null {
  const exact = this.fingerprints.get(fp);
  if (exact) return exact;
  // Near-match scan, newest first, capped. `!d.text` also skips stubs.
  for (const d of this.items.slice(0, DUP_SCAN_WINDOW)) {
    if (!d.text || d.status === "duplicate") continue;
    const h = this.hashOf(d);
    if (h && isNearDuplicate(fp, h)) return d.id;
  }
  return null;
}
```

Three places must keep the index honest:

- `add(d)` — `if (d.text) this.hashOf(d);` after inserting. Without this, a second copy of the same
  post *inside one batch* is not caught, because `duplicateOf` only sees what is already stored. The
  `d.text` guard is what keeps stubs out (a `duplicate` row is added with `text: ""`).
- `update(id, patch)` — drop the id's entry from both maps. An `irrelevant` stub's text is emptied at
  `auto-ingest.ts:328`, which would otherwise leave a fingerprint indexed for text that no longer
  exists, and `hashOf` would then return `null` for it forever.
- `hashOf` lazily backfills, so no data migration is needed for dedupe to work on day one. The
  backfill is in-memory only; a document is never re-saved just to persist its fingerprint.

### C6. `collectSource` — `src/features/sources/auto-ingest.ts:224-248`

```ts
export async function collectSource(s, fetcher, dispatches) {
  const res = await fetcher(s);
  if (!res.ok) return { source: s.name, fetched: 0, stored: 0, duplicates: 0, error: res.error, durationMs: 0 };
  const now = new Date().toISOString();
  let stored = 0, duplicates = 0;
  for (const p of res.posts) {
    const base = { id: dispatchId(s.id, p.id), sourceId: s.id, /* ...as today... */ };
    const fp = p.text.length >= MIN_CHARS_FOR_DEDUPE ? simHash64(p.text) : undefined;
    const dupe = fp ? (dispatches.duplicateOf?.(fp) ?? null) : null;
    if (dupe) {
      // Kept for provenance and archive counts; text stripped so it is never analysed again.
      dispatches.add({ ...base, status: "duplicate", text: "", duplicateOf: dupe, contentHash: fp });
      duplicates++;
      continue;
    }
    dispatches.add({ ...base, contentHash: fp });
    stored++;
  }
  return { source: s.name, fetched: res.posts.length, stored, duplicates, durationMs };
}
```

`CollectReport` gains `duplicates: number`, and `SyncReport` carries it through to the persisted
`last_result`.

### C7. UI — `sources-page.tsx`

- **`counts` (line 331)** — the initialiser is `{ pending: 0, processed: 0, irrelevant: 0, failed: 0 }`
  behind an `as Record<DispatchStatus, number>` cast, so a missing key compiles fine and
  `counts[d.status]++` then produces `NaN`, which renders in the tab. Add the fifth key:

  ```ts
  const counts = { pending: 0, processed: 0, irrelevant: 0, failed: 0, duplicate: 0 } as Record<
    DispatchStatus,
    number
  >;
  ```

  (The cast itself is the reason this is a runtime bug rather than a type error — replace it with a
  real typed initialiser while touching this line.)
- **Filter tabs (line 464)** — add `"duplicate"` to the array so operators can inspect and count them.
- **Row (line 478)** — render `duplicate of …` linking to the canonical dispatch's `url`, tone
  `default`, alongside the existing status tag. The row already keeps its own `url`, so the
  discarded story is one click away.
- **Log line (line 220)** — `· ${c.duplicates} duplicates`.
- **Sources list** — add the per-source yield line from Phase E.

### C8. Tests — `src/test/content-dedupe.test.ts` (new)

- `normalizeForHash` lowercases, strips URLs/punctuation, collapses whitespace
- `simHash64` is stable, and equal for the same tokens in a different order (order-insensitivity
  is the feature, assert it so nobody "fixes" it inadvertently)
- `hammingDistance` counts correctly; `isNearDuplicate` respects the tolerance boundary
- **integration via `collectSource`**: the same text from two different sources → second row has
  `status: "duplicate"`, `text: ""`, `duplicateOf` set; report says `stored: 1, duplicates: 1`
- a re-ordered / lightly edited copy is still caught (a paragraph moved)
- two genuinely different stories are both stored
- a 60-char post is never deduped
- a repository without `duplicateOf` still collects (optional-call path)
- **the cost assertion**: two sources carrying one story produce exactly one candidate and one
  `SpecClaim`, not two (run through `processPending` and count)
- two identical posts inside one batch (two external ids, one source) — the second must be caught,
  which is the case the `add()` index registration exists for
- **three** copies (canonical + two duplicates) — both `duplicateOf` values must resolve to the
  text-bearing canonical, never to another `duplicate` row. This is the case the `if (d.text)` guard
  in `hashOf` exists for; a chain of stubs would make `duplicate of …` links dangle.

Existing `dispatch-queue-resilience.test.ts` needs no change: its fake `dispatchRepo` has no
`duplicateOf`, and every dispatch text in it ("A drone report", "another drone", "A post about
gardening") is far below `MIN_CHARS_FOR_DEDUPE`.

---

## 4. Phase B — Article body extraction

**Effort:** medium (~1.5 sessions, mostly dependency + fallback behaviour). **After C** — dedupe
first means we are not paying to fetch three copies of the same article.

### B1. Dependency

Add `@mozilla/readability` and move `jsdom` from devDependencies to **dependencies** (it is now a
runtime need, not just the test environment). Then update the lockfile (`bun.lock` /
`package-lock.json`) so `bun install --frozen-lockfile` in the `Dockerfile` still works.

### B2. New server-only module — `src/shared/infra/article.server.ts`

```ts
/** Article body extraction. Server-only: it needs a DOM, so jsdom is imported lazily and the
 *  browser never loads it. Called through FetchOptions.articleText, never imported directly. */
export async function extractArticleText(html: string, url: string): Promise<string | null>
```

- `const { JSDOM } = await import("jsdom"); const { Readability } = await import("@mozilla/readability");`
- `new Readability(new JSDOM(html, { url }).window.document).parse()`
- Join paragraphs with `\n\n`, slice to `MAX_ARTICLE_CHARS = 8000` (keeps dispatch text bounded
  against the 500 KB document cap in `store.functions.ts:12`).
- Return `null` when Readability finds nothing or the body is under `MIN_ARTICLE_CHARS = 400` —
  the caller then falls back to today's behaviour.
- On any throw, return `null` (a parser crash must never fail a source fetch).

### B3. Web pages: article first, headlines as fallback

In `fetchOne`'s non-feed branch:

```ts
const posts = opts.articleText
  ? await webPosts(r.body, source.handle, opts)
  : parseWeb(r.body, source.handle);
```

```ts
/** Bodies are fetched for the richest few links, not the whole nav menu. */
const FOLLOW_CONCURRENCY = 3;
/** Ceiling on requests one source may cost, the page itself included. */
const MAX_FOLLOWS = 3;

/**
 * A Web source is either an article page or an index of links. Try the article body first;
 * if the page is an index, keep every headline but fetch the top few bodies so the richest
 * posts reach the pipeline. Ids stay the link URL, so re-fetching is still deduplicated.
 */
async function webPosts(html: string, pageUrl: string, opts: FetchOptions): Promise<FetchedPost[]> {
  const article = await opts.articleText!(html, pageUrl);
  if (article) {
    return [{ id: `web:${pageUrl}`, text: article, url: pageUrl }];
  }
  const links = parseWeb(html, pageUrl);
  const follow = Math.min(opts.maxFollows ?? MAX_FOLLOWS, MAX_FOLLOWS);
  const budget = Math.max(0, (opts.maxRequests ?? follow + 1) - 1);   // the page itself cost 1
  // Replace the top `budget` headlines with their article bodies; the rest stay as anchors.
  // Degradation is per-post: a failed or too-short body keeps the anchor text.
  const top = links.slice(0, budget);
  const bodies = await mapWithConcurrency(top, FOLLOW_CONCURRENCY, (link) =>
    getText(link.url, opts.timeoutMs ?? FETCH_TIMEOUT_MS).then(async (r) => {
      if (!r.ok) return null;
      return await opts.articleText!(r.body, link.url);
    }),
  );
  for (let i = 0; i < top.length; i++) {
    const result = bodies[i];
    const body = result?.status === "fulfilled" ? result.value : null;
    if (body && body.length >= MIN_ARTICLE_CHARS) top[i] = { ...top[i]!, text: body };
  }
  return links;
}
```

The follow-ups go through `getText` with the same `timeoutMs`, and the pool utility from A2 runs
them at `FOLLOW_CONCURRENCY`. A failed or too-short follow-up keeps the original anchor text —
degradation is per-post, never per-source.

### B4. RSS teaser enrichment (optional but recommended)

Feeds frequently carry a 60-character summary plus "read more". After `parseRss`, if `articleText`
is set, fetch the bodies of the items whose text is under `RSS_TEASER_CHARS = 200` and has a URL,
up to the same `budget`, replacing only `text` (the `rss:` id and `url` are unchanged, so dedupe and
archive links stay stable). Share the `MAX_FOLLOWS` budget with B3 — a source costs at most one
page plus three requests regardless of which paths run.

### B5. Wire the seam

- `src/shared/infra/source-fetch.functions.ts` handler: pass `{ articleText: extractArticleText }`,
  dynamically importing `article.server.ts` inside the handler (the established pattern in
  `store.functions.ts:19`).
- `fetch-posts.server.ts` (A4) passes the same through the `fetcher`.
- Browser: nothing to pass — the browser never fetches sources directly; it goes through the
  server function, so `articleText` is absent there and the anchor path applies.

### B6. Tests — `src/test/fetch-posts.test.ts` + `article.test.ts` (new)

- an article page (several `<p>` inside a `<article>`, plus nav chrome) yields **one** post whose
  text is the body and not the menu links
- an index page yields the same posts as today, except the first three have full bodies (stub
  `fetch` per URL, assert each post's text is the body, ids are still `web:<href>`)
- one followed link returning 503 → that post falls back to its anchor text, the others are fine
- `maxFollows: 0` on an index page reproduces today's anchor output exactly (the rollback switch
  for the follow-up part)
- with `articleText` omitted entirely — the browser path and the pre-upgrade server — output is
  unchanged from today, for both page kinds (this is the regression guard for the DI default)
- `extractArticleText` on a stub page returns `null`; on a real-shaped article returns paragraphs,
  stripped of navigation
- a 20 KB page is truncated to `MAX_ARTICLE_CHARS`

---

## 5. Phase E — Source yield visibility

**Effort:** small (~half a session). Uses data already in memory; no schema change. Slot it
anywhere after A.

Per source, computed from the dispatch cache the page already has (`sources-page.tsx:411`):

```
Last synced … · 120 posts stored · 41 analysed · 6 queued · 70 filtered · 3 duplicates · 2 failed
```

Definitions (all computed from fields already on `RawDispatch`):
`analysed` = `status === "processed"`, `queued` = `outcome === "queued"`, `filtered` =
`status === "irrelevant"`, `duplicates` = `status === "duplicate"`, `failed` =
`status === "failed"`.

Then:
- A `no signal` tag when `analysed + queued === 0 && stored >= 20` — the "worth the API cost?"
  answer, per source, at a glance. This directly serves the roadmap's source-reliability
  recommendation with zero new storage.
- A header line: `12 of 79 sources produced drone-related posts`.
- `durationMs` from `collectSource` in the activity log, so a slow host is visible without reading
  server logs: `name: 18 fetched · 2 new · 1 duplicate · 2140ms`. The server-side run's numbers
  land in `sync_state.last_result` via `SyncReport` and surface in the same panel.

---

## 6. Phase D — X/Twitter through an operator-supplied bridge (optional)

No first-party path exists without a paid API. Rather than pretend otherwise, make the *operator*
the one who opts in: if `X_BRIDGE_BASE` is set, `fetchOne` fetches `<base>/<handle>` and parses it
with the existing `parseRss`; otherwise it returns today's error message.

- `fetch-posts.ts` X branch gains the `opts.xBridgeBase` path (~10 lines).
- `fetch-posts.server.ts` and `source-fetch.functions.ts` pass `process.env["X_BRIDGE_BASE"]`.
- No new env validation: the base URL is operator-controlled, not user input (the SSRF concern in
  `improvements3.md §3.1` is about user-supplied `handle` strings; a bridge base must stay an
  env var, never a source field).
- Document it in `README.md` next to the other provider env vars, with the caveat that a bridge is
  a third-party dependency with its own availability and ToS.

Recommendation: leave the 8 seeded X sources in place (they are inert, `autoSync` already excludes
them at `fetch-posts.server.ts:93`) and let the operator decide.

---

## 7. Sequencing

| Order | Phase | Why here | Effort |
|---|---|---|---|
| 1 | **A** | Fixes the only live outage mode; A2/A3 are prerequisites for B | ~1 session |
| 2 | **C** | Stops paying 3× for one fact and inflating consensus; reduces B's follow-up count | ~1.5–2 sessions |
| 3 | **B** | Richer text for the survivors | ~1.5 sessions |
| 4 | **E** | Cheap, and tells you which sources B/C actually mattered for | ~0.5 session |
| 5 | **D** | Optional, operator-dependent | ~0.5 session |

Suggested commit sequence (one reviewable commit per step, not per phase):
1. `pool.ts` + its tests
2. `fetch-posts.ts` timeout/`FetchOptions` + tests
3. server + browser loop rewrites
4. `simhash.ts` + tests (pure, zero risk)
5. migration `006` + store branches + model fields
6. `collectSource` dedupe + repository `duplicateOf` + tests
7. sources-page status/counts
8. `article.server.ts` + dependency move + tests
9. `webPosts`/RSS enrichment + tests
10. yield line + `no signal` tag
11. X bridge + README

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| jsdom in the client bundle | Only dynamic imports inside `article.server.ts`, reached only through the injected `articleText` callback |
| SimHash false positives merging two distinct stories | `MIN_CHARS_FOR_DEDUPE = 120`, tolerance 3/64 bits, both stories remain visible in the archive with their own URLs. There is **no un-duplicate action** (the archive has no per-dispatch delete), so recovery today is a manual delete of either row in the database — see the follow-up below |
| Duplicate rows inflate the dispatch archive count | The filter tabs expose the breakdown and duplicates are one click from their canonical URL. The 3000-row load cap (`postgres-store.server.ts:9`) is unchanged — if it starts biting, raise it deliberately, not as part of this work |
| `status: "duplicate"` breaks a switch somewhere | Verified safe: `DispatchStatus` is referenced only in `entities/dispatch/types.ts` (the union itself and `RawDispatch.status`). No code exhaustively switches on it — the dispatch tests compare against literals, and `LocalStorageStore.claim` / `pending()` filter on `"pending"` only. The two sites that enumerate values are `sources-page.tsx:331` (counts) and `:464` (tabs), both updated in C7 |
| Concurrency + write-through cache | `LocalSourceRepository.update` / `LocalDispatchRepository.add` must stay `await`-free (see A4). Add a comment at both sites |
| Bounded concurrency angers a host | Per-host `key` in the pool; one shared per-source deadline; `MAX_FOLLOWS` on follow-up requests |
| Lockfile drift breaks the Docker build | Run `bun install` (and `npm install` if `package-lock.json` is kept) as part of B1 and commit both lockfiles. The `Dockerfile` uses `bun install --frozen-lockfile`, so `bun.lock` is the one that must be current |
| `duplicateOf` diverges from the in-memory list after `claim()` re-attaches | `LocalDispatchRepository.claim` calls `attach()` (`local-repository.ts:224`), which replaces `this.items`. The fingerprint index is content-keyed and cleared on attach (C5), then rebuilt lazily — never reused across a reload |

**Known gap to follow up on separately:** a "retry / un-duplicate" action on a dispatch row. It is
needed eventually for false positives, but it is UI work against the store's `remove`, and the
duplicate path is fully accounted for without it. Not part of this plan.

---

## 9. Definition of done

1. `npm test` green — all 183 existing cases plus the new suites listed above (pool, timeout,
   simhash, dedupe integration, article extraction, webPosts fallback).
2. `npx tsc --noEmit` and `npm run lint` clean.
3. Manual run against `docker compose up --build` with `DATABASE_URL`:
   - "Fetch all now" completes and the activity log shows per-source timings;
   - a deliberately hung host (a source whose URL black-holes) does not stop the pass and shows a
     `Fetch timeout` error on its row — the other sources still collect;
   - the same story added under two sources produces exactly one candidate and one `SpecClaim`
     (`/systems/<id>` shows `sources: 1`), and one `duplicate` row in the archive;
   - a Web article source stores a full body, not a headline;
   - the Sources page shows the yield line and flags `no signal` sources.
4. Before/after numbers for one 24 h window: dispatches stored, AI calls (count `candidates` by
   `createdAt`), wall-clock of the collection stage, and posts-per-source.
5. `README.md` updated: the fetch deadline and `FETCH_TIMEOUT_MS` (next to `PROVIDER_TIMEOUT_MS`),
   `X_BRIDGE_BASE`, the `duplicate` dispatch status, and `migrations/006` (applied by hand on
   existing databases).

---

## 10. Out of scope (deliberately)

- Two-tier relevance filtering (`DRONE_HINT` flat OR gate, `auto-ingest.ts:8`) — separate work.
- Per-source sync intervals and error backoff (`improvements.md §1.5`).
- Source reliability *weighting* in the pipeline (Phase E only measures it).
- `processPending` performance (`pending(Number.MAX_SAFE_INTEGER)` full scans).
- Anything in stages 2–3 of the roadmap (provenance UI, analyst workbench, alerting, spectrum map).
