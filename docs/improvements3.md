# Drone Intel Hub — Improvement Roadmap (Round 3)

> [!NOTE]
> This is a third pass, from a deeper end-to-end review. Rounds 1 and 2
> focused on ingest breadth and the relationship graph. This round covers
> what those reviews didn't: **concrete correctness bugs, security, inference
> quality/cost, concurrency, testing, and performance** — plus a status check
> on the items rounds 1–2 already proposed.
>
> Every claim below was verified against the live source. File:line references
> are included so each item is actionable.

---

## Status of rounds 1 & 2

Before adding new work, here is where the prior roadmaps actually stand in the
code today.

| Round 1/2 item                               | Status      | Evidence                                                                                                                                                                           |
| -------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §2-A persist `systems[]` as `counterpartIds` | **Done**    | `pipeline.ts:47-53` + `entities/drone/relations.ts` (the round-2 "highest priority" item shipped)                                                                                  |
| §2-B `variantOf` promotion path              | **Partial** | `promote()` seeds counterpart edges via `linkCounterparts`, but does **not** copy the parent's RF bands and does **not** log a "variant of" evolution event (`pipeline.ts:63-109`) |
| §1-A two-tier relevance filter               | **Open**    | `DRONE_HINT` is still a flat OR gate (`auto-ingest.ts:7-8`)                                                                                                                        |
| §1-B article body extraction (Readability)   | **Open**    | `parseWeb()` still extracts anchor text only (`fetch-posts.ts:72-85`) — see §1.7 below                                                                                             |
| §1.3 cross-source content-hash dedup         | **Open**    | dedupe is still per-`sourceId\|externalId` (`auto-ingest.ts:22`)                                                                                                                   |
| §3-B consensus `disputed` + date decay       | **Open**    | `consensus.ts` still has no `disputed` flag and never reads `SpecClaim.date`                                                                                                       |
| §4-A propulsion normalisation                | **Open**    | `propulsion` is still free text (`types.ts:49`); facets exact-match it (`local-repository.ts:59`)                                                                                  |

---

## 1. Correctness bugs (fix these first)

These are small, confirmed defects — each is a few lines to fix.

### 1.1 `consensus()` has a dead ternary

`consensus.ts:27` — both branches are the identical string:

```ts
return { display: min === max ? `${median}${u}` : `${median}${u}`, ... };
```

The display never distinguishes "all sources agree" from "sources disagree".
When `min === max` it should probably render a single value (and could surface
"confirmed" vs "contested" wording), which also feeds the missing `disputed`
signal (§7.1).

### 1.2 Counterparts page crashes on a catalog of < 2 systems

`counterparts-page.tsx:18-19` uses non-null assertions:

```ts
const A = drones.find((d) => d.id === a) ?? drones[0]!;
const B =
  drones.find((d) => d.id === b) ??
  drones.find((d) => A.counterpartIds.includes(d.id)) ??
  drones[1]!;
```

With an empty or single-item catalog (fresh localStorage, or after deleting
all sources/systems), `A` or `B` is `undefined` and the page throws on
`A.counterpartIds`. Guard with an early "need at least two systems" return.

### 1.3 Heuristic `num()` mis-parses thousands separators

`heuristic-ai.ts:4` — `parseFloat(s.replace(",", "."))` replaces only the
**first** comma, so `"1,234"` → `"1.234"` → `1.234`. Any heuristic-extracted
spec with a thousands separator (common in prices and ranges) is stored wrong.
Strip thousands separators before parsing: `s.replace(/,/g, "")` when the
pattern looks like grouping, or handle the `1,234` vs `1,234` decimal-locale
ambiguity explicitly.

### 1.4 Corrupt localStorage silently reseeds (data loss)

`local-store.ts:13` — `read()` catches the `JSON.parse` error and returns
`null`. `CachedRepository.attach()` (`local-repository.ts:29`) treats `null` as
"never initialised" and **reseeds with `SEED_DRONES`**, wiping whatever the
user had. One corrupted byte in `dti.drones.v1` = full catalog reset. Fix:
distinguish "missing key" (→ seed) from "unparseable" (→ quarantine the bad
value, e.g. back it up under a `…corrupt` key, then seed), and surface a
warning rather than failing silently.

### 1.5 Seeded source is permanently unfetchable

`source/seed.ts:101` — Covert Shores uses `http://www.hisutton.com/feed.xml`,
but `fetchOne()` rejects non-https (`fetch-posts.ts:106-107`), so this Sea
source always errors. Change to the https URL.

### 1.6 Briefing summary can render a stale response

