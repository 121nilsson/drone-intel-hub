import type { SourceSyncRepo } from "@/shared/contracts/source-sync-repo";

/**
 * Used when the backend has no SQL database: reproduces the old dbConfigured() early returns. The
 * sync itself refuses to start without SQL (runAutoSync), so these are inert: no slot is ever
 * claimed, nothing is stored and no cooldown is known.
 */
export const nullSourceSyncRepo: SourceSyncRepo = {
  async claimSlot() {
    return false;
  },
  async releaseSlot() {},
  async storeResult() {},
  async readCooldown() {
    return undefined;
  },
  async writeCooldown() {},
  async clearCooldown() {},
  async writeProgress() {},
};
