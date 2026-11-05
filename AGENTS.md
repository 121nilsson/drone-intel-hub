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

## Rules

Reasons, file names and history for every rule below are in [docs/architecture.md](docs/architecture.md).

**Layers.** Feature-Sliced, and lint enforces it (`eslint-rules/index.js`): `entities` → `shared/contracts` → `shared/infra` → `shared/ui` → `features/<slice>` → `routes`. Nothing reaches back up, a feature never imports another feature, and code two slices need lives in `shared/`. Features depend only on contracts; the implementations are chosen in `src/shared/infra/services.tsx` and nowhere else. A page asks for an operation (`svc.catalog.merge`), never for the parts it works on.

**Server and storage.** AI calls go through the `chatCompletion` server-function proxy. Code that touches the database lives in `*.server.ts` and is dynamically imported inside server-function handlers; browser code never imports one by value. Persistence goes through the `DocumentStore` contract, a write carries the revision it read, and a page that renders from the store uses `useAttached` and the list hooks in `shared/infra/use-services.ts`, whose server snapshot is the seed, so it hydrates to the server's markup; a storage failure is shown to the analyst: the app never falls back from server storage to browser storage on its own. Migrations in `/migrations` are plain portable SQL and must stay idempotent.

**Copy.** Page copy is English (`no-nordic-ui-copy`). A Russian or Ukrainian system name is data and may appear as is.

**Structure.** A big module is split into concern files behind a barrel that keeps the old import path, and a barrel only re-exports. Formatting helpers two slices share live in `shared/ui/format.ts`. Every autonomous loop's on/off switch is defined once in `shared/infra/autonomy/switches.server.ts`; a loop never reads `process.env` itself.

**Autonomy and identity.** The analyst's verdict on a claim outranks every automated one. Nothing that learns reads the audit seed set. Verification is measured, not yet counted in consensus. Identity changes (aliases, families, origin, merges) are proposed, never applied unattended. What a learner may ask for is a `Proposal` (`shared/contracts/proposals.ts`): its kind needs a registered applier, its risk is set by code and never by the proposer, and `AUTO_APPLY_TIERS` stays empty until Phase 3 of `get_human_out_of_the_loop_plan.md`. Every autonomous decision is written to `autonomy_events`, and an event kind is added in the same change as the code that writes it.

## Working here

- Run `npm run green` before and after a change; only new findings block. Skill `change-discipline`.
- Placing code, or fixing a lint boundary error: skill `layer-boundaries`.
- A refactor that should only move code, or work delegated to agents: skill `refactor-waves`. Prove a move with `node scripts/verify-move.mjs`.
- A new loop, switch, ledger event or `Proposal` kind: skill `autonomy-change`.
- A path named in a doc must exist (`src/test/docs-paths.test.ts`). Check what a doc claims against the code, not only the paths you touched.
