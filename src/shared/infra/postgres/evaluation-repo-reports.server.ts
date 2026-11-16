import type {
  EvaluationReportStore,
  SeedAuditReader,
  SeedAuditRow,
} from "@/shared/contracts/evaluation-repo";
import { db } from "@/shared/infra/postgres/db.server";
import { sanitizeJson } from "@/shared/infra/json-sanitize";
import type { JSONValue } from "postgres";

export function createPostgresEvaluationReportStore(): EvaluationReportStore {
  return {
    async insertReport({ id, generatedAt, seed, sampleSize, corpusVersion, report }) {
      await db()`
      insert into eval_reports (id, generated_at, seed, sample_size, corpus_version, report)
      values (${id}, ${generatedAt}, ${seed}, ${sampleSize}, ${corpusVersion}, ${db().json(sanitizeJson(report as unknown as JSONValue))})`;
    },

    async latestReport() {
      const rows = await db()`select report from eval_reports order by generated_at desc limit 1`;
      return rows.length && rows[0] ? (rows[0]["report"] as Record<string, unknown>) : null;
    },

    async newestReportsAscending(limit) {
      // The newest `limit` reports, oldest first for the sparkline. Ordering ascending before the
      // limit took the oldest ones, so the trend froze once there were more than `limit` reports.
      const rows = await db()`
    select generated_at, report from (
      select generated_at, report from eval_reports order by generated_at desc limit ${limit}
    ) newest order by generated_at asc`;
      return rows.map((r) => ({
        generatedAt: r["generated_at"] as Date,
        report: r["report"] as Record<string, unknown>,
      }));
    },

    async recentReports(limit) {
      const rows =
        await db()`select id, generated_at, report from eval_reports order by generated_at desc limit ${limit}`;
      return rows.map((r) => ({
        id: r["id"] as string,
        generatedAt: r["generated_at"] as Date,
        report: r["report"] as Record<string, unknown>,
      }));
    },
  };
}

/**
 * READ-ONLY on `verification_audit`. The frozen seed set is read by the Evaluation page's
 * measurement only; no learning loop gets this role (docs/architecture.md).
 */
export function createPostgresSeedAuditReader(): SeedAuditReader {
  return {
    async seedAuditRows() {
      return (await db()`
      select id, batch_id, position, role, in_seed, spec_key, spec_label, value, post_text,
             answer, obviously_wrong, control_kind, control_disputed_at
      from verification_audit
      order by drawn_at asc, position asc`) as unknown as SeedAuditRow[];
    },
  };
}
