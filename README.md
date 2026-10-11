# Drone Intel Hub

Collects drone and counter-drone reporting from the web, Telegram, RSS and social sources,
extracts the systems and specifications it mentions, and keeps a sourced catalog of them: every
figure on a dossier is a claim that cites the report it came from.

The project is connected to [Lovable](https://lovable.dev): commits pushed to the connected
branch sync back to the Lovable editor, so keep that branch working and never rewrite pushed
history (see `AGENTS.md`).

## Pages

| Page             | Route           | What it does                                                                                                                          |
| ---------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Briefing**     | `/`             | 7-day summary: new systems, spec changes, merges, and an executive summary from the tier-2 model                                      |
| **Catalog**      | `/catalog`      | Every known system; imports the Wikipedia/Wikidata reference catalog                                                                  |
| System dossier   | `/systems/$id`  | One system's specs with their claims and sources, RF links, components, history; delete a wrong entry (it is not auto-promoted again) |
| **Counterparts** | `/counterparts` | Systems linked as variants or adversary counterparts                                                                                  |
| **Queue**        | `/intake`       | Paste a link or text to analyse; triage candidates the pipeline could not auto-resolve                                                |
| **Feed**         | `/dispatches`   | Archive of collected posts, with outcome and provenance                                                                               |
| **Sources**      | `/sources`      | Monitored sources, sync status, and "Analyse queue" for pending posts                                                                 |
| **Spec Engine**  | `/specs`        | Spec attributes across the catalog and the consensus behind them                                                                      |
| **Taxonomy**     | `/taxonomy`     | Canonical propulsion/installation terms and unknown terms waiting for an analyst                                                      |
| **Settings**     | `/settings`     | Thresholds, models, and which AI providers the server resolved                                                                        |

## Quick start

```bash
cp .env.example .env                 # then edit
cp .env.local.example .env.local     # AI provider keys go here
docker compose up --build            # PostgreSQL + the app on http://localhost:3010
```

Without any provider key the app runs on its built-in heuristic engine; without
`DATABASE_URL` it stores everything in the browser.

## Development

You need Node.js and npm ([install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)).

```bash
npm i
docker compose up -d db   # Postgres on 127.0.0.1:5435
npm run dev               # Vite dev server; reads .env and .env.local
npm test                  # vitest
npm run lint              # eslint (prettier runs as a lint rule)
```

Scheduled auto-ingest only runs in the built app (see [Scheduled auto-ingest](#scheduled-auto-ingest));
in `npm run dev` use "Sync all now" on the Sources page.

Built with TanStack Start, React, TypeScript, Tailwind CSS, Nitro, and PostgreSQL.

### Architecture

- **Feature slices.** Features live in `src/features/<slice>`, shared contracts in
  `src/shared/contracts`, entities in `src/entities`. Features depend only on contracts
  (`DroneRepository`, `IntelExtractor`, `BriefingSummarizer`); concrete implementations are chosen
  in one place, `src/shared/infra/services.tsx`.
- **Server-only code** lives in `*.server.ts` files and is imported dynamically inside server
  functions, so database drivers and provider keys never reach the browser bundle.
- **Storage** goes through the async `DocumentStore` contract. `store.functions.ts` picks
  PostgreSQL when the server has `DATABASE_URL`, Lovable Cloud when its service role is
  configured, and browser storage otherwise. Repositories are write-through caches over it.

## AI pipeline

### How a post is analysed

Ingestion has two stages. **Collection** stores raw posts as `pending` dispatches with no AI
involved, so it is fast and never blocked by a provider. **Processing** drains that queue in
bounded batches, through the same pipeline the Queue page uses (`runTwoTier` in
`src/features/intake/pipeline.ts`):

1. **Relevance filter.** A post with no drone keyword and no catalog name is stored as
   `irrelevant` and never reaches a model.
2. **Heuristics.** A deterministic extractor proposes systems, specs and RF bands at no cost. A
   complete, confident match to a known catalog entry needs no AI at all.
3. **Tier 1 (fast model).** Runs when the heuristics are unsure. The model decides identity: a
   heuristic guess survives only if the model confirms it or it is a catalog match. Facts from
   the heuristics are never dropped.
4. **Tier 2 (deep model).** Runs only when confidence is still low, several systems need
   attributing, or identities conflict. It is skipped when tier 1 found no named system at all,
   so a generic "drones attacked overnight" post costs one call. The Queue page can force it per
   paste ("deep analysis").
5. **Resolution.** A confident catalog match is merged as new claims on the dossier, a confident
   new system is promoted into the catalog, and a low-confidence result is discarded. Everything
   else waits in the Queue for an analyst. Thresholds are on the Settings page.

The briefing summary uses the tier-2 model and is cached in `sync_state`, so every user sees the
same summary until the 7-day context changes.

The extraction prompt (`src/shared/contracts/extraction-prompt.json`) defines what counts as a
system and tells the model to return nothing rather than invent one. Model output is validated by
a deliberately tolerant schema (`extraction.schema.ts`): a malformed field or list item is
dropped, not the whole reply.

### Providers and fallback

Any OpenAI-compatible provider with a key in the environment takes part. Built in, in priority
order: **NVIDIA NIM, Groq, OpenRouter, Mistral** (`src/shared/infra/ai-providers.ts`). Each call
goes to the first provider that is available and falls through to the next one on failure:

- The first provider gets the model configured for the tier; every fallback is asked for **its
  own** model for that tier. A model id only exists in one provider's catalogue.
- A reply that is not usable JSON counts as a failure, so the next provider answers instead.
- Availability failures put a **cooldown** on what failed, and the chain skips it until then
  instead of paying for the same refusal on every post:
  - a **429** parks that model on that provider (the provider's `Retry-After`, at least 1 min,
    at most 1 h). Groq's limits are per model, so its other models keep working;
  - **two timeouts in a row** park that model for 5 min, so an overloaded model stops costing
    a full timeout on every post;
  - a rejected key or exhausted credits (401/402/403) park the whole provider for 15 min, a 5xx
    for 30 s.
- When another provider is waiting, a 429 or a timeout falls through after one attempt; the last
  provider in line retries with exponential backoff and jitter, honouring `Retry-After`.
- Requests are paced **per provider** (`PROVIDER_RPM`, or `${NAME}_RPM`), across every caller:
  a cron tick, a manual sync and a browser tab share one budget per key.
- The server's key is never sent to a base URL chosen by the browser.

When **every** provider is unavailable, queue processing does not record a heuristic-only result
as final. The post stays `pending` without spending one of its attempts, the batch stops, and
auto-sync backs off (5 min, doubling, at most 60 min) before analysing again. An interactive
paste on the Queue page still gets the heuristic result, with a note saying the AI tier was
unavailable. A post that fails for its own reasons (a timeout, a reply no provider could parse)
is retried on later runs and marked `failed` after 3 attempts.

### Configuration

Put provider settings in `.env.local` (template: `.env.local.example`). Docker Compose loads it
into the app container too. Values here override the browser's Settings page, field by field.

| Variable                                                                  | Purpose                                                                                                                                                       |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NVIDIA_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY` | Provider keys. Any one enables AI; stays on the server.                                                                                                       |
| `${NAME}_TIER1_MODEL`, `${NAME}_TIER2_MODEL`                              | Per-provider model for each tier (`NAME` = `NVIDIA`, `GROQ`, `OPENROUTER`, `MISTRAL`). Defaults to the provider's built-in model.                             |
| `${NAME}_TRANSLATE_MODEL`                                                 | Translation model for the Translate buttons. NVIDIA defaults to `riva-translate`; others translate with their tier-1 model.                                   |
| `${NAME}_BASE_URL`                                                        | Override a provider's base URL (https only).                                                                                                                  |
| `PROVIDER_RPM`, `${NAME}_RPM`                                             | Requests per minute per provider. Defaults to 35, under NVIDIA's 40 RPM free tier. `0` disables pacing (self-hosted endpoint).                                |
| `PROVIDER_TIMEOUT_MS`                                                     | Per-request timeout. Defaults to 90 s so a hung connection cannot stall a sync pass. `0` disables it.                                                         |
| `FETCH_TIMEOUT_MS`                                                        | Per-request timeout when polling a source or fetching an article. Defaults to 15 s. `0` disables it.                                                          |
| `FETCH_ARTICLE_BODIES`                                                    | Set to `0` to stop extracting article bodies from web pages and RSS teasers, falling back to headlines and feed text.                                         |
| `X_BRIDGE_BASE`                                                           | Optional https base URL of an RSS bridge serving X/Twitter timelines. Without it, X sources report that they need a paid API. Env only, never a source field. |

Settings → **Inference** shows which providers the server resolved, which model each one serves
per tier, and the fallback order.

Free tiers differ in what binds. NVIDIA's limit is requests per minute. Groq's free limits are
**per model** and in tokens (8K tokens/min, 200K tokens/day): an extraction uses about 2–2.5K
tokens, so one Groq model covers roughly 80–100 posts a day. Giving Groq different tier-1 and
tier-2 models gives each its own budget.

Never prefix a secret with `VITE_`: Vite exposes `VITE_*` variables to the browser bundle.

## Reference catalog (Wikipedia and Wikidata)

Catalog → **Import reference catalog** loads unmanned aerial, surface and ground vehicles and
loitering munitions linked to Ukraine or Russia from Wikidata, with their English, Ukrainian or
Russian Wikipedia article (`src/shared/infra/wikipedia.server.ts`). It runs on demand, not on a
schedule. For each system it fills in:

- **Identity:** name, Cyrillic name, aliases, domain, origin, manufacturer, operators, and a
  summary from the article lead. Existing values are kept; the import fills gaps.
- **Specifications:** weights (MTOW, empty, launch), payload and warhead, speeds, range, combat
  radius, endurance, ceiling and altitude, dimensions, engine, guidance and unit cost. They are
  read deterministically, with no AI calls (`src/shared/infra/wiki-specs.ts`), from:
  - the article's infobox or spec template: `Infobox weapon`, `{{Aircraft specs}}`, Ukrainian
    `Картка:БПЛА`, Russian `Карточка ЛА`;
  - a bulleted "Specifications" section, the form many English aviation articles use;
  - Wikidata quantity statements, for figures the article does not give.

Each figure is added as a **claim** sourced to the article, with the template line as evidence.
It never replaces a figure from reporting: consensus weighs Wikipedia as one source among
others. Imperial values are converted to metric, and only the first infobox in an article is
read, since later ones usually describe variants. Re-running the import adds nothing new unless
the article changed. Articles that describe specs only in prose (common on Russian Wikipedia)
yield identity but no figures.

Content is CC BY-SA 4.0; each imported system records the article, revision and licence.

## Scheduled auto-ingest

A Nitro task polls every monitored source every 10 minutes and runs relevant posts through the
pipeline above. It runs **only in the built app**: Nitro is a build-time plugin here, so
`npm run dev` schedules nothing.

| Where                                    | What                                             |
| ---------------------------------------- | ------------------------------------------------ |
| `vite.config.ts`                         | Cron expression and the `sources:sync` task name |
| `tasks/sources/sync.ts`                  | Task entry point; calls the shared `runAutoSync` |
| `src/shared/infra/source-sync.server.ts` | Throttle, cooldown and stored run state          |
| `src/shared/infra/fetch-posts.server.ts` | Server-side ingest body                          |
| `src/shared/infra/fetch-posts.ts`        | Transport parsing, shared with the browser       |
| `src/features/sources/auto-ingest.ts`    | Collection and the bounded queue processor       |

**Collection.** Stage 1 fetches every monitored source in parallel: six lanes, with at most one
in-flight request per host, so sources sharing a host do not trip its rate limit together. Each
request has a deadline, so one dead endpoint cannot hold the pass open.

A web page is either an article or an index of links. Article pages are read with Readability
(Firefox Reader View's algorithm, on linkedom, server-side only): navigation, related-story
blocks and boilerplate are dropped and the body is stored. Index pages keep every headline, and
the top three are replaced with the bodies behind them. RSS items that carry only a teaser are
followed the same way. Any single failure falls back to the headline.

**One story, once.** The same story often arrives from a Telegram channel, an RSS feed and a news
site within minutes. Each post is fingerprinted with a 64-bit SimHash
(`src/entities/dispatch/simhash.ts`), and a copy of a story already stored is written as a
`duplicate` stub: its text is stripped so it is never analysed, its external id is kept so it is
never collected again, and it points at the original so the archive still shows which sources
carried it. Without this, three copies became three claims citing different sources, and
`consensus()` counted one fact three times. The tolerance (10 of 64 bits) was measured: reworded
copies land 7–8 bits apart, unrelated reports 23–36.

**Processing.** Stage 2 drains the queue for up to 8 minutes per run, so a run never overlaps the
next tick; whatever is left waits for the next one. The batch size follows the pacing budget.

**Throttle.** Each run claims a slot in `sync_state` with a compare-and-swap upsert, so
overlapping ticks cannot both proceed, and the 9-minute floor holds across restarts. The manual
"Sync all now" button forces past the floor; the cron does not. Auto-sync needs `DATABASE_URL`.

**Per-dispatch lease.** The throttle guards the job; the lease guards each dispatch.
`processPending` claims dispatches with `for update skip locked`, so a manual "Analyse queue"
overlapping a cron tick cannot process the same post twice. Leases are released when the batch
ends, and expire on their own (5 min to 1 h, scaled to the batch) so a crashed worker never pins
a post.

## PostgreSQL

`docker compose up` starts PostgreSQL 18 with the schema in `migrations/` (plain, portable SQL),
mounted into the container's init directory. The app container gets its own `DATABASE_URL`
pointing at the `db` service. For `npm run dev`, `DATABASE_URL` must use the published host port
`5435`, not the container port `5432`.

To start from an empty database, drop the volume: `docker compose down -v`.

### Running a migration manually

Migrations only run automatically on a fresh volume. To apply a new one to an existing database,
pipe the file into `psql`:

```bash
# bash / zsh
docker compose exec -T db psql -U droneint -d droneint -v ON_ERROR_STOP=1 \
  < migrations/007_source_endpoints.sql
```

```powershell
# Windows PowerShell (the `<` redirect isn't supported there)
Get-Content migrations/007_source_endpoints.sql -Raw |
  docker compose exec -T db psql -U droneint -d droneint -v ON_ERROR_STOP=1
```

- `ON_ERROR_STOP=1` makes `psql` stop at the first failing statement instead of reporting success.
- The scripts use `create table/index if not exists`, so re-running one is safe.
- `-T` disables TTY allocation, which piping stdin through `docker compose exec` requires.

A database created before a migration existed needs it applied by hand. Posts stored before
`006_dispatch_content_hash.sql` have no fingerprint; they are fingerprinted when first read, so no
backfill is needed. Without the lease columns from `004_dispatch_lease.sql`, claiming silently
falls back to plain reads, which allows double processing.
