---
name: change-discipline
description: Working rules for changing code in drone-intel-hub — verify the plan against the actual code before writing anything, match the repo's Feature-Sliced/SOLID conventions, and prove the result is green (tsc, eslint, prettier, vitest) by baseline-diff. Use before starting any implementation, bug fix, refactor, schema change, or new feature in this repo, and again before reporting the work as done.
---

# Change discipline

Three rules, in order. They are not decoration — each one exists because skipping it has already
cost real time in this repo.

1. **Verify the plan before you build.**
2. **Match what is already there.**
3. **Land green, proven, not assumed.**

---

## 1. Verify the plan against the code before writing anything

A plan is a set of assumptions about code you have not fully read. State them, then check each
one against the actual source before the first edit. Every rule below is a real way this has gone
wrong here.

### Find every call site before calling config dead or broken

A narrow grep proves nothing. `DEFAULT_TIER_CONFIG` looked dead because grepping for its _name_
found nothing — it was routed through `d.tier` and was very much live, routing tier-1 extraction
to Groq with an NVIDIA model id. Search for the field's consumers, its imports, and the shape it
travels in, not just its declaration.

> Before claiming something is unused, unused, dead, or broken: grep the identifier, grep the
> property it is read through, and open the file that consumes it. Three lookups minimum.

### Every ratio needs its denominator, and the denominator needs checking

"29% of every feed is discarded" was wrong. The items beyond the cap were counted without
checking whether they had **already been ingested** — they mostly had. The cap was a recency
filter doing its job. A second time, a whole-corpus ratio turned out to describe history that a
later commit had already fixed.

> Before quoting a number: write down the numerator, the denominator, and the time range. Then
> confirm the items in the denominator are actually _new_ work. "Counted" is not "lost".

### A measurement of the whole corpus is not a measurement of now

Before proposing a fix, scope the evidence to recent data and check the bug is still live. If a
fix landed earlier in the file's history, the problem you are solving no longer exists.

### 200 OK is not usable content

A candidate feed endpoint returning 200 was 19 of 25 posts of navigation chrome. Run the real
parser over real fetched items before adopting a source or changing an endpoint. If it is
already wired up, check what the pipeline does with what it gets.

### Baseline before you change, not after

Before editing, capture the starting state (`npm run green:save`, plus `git status`). Afterwards,
"pre-existing" should be a fact you recorded, not something you assumed because the number felt
old. A stale baseline file compared against fresh output will hide a regression _you_ caused.

### Check for work already in the tree

`git status` before you edit. This repo is Lovable-connected and has uncommitted work in files
people are actively changing — including changes staged by the user in the same file you are
about to touch. Never overwrite those; never rewrite published history (no force-push, rebase,
amend, or squash on commits that are already pushed).

### Re-check the plan once implementation starts

If the code says something different from the plan, the code wins. Stop and re-verify rather than
forcing the plan. A mid-flight correction is cheap; a finished wrong feature is not.

---

## 2. Match what is already there

Read the neighbouring files before writing a new one. The style is not a preference to satisfy —
it is what makes the slices decoupled.

### Structure

- **Feature-Sliced.** Features live in `src/features/<slice>`, entities in `src/entities`, shared
  contracts in `src/shared/contracts`, concrete implementations in `src/shared/infra`.
- **Features depend on contracts only** (`DroneRepository`, `IntelExtractor`, `BriefingSummarizer`).
  Never on another feature's internals, never directly on infrastructure.
- **The implementation is wired in exactly one place** — `src/shared/infra/services.tsx`. Adding a
  backend or an inference provider means editing that file, not the features.
- **External AI calls go through the `chatCompletion` server-function proxy.** No provider call
  from the browser.
- **Persistence goes through the `DocumentStore` contract.** Repositories are write-through caches
  that attach a store at startup, so storage can be swapped without touching features.
- **Server-only DB code lives in `*.server.ts`** and is dynamically imported inside server-function
  handlers, which keeps the driver out of the browser bundle.