`briefing-page.tsx:36-39` — the `summarize` effect has no request-id/abort
guard. If the context changes while a request is in flight, an older response
can resolve after a newer one and overwrite it. Track a monotonic request id
(or `AbortController`) and ignore superseded responses.

### 1.7 `sources_list.md` documents a feature that doesn't exist

`sources_list.md:12` says Web sources are parsed with "anchor-text parser, **or
full article with Readability**". There is no Readability integration anywhere —
`parseWeb()` extracts anchor text only (`fetch-posts.ts:72-85`). Either
implement §1-B (round 2) or correct the doc; right now a reader will believe
full-article extraction already works.

---

## 2. Inference quality & cost

### 2.1 The benchmark's recommendations were never applied to the defaults

`modelbenchmark.md` §3 is emphatic: set tier 1 to `nvidia/nemotron-3-super-120b-a12b`
and tier 2 to `meta/muse-glimmer-30b`, and **invert the current assignment**
because the cheap screening tier was doing the expensive model's job at worse
latency. But `settings-defaults.ts:8-9` still ships:

```ts
tier1Model: "meta/llama-3.1-8b-instruct",
tier2Model: "deepseek-ai/deepseek-r1",
```

…which matches neither the benchmark's "current" pair nor its recommendation.
The benchmark also showed the then-current tier-1 model (`nemotron-3.5-lightning`)
was **2/4 accurate with 45 s+ latency** — the direct cause of multi-minute
ingests. Apply the recommended pair (or at minimum re-run the probe against the
shipped defaults, which are themselves untested models in this benchmark).

### 2.2 Conditional pre-translation for non-Latin scripts (unimplemented)

`modelbenchmark.md` §4 recommends a ~1 s translation hop via
`nvidia/riva-translate-4b-instruct-v2` for non-Latin text. It cut Cyrillic
extraction variance from **7.7–56.9 s** down to **5.8–15.4 s** and fixed a
false-positive `matchId` (a "no model named" post wrongly matched Shahed-136).
Nothing in the codebase translates. Implement it as a conditional pre-step in
the extraction path: detect script, translate only non-Latin posts, fall back
to direct extraction on translate failure. (The benchmark's caveats — it is
lossy for proper nouns and adds a failure point — are why it must be
conditional, not mandatory.)

### 2.3 Model JSON output is trusted without validation

`openai-compatible-ai.ts:45` does `JSON.parse` on the raw model output after
stripping code fences, then blindly casts fields. The benchmark (§2) documents
`meta/llama-3.2-11b-vision-instruct` returning valid JSON **missing 8 of 12
required keys** — a schema check would catch that. Add:

- a lightweight shape validator (required keys, types, `confidence` in 0..1,
  `matchId`/`variantOf` exist in the catalog — the latter is already checked
  inline, but only for `matchId`, not consistently);
- **one** repair/reprompt attempt on malformed JSON before throwing, so a
  transient formatting slip doesn't burn a dispatch attempt (`auto-ingest.ts:85-87`).

### 2.4 The AI transport has no request timeout

`ai-proxy.server.ts:112` calls `fetch` with no `AbortController`/timeout. A
hung provider connection holds the pacing slot (`pace()` reserves `nextSlot` at
`ai-proxy.server.ts:46-53`) and each retry can add up to `MAX_BACKOFF_MS`
(30 s). Add a per-request timeout (e.g. 60–90 s) so a stalled completion
fails fast instead of stalling the whole sync pass.

---

## 3. Security hardening

### 3.1 Server-side fetch is an SSRF vector

`source-fetch.functions.ts:13-16` validates only that `handle` is a string ≤
300 chars. `fetchOne()` (`fetch-posts.ts:106-109`) then fetches any
user-supplied `https://` URL **from the server**. There is no host allowlist,
no private-IP/loopback/link-local blocking, and no cloud metadata-endpoint
(169.254.169.254 etc.) protection. A user who can add a source can make the
server request internal resources. Mitigations: validate scheme + host at add
time, resolve DNS and reject private/link-local ranges before fetching, and
consider a curated allowlist for Web sources.

### 3.2 Store server functions are unauthenticated

`store.functions.ts` exposes full CRUD (`storeLoad/Seed/Put/Remove`) over all
four collections. Validators check only collection name, `id: string`, and a
500 KB size cap — **no authentication or authorization**. Any caller who can
reach the server can read the entire catalog/queue and overwrite or delete
records. Add auth (session/token) or at minimum scope these to the same origin
with a signed token, and add rate limiting.

