import type { AuditReports, AuditRow, DisagreementRow } from "@/shared/contracts/audit-repo";
import { db } from "@/shared/infra/postgres/db.server";
import { auditedClaimIds, formalDesignRows, latestFormalDesign } from "./audit-repo-design.server";
import { readerRecords } from "./audit-repo-readers.server";

/** Reading the audit's state back: the rows the status and the disagreement list are built from. */
export function reportPart(): AuditReports {
  return {
    auditedClaimIds: () => auditedClaimIds(db()),
    latestFormalDesign: () => latestFormalDesign(db()),
    formalDesignRows: (designId) => formalDesignRows(db(), designId),

    async statusRows() {
      return await db()<AuditRow[]>`select a.id, a.batch_id, a.position, a.role, a.in_seed,
      a.drone_id, a.drone_name, a.spec_label, a.claim_id, a.language, a.family, a.value, a.evidence,
      a.source, a.source_id, a.answer, a.obviously_wrong, a.read_via, a.drawn_at, a.control_kind,
      a.control_disputed_at, a.audit_batch_id, a.sampling_purpose, a.sample_unit_id,
      u.stratum as unit_stratum
    from verification_audit a left join audit_sample_units u on u.id = a.sample_unit_id`;
    },

    async readerRecords(auditIds) {
      return await readerRecords(db(), auditIds);
    },

    async postTextOf(auditId) {
      const [post] = await db()<{ post_text: string | null }[]>`select post_text
      from verification_audit where id = ${auditId}`;
      return post?.post_text ?? null;
    },

    async countUndrawn() {
      const [counted] = await db()<{ undrawn: number }[]>`
    select count(*)::int as undrawn
      from drones d,
           jsonb_array_elements(d.data->'specs') s,
           jsonb_array_elements(s->'claims') c
      join dispatches p on p.id = c->>'sourceId' and coalesce(p.data->>'text', '') <> ''
     where c->'verification'->>'state' = 'verified'
       and c->>'id' is not null
       and not exists (select 1 from verification_audit a where a.claim_id = c->>'id')`;
      return counted?.undrawn ?? 0;
    },

    async answeredRows() {
      return await db()<
        DisagreementRow[]
      >`select id, batch_id, position, role, in_seed, drone_id, drone_name, spec_label, claim_id,
      language, family, value, evidence, source, source_id, post_text, answer, obviously_wrong,
      read_via, drawn_at, control_kind, control_disputed_at, second_look, sample_unit_id
    from verification_audit where answer is not null`;
    },

    async unitSiblings(units) {
      return await db()<{ id: string; sample_unit_id: string }[]>`select id, sample_unit_id
        from verification_audit where sample_unit_id = any(${[...units]})`;
    },
  };
}
