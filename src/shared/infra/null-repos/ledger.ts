import type { LedgerRepo } from "@/shared/contracts/ledger-repo";

/** Used when the backend has no SQL database: reproduces the old dbConfigured() early returns. */
export const nullLedgerRepo: LedgerRepo = {};
