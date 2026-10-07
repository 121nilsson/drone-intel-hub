# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS

## Self-hosting with PostgreSQL

```bash
docker compose up --build   # app on http://localhost:3010
```

Migrations in `migrations/` run automatically on first DB start. Without `DATABASE_URL` the app stores data in the browser.

## Local development with PostgreSQL in Docker

Run only the database and point the dev server at it:

```bash
docker compose up -d db                 # Postgres on 127.0.0.1:5435
cp .env.example .env                    # then edit if you changed the password
npm run dev                             # Vite picks .env up via nitro
```

The database is created and migrated on first start. To re-run migrations from
scratch, drop the volume: `docker compose down -v`.

`.env` is gitignored; `.env.example` is the committed template. `DATABASE_URL`
must use the published host port (`5435`), not the container port (`5432`).

## Inference provider

The app runs a built-in heuristic engine when no provider is configured. To use
NVIDIA NIM, copy `.env.local.example` to `.env.local` and set the key:

```bash
cp .env.local.example .env.local   # then paste NVIDIA_API_KEY
```

| Variable | Purpose |
| --- | --- |
| `NVIDIA_API_KEY` | NIM API key. Stays on the server, never sent to the browser. |
| `NVIDIA_BASE_URL` | Any OpenAI-compatible base URL. Defaults to NIM. |
| `NVIDIA_TIER1_MODEL` | Fast screening model. |
| `NVIDIA_TIER2_MODEL` | Reasoning model used for escalation and briefings. |
| `PROVIDER_RPM` | Requests/min the shared transport paces itself to. Defaults to 35, under the 40 RPM free-tier cap. Set `0` to disable (self-hosted endpoint). |
| `PROVIDER_TIMEOUT_MS` | Per-request timeout. Defaults to 90 s, so a hung provider cannot stall a sync pass while holding its pacing slot. Set `0` to disable. |

`.env.local` wins over anything saved in the browser's Settings page, per field.
Clear `NVIDIA_API_KEY` to fall back to a key stored in Settings, and leave that
blank too to return to the local engine.

### Rate limits

The transport paces every request start so the aggregate rate stays under the
key's cap, no matter how many callers share it — a cron tick, a manual sync and a
browser tab all draw on the same budget. A `429` or transient `5xx` is retried
with exponential backoff and full jitter, honouring `Retry-After`, rather than
surfacing as a failed extraction.

Each dispatch is processed independently and stays `pending` until it succeeds, so
one rate-limited post does not abandon the rest of the queue. A dispatch that keeps
failing is retried on later ticks and marked `failed` after `MAX_ATTEMPTS`.

## Scheduled auto-ingest

A Nitro task polls every monitored source on a cron and runs drone-relevant posts
through the same two-tier pipeline the UI uses. It runs **only in the built app** -
Nitro is a build-time plugin here, so `npm run dev` does not schedule anything.

```
docker compose up --build   # then wait for the first tick, or press "Sync all now"
```

| Where | What |
| --- | --- |
| `vite.config.ts` | Cron expression and the `sources:sync` task name |
| `tasks/sources/sync.ts` | Task entry point; calls the shared `runAutoSync` |
| `src/shared/infra/fetch-posts.server.ts` | Server-side ingest body |
| `src/shared/infra/fetch-posts.ts` | Transport parsing, shared with the browser |

**Throttle.** Every run claims a slot in `sync_state` via a compare-and-swap upsert,
so overlapping ticks cannot both proceed and the minimum interval (1 min) holds even
across restarts. The manual button forces past the throttle; the cron does not. This
needs `DATABASE_URL` - without it auto-sync reports that it is unavailable.

To change the cadence, edit the cron in `vite.config.ts`. Applying
`migrations/002_sync_state.sql` only happens on a fresh volume, so run it by hand if
the table is missing on an existing database.
