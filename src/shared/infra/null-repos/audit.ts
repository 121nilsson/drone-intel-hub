import type { AuditRepo } from "@/shared/contracts/audit-repo";

/** What db() threw with no DATABASE_URL: a draw, an answer or a backfill has nothing to run on. */
const noDatabase = async (): Promise<never> => {
  throw new Error("DATABASE_URL not set");
};

/**
 * Used when the backend has no SQL database: reproduces the old dbConfigured() early returns. The
 * two reads the audit page made behind `dbConfigured()` answer "nothing" (no status rows, no
 * answered rows); every operation that writes, draws or backfills throws as db() did.
 */
export const nullAuditRepo: AuditRepo = {
  allDrones: noDatabase,
  claimPostTexts: noDatabase,
  drawTransaction: noDatabase,
  recordAnswer: noDatabase,
  recordDispute: noDatabase,
  recordSecondLook: noDatabase,
  // auditStatus: null means "no audit storage", and the status is then the empty one.
  statusRows: async () => null,
  // auditDisagreements: nothing answered, so nothing contradicted.
  answeredRows: async () => [],
  auditedClaimIds: noDatabase,
  latestFormalDesign: noDatabase,
  formalDesignRows: noDatabase,
  readerRecords: noDatabase,
  postTextOf: noDatabase,
  countUndrawn: noDatabase,
  unitSiblings: noDatabase,
  auditedClaimIdsExceptControls: noDatabase,
  fingerprintedItems: noDatabase,
  appendReaderRows: noDatabase,
  legacyItemsWithoutHistory: noDatabase,
  currentReadings: noDatabase,
  markReaderStateLegacy: noDatabase,
};
