import { serverServices } from "@/shared/infra/server-services.server";
import {
  HEARTBEAT_EVENT_KINDS,
  type AutonomyActorKind,
  type AutonomyEvent,
  type AutonomyEventKind,
  type VerificationRunRecord,
} from "@/shared/contracts/verification";

/**
 * The autonomy ledger (migrations/018). Append-only, best-effort: a decision that cannot be
 * recorded is logged and dropped, never allowed to fail the work it describes. The catalogue is
 * the source of truth; this is how the loop's behaviour is audited and rolled back.
 */

/** Heartbeats kept. Decisions are never pruned: `reversed_by` links point into them. */
const KEEP_HEARTBEATS = 2000;

export interface AutonomyEventInput {
  action: AutonomyEventKind;
  actor: string;
  actorKind: AutonomyActorKind;
  targetCollection: string;
  targetId: string;
  category?: string | null;
  verdict?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  checks?: unknown;
  confidence?: number | null;
  reversible?: boolean;
  correlationId?: string | null;
}

export async function recordAutonomyEvent(input: AutonomyEventInput): Promise<void> {
  try {
    const ledger = serverServices().ledger;
    await ledger.append({
      action: input.action,
      actor: input.actor.slice(0, 200),
      actorKind: input.actorKind,
      targetCollection: input.targetCollection.slice(0, 100),
      targetId: input.targetId.slice(0, 200),
      category: input.category ?? null,
      verdict: input.verdict ?? null,
      before: input.before,
      after: input.after,
      reason: input.reason?.slice(0, 2000) ?? null,
      checks: input.checks,
      confidence: input.confidence ?? null,
      reversible: input.reversible ?? true,
      correlationId: input.correlationId ?? null,
    });
    if ((HEARTBEAT_EVENT_KINDS as readonly string[]).includes(input.action)) {
      // Only heartbeat kinds, by explicit list, and never a row another event points back at.
      await ledger.pruneHeartbeats([...HEARTBEAT_EVENT_KINDS], KEEP_HEARTBEATS);
    }
  } catch (e) {
    console.error("[autonomy] could not record event", e);
  }
}

/** A verification run, as the ledger records it: wherever the run happened, one row the same shape. */
export async function recordVerificationRunEvent(run: VerificationRunRecord): Promise<void> {
  await recordAutonomyEvent({
    action: "verification_run",
    actor: `verifier:${run.verifierVersion}`,
    actorKind: "verifier",
    targetCollection: "drones",
    targetId: "catalogue",
    verdict: run.missingText > 0 ? "partial" : "complete",
    before: run.before,
    after: run.after,
    reason:
      `${run.checked} claim(s) checked, ${run.changed} entry(ies) updated, ` +
      `${run.missingText} without source text`,
    // A run changes nothing by itself; the claims it re-verified carry their own verdicts.
    reversible: false,
  });
}

export async function listAutonomyEvents(limit = 100): Promise<AutonomyEvent[]> {
  try {
    return await serverServices().ledger.recent(Math.min(Math.max(limit, 1), 500));
  } catch (e) {
    console.error("[autonomy] could not read events", e);
    return [];
  }
}
