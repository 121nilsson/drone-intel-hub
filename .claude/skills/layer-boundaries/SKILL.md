---
name: layer-boundaries
description: Where a new piece of code belongs in drone-intel-hub, and how to keep the layering rules green. Use when adding a feature slice, moving a module between layers, wiring a new shared service, or when eslint reports no-cross-feature-import, no-lower-layer-feature-import, no-server-import-from-client or no-nordic-ui-copy. Also use when a page starts importing another slice, or when shared code starts importing a slice.
---

# Layer boundaries

The repo stacks downwards, and the direction is enforced by lint rather than by convention:

```
src/entities/          pure domain. Imports nothing outside src/entities.
src/shared/contracts/  interfaces shared by more than one slice.
src/shared/infra/      implementations and shared application services.
src/shared/ui/         shared presentational widgets.
src/features/<slice>/  slice-specific UI and composition.
src/routes/            route components; may import features.
```

A feature may not import another feature. `src/shared` and `src/entities` may not import
`src/features` at all — that is the inversion that makes a shared module impossible to reuse
outside the slice that happens to own it.

`eslint-rules/index.js` checks all of this, so the rules below are not advice; they are what
the build will tell you.

---

## 1. Place the code before you write it

**Pure domain logic** — no I/O, no imports outside `src/entities` — goes in `src/entities/`.
Ask: does it touch a repository, a network call, or a React hook? If not, it is domain logic.

**An interface two slices need** goes in `src/shared/contracts/`. It is a `type` or an
`interface` (or a function type, when there is no state to hold — see `Adjudicator` in
`contracts/ai.ts`), and it names what the caller gets, not how it is built.

**The implementation of a contract** goes in `src/shared/infra/`. Pick the sub-area by subject,
the way the existing ones do: `shared/infra/ingest/` (the pipeline and the queue),
`shared/infra/evaluation/` (the rule engine), `shared/infra/sources/` (collection),
`shared/infra/storage/`, `shared/infra/heuristics/`.

**A widget several pages show** goes in `src/shared/ui/`. If it currently lives in a page module
and another slice imports it, that is a cross-slice import waiting to happen — move the
component, do not re-export it.

**Everything else** is slice-specific and stays in `src/features/<slice>/`.

## 2. When a second slice needs the code

Do not import it from the first slice. In order of preference:

1. **Move it down.** If it is pure domain, `src/entities/`. If it is an implementation,
   `src/shared/infra/`.
2. **Put it behind a contract.** If the caller needs an _operation_ rather than the parts it
   works on, define the contract in `src/shared/contracts/`, implement it in `src/shared/infra/`,
   and expose it through the composition root (`src/shared/infra/services.tsx`). A page then
   writes `svc.catalog.merge(a, b)` instead of assembling `{ drones, candidates }` itself.
   That is the whole point: the call site should not know the implementation's ingredients.
3. **Extract the shared widget** into `src/shared/ui/` when the shared thing is presentation.

## 3. Server code stays on the server

A module that the browser can reach may not import a `*.server.ts` module **by value** — the
server module would be pulled into the browser bundle. `*.server.ts` and `*.functions.ts` may.
A `import type` is erased at build time, so a shared type may still live next to its
implementation.

When browser-reachable code needs an AI call, use the injectable transport pattern:
take a `ChatTransport` and default it to the `chatCompletion` server-function proxy
(`ai-proxy.functions.ts`). A scheduled task then injects `chatCompletionOnce` instead, because
a server function has no context outside a request. `OpenAICompatibleExtractor` and
`openAIProcurementExtractor` are the two worked examples.

## 4. UI copy is English

`no-nordic-ui-copy` fails a build when a UI string carries a Nordic character. Cyrillic and
Greek are allowed on purpose: the catalog shows Russian and Ukrainian system names verbatim,
and those are data.

- A Nordic word in a **UI string** is a bug. Translate it.
- A Nordic word that is genuinely **data** — the Swedish lexicon, the stopword corpus in
  `src/shared/lexicons/fillers.ts` — belongs in the lexicon layer, where the rule does not
  reach. Move it there rather than suppressing it.
- If a literal really has to carry a Nordic name, the rule's own escape hatch is an inline
  `// eslint-disable-next-line @repo/no-nordic-ui-copy` **with the reason**.

## 5. Check the result

```bash
npx eslint src tasks          # the four @repo rules must be silent
npx tsc --noEmit              # types
npm run green                 # tsc + eslint + prettier + vitest, diffed against the baseline
```

`npm run green` is the gate that matters: it fails only on findings that are _new_ against the
saved baseline, so an unrelated pre-existing warning does not block you. See the
`change-discipline` skill for how the baseline works.

---

## Common mistakes

| Symptom                         | Cause                                                  | Fix                                                                                   |
| ------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `no-cross-feature-import`       | A page imports another slice's module                  | Move the module to `shared/` or `entities/`, or put an operation behind a contract    |
| `no-lower-layer-feature-import` | `shared/` or `entities/` imports a slice               | Invert it: the shared module takes the behaviour as a parameter or through a contract |
| `no-server-import-from-client`  | A browser-reachable module imports `*.server` by value | Inject a transport, or use the `chatCompletion` server-function proxy                 |
| `no-nordic-ui-copy`             | A UI string carries a Nordic character                 | Translate it, or move genuinely-foreign data into `src/shared/lexicons/`              |