### 3.3 API key stored in plaintext in localStorage

`services.tsx:89` writes the provider key to `localStorage` under
`dti.settings.v1`. Any XSS exfiltrates it. The env-key path (`NVIDIA_API_KEY`,
which blanks the browser field) is the real mitigation and should be the
documented default; for the browser-saved path, consider `sessionStorage`
(cleared on tab close) or never persisting the key at all and requiring re-entry
per session.

### 3.4 Provider error bodies leak into strings

`ai-proxy.server.ts:141` embeds up to 300 chars of the provider response body
into the error string, which propagates to dispatch `error` fields and the
sources-page UI. Truncate/scrub these (status code + a short reason) so
provider payloads don't accumulate in the database or surface to users.

---

## 4. Reliability & concurrency

### 4.1 `processPending` has no lock — concurrent runs double-process

The `sync_state` CAS (`source-sync.server.ts:21-38`) protects the **scheduled**
auto-sync, but the manual "Analyse queue" button (`sources-page.tsx:113-120`)
and `fetchAllSources()` call `processPending()` with no claim. Two browser tabs
(or a manual click overlapping a cron tick) both read the same
`dispatches.pending(limit)` set — status is only updated _after_ processing —
and produce duplicate candidates and duplicate merges. Add a per-dispatch claim
(e.g. an `in_flight` status or a `processing_by` lease column) so exactly one
worker owns a dispatch at a time.

### 4.2 Store-attach fallback can split brain

`services.tsx:57-63` — if remote `attach()` partially succeeds and then one
repo throws, the catch re-attaches **all** repos to localStorage. Repos that
already loaded Postgres data keep it in memory, but `attach()` sets
`this.store` to the local store (`local-repository.ts:27`), so subsequent
writes go to localStorage while the in-memory copy still holds remote data →
silent divergence. Give `attach()` an idempotency guard and, on partial
failure, decide per-repo rather than blanket-falling-back.

### 4.3 Fire-and-forget writes hide remote failures

`local-repository.ts:32-39` — `save()`/`drop()` call `store.put(...)` with
`.catch(console.error)` only. In PostgreSQL mode a failed write is invisible to
the user: the UI updates from the in-memory cache and the durable copy silently
lags or loses the change. Surface write errors (toast/log) and consider a
retry queue for the remote store.

### 4.4 Source collection has no fetch timeout

`fetch-posts.ts:102` and `:108` call `fetch` with no timeout. One hung source
blocks an entire sequential sync pass (see §6.1). Add an `AbortSignal.timeout`
per request.

---

## 5. Testing gaps

There are 57 tests covering relations, the pipeline, fetch parsing, dispatch
resilience, and the AI rate limiter — good coverage of the pure logic. But the
following load-bearing paths have **zero** coverage:

| Untested area                                                | Why it matters                                                                                                                                                                                              |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `heuristic-ai.ts` (the whole default engine)                 | It is the **default** inference path whenever no API key is configured. `mentions`, `detectNames`, `resolveSystems`, `extractPrice`, `scan` are all untested, and §1.3 shows a real parsing bug lives here. |
| `consensus.ts`                                               | Rendered in every dossier and the counterparts delta table; §1.1 shows a real bug.                                                                                                                          |
| All stores (`local-store`, `remote-store`, `postgres-store`) | The persistence seam; §1.4's data-loss path is untested.                                                                                                                                                    |
| All repositories (`local-repository.ts`)                     | `search()`/facets power the catalog page; write-through cache behaviour untested.                                                                                                                           |
| `source-sync.server.ts` `claimSlot` CAS                      | The only thing preventing duplicate syncs.                                                                                                                                                                  |
| `services.tsx` composition root                              | Env-vs-browser provider/store resolution is fragile and untested.                                                                                                                                           |
| `openai-compatible-ai.ts` JSON parsing                       | The most fragile line in the AI path (§2.3).                                                                                                                                                                |
| `mergeInto()` (manual merge path)                            | Only `promote()` is partially covered.                                                                                                                                                                      |
| All UI (8 feature pages)                                     | No rendering/interaction tests; §1.2's crash would be caught by one.                                                                                                                                        |

Priority: `heuristic-ai.ts` and `consensus.ts` first — they are the default
engine and the rendered output, and both already contain confirmed bugs.

---

## 6. Performance

