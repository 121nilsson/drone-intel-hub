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
- Layers stack downwards and nothing reaches back up: src/entities (pure domain) → src/shared/contracts (interfaces) → src/shared/infra (implementations and shared application services) → src/shared/ui (shared widgets) → src/features/<slice> (slice UI) → src/routes. A feature may not import another feature, and src/shared and src/entities may not import src/features — so code two slices need lives in shared/, not in one slice's pocket.
- Those boundaries are enforced, not merely described: eslint-rules/index.js adds no-cross-feature-import, no-lower-layer-feature-import, no-server-import-from-client and no-nordic-ui-copy to the lint run, so a violation fails the build instead of waiting for a reviewer to notice.
- Features depend only on contracts (DroneRepository, IntelExtractor, BriefingSummarizer, CatalogMutations); concrete implementations are chosen solely in src/shared/infra/services.tsx — so storage/inference can be swapped without touching features.
- A page asks for an operation, never for the parts it works on: the catalog page calls svc.catalog.merge(...) rather than assembling the repositories, and the dossier calls svc.catalog.removalImpact(id) — so the implementation stays behind the contract and the call site stays readable.
- External AI calls go through the chatCompletion server function proxy — keeps provider calls off the browser.
- Persistence goes through the async DocumentStore contract (src/shared/contracts/store.ts); repositories are write-through caches that attach a store at startup — so localStorage, PostgreSQL or any DB swap without touching features.
- PostgreSQL is selected automatically when the server has DATABASE_URL; schema lives as plain portable SQL in /migrations (also mounted by docker-compose) — keeps the DB vendor-neutral and self-hostable.
- /migrations are applied at server start (plugins/migrate.ts → postgres/migrate.server.ts, recorded in schema_migrations, one transaction, requests wait on it); every file must stay idempotent because adopting an existing database re-runs them all once.
- Server-only DB code lives in *.server.ts files and is dynamically imported inside server-function handlers — keeps the driver out of the browser bundle. A browser-reachable module may not import a *.server module by value (a type-only import is erased at build and stays allowed).
- Ingestion is two-stage: collectors only store raw posts as pending dispatches (no AI); a bounded processor drains the queue and records provenance — keeps scraping fast and AI work resumable. The pipeline itself lives in src/shared/infra/ingest, because the queue, the catalog pages and the server-side collectors all drive it.
- Shared storage selection happens in store.functions.ts: DATABASE_URL → PostgresStore, else Lovable Cloud → CloudStore (server-only, service role; tables have RLS with no client policies) — browser never talks to the DB directly.
- Language vocabulary (money, units, cues) lives in per-language lexicons in src/shared/lexicons, shared by heuristic extractors and normalization; heuristics are split into names, facts orchestrator and per-class/fact-family extractors that read only lexicons — adding a language, term or system class never touches unrelated code.
- Page copy is English, and that is enforced too (no-nordic-ui-copy): a Russian or Ukrainian system name is data and may appear verbatim in the UI, but a Swedish word in a UI string is a mistake. Foreign words that are genuinely data (the Swedish lexicon, the stopword corpus in shared/lexicons/fillers.ts) live in the lexicon layer, where the rule does not reach.
- Financial/deal spec keys (contract_value, *_funding, total_cost…) are split out of extractions at the pipeline boundary (entities/procurement/routing.ts) into the procurements collection; only unit_cost stays a drone spec — keeps deal figures out of consensus.
- Layout primitives (Card, CardGrid, ListRow, Panel, PageTitle in src/shared/ui/primitives.tsx; ExternalSourceLink, SystemChip in src/shared/ui/links.tsx) own mobile width rules — pages compose them instead of hand-rolling card/row layouts, so a fix lands once. Widgets several slices share (the related-intel graph, the translate button) live in src/shared/ui for the same reason.
- Heuristic evaluation (src/shared/infra/evaluation) is read-only: it only calls heuristic.extract and reads candidates; agreements export to src/test/fixtures/eval-corpus.json, which eval-corpus.test.ts replays — so heuristic changes can't silently regress real reports.
- Dynamic heuristic rules live in dynamic_rules (migration 010) and reach the engine only as an immutable RuleSnapshot (src/shared/contracts/rules.ts); the server registry (shared/infra/heuristics/rule-registry.server.ts) refreshes it by version with a TTL and never throws — so extract() stays synchronous/pure and ingestion survives DB outages.
- A dynamic rule becomes active only through the in-process sandbox (src/shared/infra/evaluation/sandbox.ts, read-only): zero fixture regressions, no F1 drop, a measurable gain — and activation re-runs it against the rules active at that moment (shared/infra/evaluation/rule-sandbox.server.ts). The DSL carries literal terms only, never regex — so generated rules cannot backtrack or reach outside the words they name.
- After an AI pass, each stored spec records the AI's verdict on the heuristic's observation in `provenance` (both/heuristic/ai; entities/drone/extraction-gates.ts), and evaluation scores AI-dropped claims as rejected — so the heuristic is never measured against its own ingest-time output while the stored union still never drops a deterministic fact.
- Generated rules go sandbox → shadow → active; auto-promotion (shared/infra/evaluation/autonomy.ts) needs 48 h shadow on unseen reports, zero conflicts, ≥95 % shadow precision and ≥95 % trust from ≥20 analyst decisions in the category, max 2/day, and a nightly circuit breaker compares all-active vs active-minus-last-24h on the same sample — so autonomy is earned per category and rolled back on harm, never on data drift. `RULES_AUTOPROMOTE=off` disables it.
