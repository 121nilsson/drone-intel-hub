import type { AuditFrameReads, AuditRow, DesignRow } from "@/shared/contracts/audit-repo";
import type { Sql } from "@/shared/infra/postgres/db.server";

/**
 * The reads of the audit's design and frame that the status and the draw share. They take the
 * connection they run on, so the draw runs them inside its transaction and the status outside it.
 */

export async function auditedClaimIds(sql: Sql): Promise<string[]> {
  const rows = await sql<{ claim_id: string }[]>`select distinct claim_id from verification_audit`;
  return rows.map((r) => r.claim_id);
}

/** The most recent formal design, with the rows its status is computed from. */
export async function latestFormalDesign(sql: Sql): Promise<DesignRow | undefined> {
  const [design] = await sql<DesignRow[]>`select id, sampling_design from audit_batches
    where purpose = 'formal_eval' order by drawn_at desc limit 1`;
  return design;
}

/** The rows drawn under one formal design, with their sample units' strata. */
export async function formalDesignRows(sql: Sql, designId: string): Promise<AuditRow[]> {
  return await sql<AuditRow[]>`select a.id, a.batch_id, a.position, a.role, a.language,
      a.answer, a.drawn_at, a.control_kind, a.control_disputed_at, a.audit_batch_id,
      a.sample_unit_id, u.stratum as unit_stratum
    from verification_audit a left join audit_sample_units u on u.id = a.sample_unit_id
    where a.audit_batch_id = ${designId}`;
}

export const frameReads = (sql: Sql): AuditFrameReads => ({
  auditedClaimIds: () => auditedClaimIds(sql),
  latestFormalDesign: () => latestFormalDesign(sql),
  formalDesignRows: (designId) => formalDesignRows(sql, designId),
});