| #   | Issue                                                                                                                                                                                                                 | Location                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 6.1 | **Sequential fetch of all ~79 sources**, no concurrency and no timeout — one slow source serialises the whole pass. Fetch with bounded concurrency (e.g. `Promise.all` over chunks of 5–8) plus per-request timeouts. | `fetch-posts.server.ts:65-69`                 |
| 6.2 | `pending(Number.MAX_SAFE_INTEGER)` scans the entire dispatch collection every run just to compute `remaining`. Keep a count or cap the scan.                                                                          | `auto-ingest.ts:93`                           |
| 6.3 | Spec rename/drop performs **N sequential `upsert` calls** (one per drone). Batch into a single store operation.                                                                                                       | `dynamic-specs/specs-page.tsx:14,17`          |
| 6.4 | The remote bridge **double-serialises**: the server `JSON.stringify`s the payload and the client `JSON.parse`s it again. Return structured data and let the server-fn layer serialise once.                           | `remote-store.ts:7` + `store.functions.ts:27` |
| 6.5 | `PostgresStore.load` silently caps dispatches at **3000** (via an embedded `limit` in an `ORDER` string) while the table grows unbounded — the archive quietly diverges from what the UI/API can see.                 | `postgres/postgres-store.server.ts:9`         |

---

## 7. Data quality (carry-forward, still open)

These were proposed in rounds 1–2 and remain open; they are the highest-value
_feature_ work because they improve every downstream summary.

| #   | Item                                                                                                                                                                                                                              | Where                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 7.1 | **`disputed` flag + date decay in `consensus()`** — flag claims whose spread exceeds a threshold (the data is already computed, just not surfaced), and weight `SpecClaim.date` (stored but never read) so old claims count less. | `consensus.ts`                               |
| 7.2 | **Propulsion normalisation** — map synonym spellings to canonical values at the extraction boundary so `"quad"`/`"quadrotor"`/`"quadcopter"` don't fragment the catalog and the facet filter.                                     | `openai-compatible-ai.ts`, `heuristic-ai.ts` |
| 7.3 | **Cross-source content-hash dedup** — the same story crossing Telegram → RSS → Web is ingested three times. Add a `contentHash` (SHA-256 of normalised text) and a `seen_content_hashes` store.                                   | `auto-ingest.ts` + new migration/collection  |
| 7.4 | **Two-tier relevance filter** — replace the flat `DRONE_HINT` OR-gate with primary (system names) / secondary (generic terms) tiers so low-signal posts don't enter the pipeline.                                                 | `auto-ingest.ts:7-8`                         |

---

## 8. Hygiene & dead code

| #   | Item                                                                                                                                                                                                                                                                                                                                                                            | Evidence |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 8.1 | **Dead fields/exports** — `seenIds` (`source/types.ts:15`) is never read or written (dedupe is dispatch-id based); `autoSync` (`source/types.ts:17`) is seeded but never read; `Snapshot` (`store.ts:14`) and `triggerAutoSync` (`source-sync.functions.ts:11`) are declared but unused; `useIsMobile` is only used by the unused shadcn `sidebar.tsx`. Remove or wire them up. |
| 8.2 | **`@typescript-eslint/no-unused-vars` is off** (`eslint.config.js:36`), so dead code is never flagged. Re-enable it (warn at least) to prevent future accumulation.                                                                                                                                                                                                             |
| 8.3 | **Duplicated cron constant** — `AUTO_MIN = 15` (`sources-page.tsx:17`) mirrors the `*/15 * * * *` cron (`vite.config.ts:25`). They can drift; derive the UI label from a single shared constant.                                                                                                                                                                                |

---

## Suggested priority order

| Priority | Item                                          | Why                                                                                      |
| -------- | --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1        | **§1 bugs** (1.1–1.6)                         | Confirmed defects, each a few lines; 1.2 and 1.4 are user-facing data loss/crashes       |
| 2        | **§2.1** apply benchmark model defaults       | Free latency + accuracy win; the shipped defaults are untested models                    |
| 3        | **§3 security** (3.1–3.2)                     | SSRF + unauthenticated store fns are real exposure for a self-hosted app                 |
| 4        | **§4.1** processPending lock                  | Prevents duplicate merges from concurrent clicks/tabs                                    |
| 5        | **§5 tests** for `heuristic-ai` + `consensus` | The default engine and rendered output, both already buggy                               |
| 6        | **§7 data quality** (7.1–7.4)                 | Improves every summary; mostly carried-forward work                                      |
| 7        | **§2.2** conditional translation              | Bounds Cyrillic latency variance; adds a failure point, so do it after the core is solid |
| 8        | **§6 performance**                            | Matters as source count and dispatch volume grow                                         |
| 9        | **§8 hygiene**                                | Cheap, prevents future drift                                                             |
