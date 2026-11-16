import type { Drone } from "@/entities/drone/types";
import type { AuditDraw, AuditDrawTx, RetryRow } from "@/shared/contracts/audit-repo";
import { db, type Sql } from "@/shared/infra/postgres/db.server";
import { frameReads } from "./audit-repo-design.server";
import { appendReaderRows } from "./audit-repo-readers.server";

/** The unit of work a draw runs in: every statement on the transaction's own connection. */
function drawTx(sql: Sql): AuditDrawTx {
  return {
    ...frameReads(sql),

    async seedSetSize() {
      const [first] = await sql<{ n: number }[]>`select count(*)::int as n from verification_audit
      where in_seed`;
      return first?.n ?? 0;
    },

    async retryCandidates(designId) {
      return await sql<RetryRow[]>`
      select id, batch_id, position, role, in_seed, drone_id, drone_name, spec_label, claim_id,
             language, family, value, evidence, source, source_id, answer, obviously_wrong,
             read_via, drawn_at, control_kind, control_disputed_at, sample_unit_id
        from verification_audit where audit_batch_id = ${designId}`;
    },

    async insertDiagnosticDesign(design) {
      const [created] = await sql<{ id: string }[]>`
      insert into audit_batches
        (purpose, sampling_design, population_size, sample_size, seed, legacy_batch_id)
      values (${design.purpose}, ${sql.json(design.samplingDesign as Record<string, never>)},
              ${design.populationSize}, ${design.sampleSize}, ${design.seed}, null)
      returning id`;
      return created!.id;
    },

    async insertFormalDesign(design) {
      const [created] = await sql<{ id: string }[]>`
      insert into audit_batches (purpose, sampling_design, population_size, sample_size, seed)
      values ('formal_eval', ${sql.json(design.samplingDesign as unknown as Record<string, never>)},
              ${design.populationSize},
              ${design.sampleSize}, ${design.seed})
      returning id`;
      return created!.id;
    },

    async insertSampleUnits(units) {
      return await sql<{ id: string; claim_id: string }[]>`
      insert into audit_sample_units ${sql(
        units.map((u) => ({
          audit_batch_id: u.audit_batch_id,
          claim_id: u.claim_id,
          stratum: u.stratum,
          inclusion_probability: u.inclusion_probability,
        })),
      )} returning id, claim_id`;
    },

    async insertAuditRows(rows) {
      return await sql<{ id: string; position: number }[]>`
    insert into verification_audit ${sql(rows as unknown as Record<string, unknown>[])} returning id, position`;
    },

    async appendReaderRows(rows) {
      await appendReaderRows(sql, rows);
    },

    async insertRetryRows({ batchId, seed, ids }) {
      await sql`insert into verification_audit
        (batch_id, position, draw_seed, role, in_seed, drone_id, drone_name, spec_key, spec_label,
         claim_id, language, family, state_at_draw, verifier_version, value, evidence, source,
         source_id, post_text, audit_batch_id, sampling_purpose, sample_unit_id, retry_of_audit_id,
         claim_fingerprint, source_text_hash, reader_state_at_draw)
      select ${batchId}, row_number() over (order by a.id) - 1, ${seed}, 'audit', false, a.drone_id,
             a.drone_name, a.spec_key, a.spec_label, a.claim_id, a.language, a.family,
             a.state_at_draw, a.verifier_version, a.value, a.evidence, a.source, a.source_id,
             a.post_text, a.audit_batch_id, 'formal_eval', a.sample_unit_id, a.id,
             a.claim_fingerprint, a.source_text_hash, a.reader_state_at_draw
        from verification_audit a where a.id = any(${[...ids]})`;
    },
  };
}

/** Drawing claims into the audit: the catalogue reads and the locked, transactional write. */
export function drawPart(): AuditDraw {
  return {
    async allDrones() {
      return (await db()<{ data: Drone }[]>`select data from drones`).map((r) => r.data);
    },

    async claimPostTexts(ids) {
      return await db()<{ id: string; text: string | null }[]>`
            select id, data->>'text' as text from dispatches where id = any(${[...ids]})`;
    },

    /**
     * Run a draw under one lock, in one transaction: two tabs or a double click must not both see
     * "no seed set yet" and freeze two, or both draw the same claims into separate batches.
     */
    async drawTransaction<T>(draw: (tx: AuditDrawTx) => Promise<T>): Promise<T> {
      return (await db().begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtext(${"verification_audit:draw"}))`;
        return await draw(drawTx(tx as unknown as Sql));
      })) as T;
    },
  };
}
