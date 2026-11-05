---
name: refactor-waves
description: How to run a refactor in drone-intel-hub that must only move code, alone or delegated to sub-agents in worktrees - splitting a big module behind a barrel, briefing agents, reviewing their diffs, proving nothing but the location changed. Use when splitting a file, deduplicating helpers across slices, or handing a mechanical change to an agent.
---

# Refactor waves

A refactor here means the behaviour is unchanged and a reviewer can prove it. These are the rules
that made the first three waves cheap to review.

## Shape of a wave

- One agent per area, and areas share no files. Two writers on one file means a conflict nobody
  chose.
- Split by concern, keep the old file as a barrel that only re-exports, so no importer outside
  the area changes. Code moves verbatim; a rewrite is a separate change.
- Module-level state (a lock, a map, a cache) stays one instance. Say so in the brief.
- Anything that is not a pure move - a class extracted to hold state, a deliberate behaviour
  change - is reported by the agent and reviewed by hand, with a test for the change.

## Briefing an agent

State: the goal, the files in scope and out of scope, the barrel rule, "move verbatim", the
verification (`npm run green` exits 0, no new lint findings), "one local commit, no push, no
history rewriting", and the report format. Add: "report a difference you find, do not decide it".
Agents that were told this declined to merge two components that only looked alike.

## Worktrees on this machine

- Create the `node_modules` junction first, with PowerShell: `New-Item -ItemType Junction -Path
node_modules -Target C:\dev\drone-intel-hub\node_modules`. Bash refuses compound commands in a
  worktree, so tell agents to use PowerShell from the start.
- Remove the junction before `git worktree remove`, or the removal can reach the real modules:
  `(Get-Item <worktree>\node_modules).Delete()`. Afterwards check `node_modules` still lists its
  entries.
- `.claude/worktrees` is ignored by eslint, prettier and git; keep it that way.

## Reviewing a diff

1. Read the commit stat, then prove the move:
   `node scripts/verify-move.mjs --base <ref> --old <old file> --new <part>... [--head <ref>]`.
   It compares top-level statements through the TypeScript printer, so prettier's re-wrapping is
   not noise. `LOST` or `EDITED` is what to read by hand; `new:` lines are barrels and helpers.
2. For UI parts the tool still applies, but JSX moves with new props, so also render the page.
3. Integrate with `git cherry-pick` (linear history, nothing published is rewritten), then run
   `npm run green` on main, not only in the agent's worktree.
4. Docker smoke: `docker compose up -d --build`, then open each page a split touched. A React
   hydration error (#418) on the dossier is old; check against the previous commit on a second
   port before blaming the refactor.

## Before pushing

Read every claim the docs make about the area, not only the paths you changed. The docs-path test
catches a missing file; it cannot catch "never called" or "922 lines". Anything you leave for later
goes in `docs/roadmap.md` with what was verified.
