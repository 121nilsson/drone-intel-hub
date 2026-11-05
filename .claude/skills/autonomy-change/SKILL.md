---
name: autonomy-change
description: Checklist for changing the autonomy machinery in drone-intel-hub - adding a loop or scheduled job, an on/off switch, a ledger event kind, a Proposal kind or applier, or anything that lets the system change data without a person. Use before touching shared/infra/autonomy, shared/infra/proposals, shared/contracts/proposals.ts, scheduled tasks or the verification and rule-promotion loops.
---

# Changing the autonomy machinery

The plan is `get_human_out_of_the_loop_plan.md`. The point of every rule below is that a person can
still see what the system did and undo it.

## Adding a loop or scheduled job

1. Add it to `SCHEDULED_TASKS` (`src/shared/contracts/scheduled-tasks.ts`); `vite.config.ts` and the
   Evaluation page read that one list.
2. If it can change data on its own, give it a switch in `AUTONOMY_SWITCHES`
   (`shared/infra/autonomy/switches.server.ts`), read with `autonomySwitchEnabled(name)` at call
   time, and put the name in the job's `switch` field. Never read `process.env` in the loop.
3. Run it through `recordTaskRun` so a failure and a skip are visible.
4. Test: switch off means no change, and the job names a defined switch.

## Writing to the ledger

- Every autonomous decision writes one `autonomy_events` row (`ledger.server.ts`), with before and
  after and a way back. Decisions are kept forever; only kinds in `HEARTBEAT_EVENT_KINDS` are pruned.
- Add the kind to `AUTONOMY_EVENT_KINDS` in the same change as the code that writes it, never before.
  A kind nothing writes makes the ledger look more complete than it is.

## Proposals

- A change request is a `Proposal`. A new kind needs an applier in `shared/infra/proposals`
  registered in `PROPOSAL_APPLIERS`, tests, and its ledger event kind, all in one change. A kind
  without an applier is refused by `admitProposal`.
- The applier's `check` assigns the risk tier from the kind and payload. The proposer's own risk is
  ignored. Aliases and stopwords are high risk: an alias files claims under the wrong system and
  removing it does not re-file them.
- `AUTO_APPLY_TIERS` is empty and stays empty until Phase 3 of the plan: audited verified precision
  within the low budget (5 %). Check `/audit` before proposing to open it; it is measured by a person.
- Payloads stay data in the literal-terms DSL, never regex or code.

## Who outranks whom

The analyst's verdict (`SpecClaim.review`) outranks every automated one. Nothing that learns may read
the audit seed set (`verification_audit`) or change the verifier or the frozen holdout. A learner
is never scored on data it was fitted on. Identity changes (aliases, families, origin, merges) are
proposed and never applied unattended.

## Measured, not acted on

Verification and the second reader are measured and not yet read by consensus. A change that makes
consensus read them is a Phase 3 change: it needs the audit result first, and the UI must say that
uncertainty is measured, not withheld, until then.
