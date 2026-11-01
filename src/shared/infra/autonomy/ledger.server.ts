import type { JSONValue } from "postgres";
import { db, dbConfigured } from "@/shared/infra/postgres/db.server";
import { sanitizeJson } from "@/shared/infra/json-sanitize";
import {
  HEARTBEAT_EVENT_KINDS,
  type AutonomyActorKind,
  type AutonomyEvent,
  type AutonomyEventKind,
  type LedgerJson,
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

const json = (v: unknown) =>
  v === undefined || v === null ? null : db().json(sanitizeJson(v as JSONValue));

export async function recordAutonomyEvent(input: AutonomyEventInput): Promise<void> {
  if (!dbConfigured()) return;
  try {
    const sql = db();
    await sql`insert into autonomy_events (action, actor, actor_kind, target_collection, target_id,
        category, verdict, before, after, reason, checks, confidence, reversible, correlation_id)
      values (${input.action}, ${input.actor.slice(0, 200)}, ${input.actorKind},
        ${input.targetCollection.slice(0, 100)}, ${input.targetId.slice(0, 200)},
        ${input.category ?? null}, ${input.verdict ?? null}, ${json(input.before)},
        ${json(input.after)}, ${input.reason?.slice(0, 2000) ?? null}, ${json(input.checks)},
        ${input.confidence ?? null}, ${input.reversible ?? true}, ${input.correlationId ?? null})`;
    if ((HEARTBEAT_EVENT_KINDS as readonly string[]).includes(input.action)) {
      // Only heartbeat kinds, by explicit list, and never a row another event points back at.
      const kinds = [...HEARTBEAT_EVENT_KINDS];
      await sql`delete from autonomy_events e
        where e.action = any(${kinds})
          and e.id in (
            select id from autonomy_events where action = any(${kinds})
              order by at desc offset ${KEEP_HEARTBEATS})
          and not exists (select 1 from autonomy_events r where r.reversed_by = e.id)`;
    }
  } catch (e) {
    console.error("[autonomy] could not record event", e);
  }
}

interface Row {
  id: string;
  at: Date;
  action: string;
  actor: string;
  actor_kind: string;
  target_collection: string;
  target_id: string;
  category: string | null;
  verdict: string | null;
  before: LedgerJson | null;
  after: LedgerJson | null;
  reason: string | null;
  confidence: number | null;
  reversible: boolean;
  reversed_by: string | null;
  correlation_id: string | null;
}

export async function listAutonomyEvents(limit = 100): Promise<AutonomyEvent[]> {
  if (!dbConfigured()) return [];
  try {
    const rows = await db()<Row[]>`
      select id, at, action, actor, actor_kind, target_collection, target_id, category, verdict,
             before, after, reason, confidence, reversible, reversed_by, correlation_id
        from autonomy_events order by at desc limit ${Math.min(Math.max(limit, 1), 500)}`;
    return rows.map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      action: r.action as AutonomyEventKind,
      actor: r.actor,
      actorKind: r.actor_kind as AutonomyActorKind,
      targetCollection: r.target_collection,
      targetId: r.target_id,
      ...(r.category ? { category: r.category } : {}),
      ...(r.verdict ? { verdict: r.verdict } : {}),
      ...(r.before != null ? { before: r.before } : {}),
      ...(r.after != null ? { after: r.after } : {}),
      ...(r.reason ? { reason: r.reason } : {}),
      ...(r.confidence != null ? { confidence: Number(r.confidence) } : {}),
      reversible: r.reversible,
      ...(r.reversed_by ? { reversedBy: r.reversed_by } : {}),
      ...(r.correlation_id ? { correlationId: r.correlation_id } : {}),
    }));
  } catch (e) {
    console.error("[autonomy] could not read events", e);
    return [];
  }
}
