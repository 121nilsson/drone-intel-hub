import type { AuditRepo } from "@/shared/contracts/audit-repo";

/** Used when the backend has no SQL database: reproduces the old dbConfigured() early returns. */
export const nullAuditRepo: AuditRepo = {};