### Extensibility, concretely

Open for extension means a new provider, store, or parser is a new entry implementing a contract —
not another branch in an `if`/`else` chain over string names. When you find yourself adding a
provider name to a conditional, the contract is the missing abstraction.

### Style

- Prettier: `printWidth` 100, double quotes, semicolons, trailing commas.
- Comments explain **why**, not what. A comment restating the line below it is noise; a comment
  recording a constraint, a rejected alternative, or a security reason earns its place.
- Match the file you are in. **Do not run prettier across a file that is not already
  prettier-formatted** — it produces hundreds of lines of unrelated churn and buries the real
  change. Check `npx prettier --check <file>` first.
- SQL migrations are portable plain SQL in `/migrations`, mounted by docker-compose. Predicate
  repairs on the **column**, not the table, so re-running fixes half-applied state.
- `src/integrations` is Lovable-generated and is excluded from lint on purpose. Do not hand-edit it.

### Tests

- Live in `src/test/`, one file per concern (`url-key.test.ts`, `provider-fallback.test.ts`).
- Name the behaviour, not the function: "surfaces the provider's own explanation" beats
  "testDetailFrom".
- Security-sensitive code gets adversarial tests, not just the happy path — that is what proves a
  redaction actually redacts.
- Gotchas that will otherwise waste your run:
  - `vite.config.ts` loads `.env` into `process.env`. A test that clears env vars must also clear
    `NVIDIA_TIER1_MODEL` / `TIER2_MODEL` and the tier route vars, or the "unset" case silently
    sees the developer's real config.
  - Module-level constants (`MIN_SPACING_MS` and friends) are frozen at import. Set pacing env
    **before** a dynamic `import()`, not in `beforeEach`.

---

## 3. Land green, proven

Do not report a test count you did not just see. Run the checks; report the output.

### Use the gate

```bash
npm run green:save     # BEFORE starting work — records the pre-existing finding set
# ... make your changes ...
npm run green           # AFTER — exits 1 if you introduced anything
```

`scripts/green-check.mjs` runs `tsc --noEmit`, `eslint .`, `prettier --check .` and `vitest run`,
and compares the findings against the saved baseline. **Only new findings block**; pre-existing
ones are tolerated and listed. Findings are keyed by file, rule and message — never by line
number — so an edit that shifts diagnostics does not read as a fresh pile of findings.

With no baseline saved it falls back to "no errors at all", which is what this repo currently
satisfies.

### Current state — know this so you can tell "pre-existing" from "yours"

| Check                | Baseline                  |
| -------------------- | ------------------------- |
| `tsc --noEmit`       | 0 errors                  |
| `eslint .`           | 0 errors, **14 warnings** |
| `prettier --check .` | clean                     |
| `vitest run`         | all passing               |

Those 14 warnings are `react-refresh/only-export-components` and `react-hooks/exhaustive-deps`.
They are a structural consequence of the Feature-Sliced layout, they are not errors, and fixing
one usually means restructuring rather than editing. Do not quietly clear them as drive-by, and
do not let them hide a real new warning of the same rule.

### If something is not green

Say so, and paste the actual output — the command and the real failure text. Do not describe a
check you did not run, and do not report a partial run as a full one. A check that was skipped is
reported as skipped.

If a check cannot be made green, say why and what it would take. That is a legitimate outcome;
silence is not.

### Before you call it done

- [ ] Every assumption in the plan was checked against the code, not just the first one
- [ ] Changes match the surrounding slice/contract conventions
- [ ] New behaviour has a test; security-sensitive behaviour has an adversarial one
- [ ] `npm run green` exits 0
- [ ] `git status` shows nothing you did not intend to touch
- [ ] Anything you could not verify is stated as unverified — not implied

---

## Report honestly

The most expensive failure mode is a confident, plausible, wrong claim — it costs more than not
answering, because it gets built on. Prefer "I could not reproduce this and here is what I ruled
out" over a guess. Every correction made during a task should end up in the final report, not
quietly dropped.
