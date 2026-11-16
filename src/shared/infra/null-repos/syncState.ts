import type { SyncStateRepo } from "@/shared/contracts/sync-state-repo";

/** Used when the backend has no SQL database: reproduces the old dbConfigured() early returns. */
export const nullSyncStateRepo: SyncStateRepo = {
  async readSlots() {
    return null;
  },
};
