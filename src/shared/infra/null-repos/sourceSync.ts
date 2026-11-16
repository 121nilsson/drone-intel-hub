import type { SourceSyncRepo } from "@/shared/contracts/source-sync-repo";

/** Used when the backend has no SQL database: reproduces the old dbConfigured() early returns. */
export const nullSourceSyncRepo: SourceSyncRepo = {};
