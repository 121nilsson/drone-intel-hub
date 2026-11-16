import type { AuditRepo } from "@/shared/contracts/audit-repo";
import { answerPart } from "./audit-repo-answer.server";
import { drawPart } from "./audit-repo-draw.server";
import { legacyBackfillPart, readerHistoryPart } from "./audit-repo-readers.server";
import { reportPart } from "./audit-repo-report.server";

/**
 * PostgreSQL adapter for AuditRepo, composed of one part per concern (draw, answer, report, reader
 * history, legacy backfill). Each part holds the SQL of that concern and nothing else.
 */
export function createPostgresAuditRepo(): AuditRepo {
  return {
    ...drawPart(),
    ...answerPart(),
    ...reportPart(),
    ...readerHistoryPart(),
    ...legacyBackfillPart(),
  };
}
