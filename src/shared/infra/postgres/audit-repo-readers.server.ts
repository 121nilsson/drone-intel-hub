import type {
  AuditLegacyBackfill,
  AuditReaderHistory,
  ReaderRecord,
  ReaderRow,
} from "@/shared/contracts/audit-repo";
import type { ClaimEntailment } from "@/entities/drone/types";
import { db, type Sql } from "@/shared/infra/postgres/db.server";

/** Append readings; a duplicate at_draw for an audit item is refused by the unique index. */
export async function appendReaderRows(sql: Sql, rows: readonly ReaderRow[]): Promise<void> {
  if (!rows.length) return;
  await sql`insert into verification_audit_reader ${sql(rows as unknown as Record<string, unknown>[])}`;
}

export async function readerRecords(
  sql: Sql,
  auditIds: readonly string[],
): Promise<ReaderRecord[]> {
  if (!auditIds.length) return [];
  return await sql<ReaderRecord[]>`select audit_id, phase, verdict, independence, evaluated_at,
      before_human_answer, span, note
    from verification_audit_reader where audit_id = any(${[...auditIds]}) order by evaluated_at`;
}

/** What the second reader needs of the audit to measure itself. */
export function readerHistoryPart(): AuditReaderHistory {
  return {
    async auditedClaimIdsExceptControls() {
      const rows = await db()<
        { claim_id: string }[]
      >`select distinct claim_id from verification_audit
      where role <> 'control'`;
      return rows.map((r) => r.claim_id);
    },

    async fingerprintedItems(claimIds) {
      return await db()<
        {
          id: string;
          claim_id: string;
          claim_fingerprint: string | null;
          answered_at: Date | null;
        }[]
      >`select id, claim_id, claim_fingerprint, answered_at from verification_audit
     where claim_id = any(${[...claimIds]}) and role <> 'control' and claim_fingerprint is not null`;
    },

    async appendReaderRows(rows) {
      await appendReaderRows(db(), rows);
    },
  };
}

/** The one-off backfill of readings for items drawn before they were frozen (migration 026). */
export function legacyBackfillPart(): AuditLegacyBackfill {
  return {
    async legacyItemsWithoutHistory() {
      return await db()<
        {
          id: string;
          claim_id: string;
          drone_id: string;
          post_text: string | null;
          answered_at: Date | null;
        }[]
      >`select a.id, a.claim_id, a.drone_id, a.post_text, a.answered_at
      from verification_audit a
     where a.role <> 'control'
       and a.sampling_purpose = 'legacy'
       and not exists (select 1 from verification_audit_reader r where r.audit_id = a.id)`;
    },

    async currentReadings(droneIds) {
      return await db()<{ id: string; entailment: ClaimEntailment }[]>`
            select c->>'id' as id, c->'entailment' as entailment
              from drones d,
                   jsonb_array_elements(d.data->'specs') s,
                   jsonb_array_elements(s->'claims') c
             where d.id = any(${[...droneIds]}) and c ? 'entailment'`;
    },

    async markReaderStateLegacy(auditIds) {
      await db()`update verification_audit set reader_state_at_draw = 'legacy_unverified'
       where id = any(${[...auditIds]}) and reader_state_at_draw is null`;
    },
  };
}
