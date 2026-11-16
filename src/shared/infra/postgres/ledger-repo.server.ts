import type { JSONValue } from "postgres";
import type {
  AutonomyActorKind,
  AutonomyEvent,
  AutonomyEventKind,
  LedgerJson,
} from "@/shared/contracts/verification";
import type { LedgerRepo } from "@/shared/contracts/ledger-repo";
import { db } from "@/shared/infra/postgres/db.server";
import { sanitizeJson } from "@/shared/infra/json-sanitize";

const json = (v: unknown) =>
  v === undefined || v === null ? null : db().json(sanitizeJson(v as JSONValue));

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

/** PostgreSQL adapter for LedgerRepo. */
export function createPostgresLedgerRepo(): LedgerRepo {
  return {
    async append(input) {
      const sql = db();
      await sql`insert into autonomy_events (action, actor, actor_kind, target_collection, target_id,
        category, verdict, before, after, reason, checks, confidence, reversible, correlation_id)
      values (${input.action}, ${input.actor}, ${input.actorKind},
        ${input.targetCollection}, ${input.targetId},
        ${input.category}, ${input.verdict}, ${json(input.before)},
        ${json(input.after)}, ${input.reason}, ${json(input.checks)},
        ${input.confidence}, ${input.reversible}, ${input.correlationId})`;
    },

    async pruneHeartbeats(kinds, keep) {
      const sql = db();
      await sql`delete from autonomy_events e
        where e.action = any(${[...kinds]})
          and e.id in (
            select id from autonomy_events where action = any(${[...kinds]})
              order by at desc offset ${keep})
          and not exists (select 1 from autonomy_events r where r.reversed_by = e.id)`;
    },

    async recent(limit) {
      const rows = await db()<Row[]>`
      select id, at, action, actor, actor_kind, target_collection, target_id, category, verdict,
             before, after, reason, confidence, reversible, reversed_by, correlation_id
        from autonomy_events order by at desc limit ${limit}`;
      return rows.map((r): AutonomyEvent => ({
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
    },
  };
}
