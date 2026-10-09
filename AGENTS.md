<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

## Architecture

- Feature-Sliced: features live in src/features/<slice>, shared contracts in src/shared/contracts, entities in src/entities — keeps slices decoupled.
- Features depend only on contracts (DroneRepository, IntelExtractor, BriefingSummarizer); concrete implementations are chosen solely in src/shared/infra/services.tsx — so storage/inference can be swapped without touching features.
- External AI calls go through the chatCompletion server function proxy — keeps provider calls off the browser.
- Persistence goes through the async DocumentStore contract (src/shared/contracts/store.ts); repositories are write-through caches that attach a store at startup — so localStorage, PostgreSQL or any DB swap without touching features.
- PostgreSQL is selected automatically when the server has DATABASE_URL; schema lives as plain portable SQL in /migrations (also mounted by docker-compose) — keeps the DB vendor-neutral and self-hostable.
- Server-only DB code lives in *.server.ts files and is dynamically imported inside server-function handlers — keeps the driver out of the browser bundle.
- Ingestion is two-stage: collectors only store raw posts as pending dispatches (no AI); a bounded processor drains the queue and records provenance — keeps scraping fast and AI work resumable.
- Shared storage selection happens in store.functions.ts: DATABASE_URL → PostgresStore, else Lovable Cloud → CloudStore (server-only, service role; tables have RLS with no client policies) — browser never talks to the DB directly.
