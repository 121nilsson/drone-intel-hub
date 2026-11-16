import type { SourceLogRepo } from "@/shared/contracts/source-log-repo";

/** Used when the backend has no SQL database: reproduces the old dbConfigured() early returns. */
export const nullSourceLogRepo: SourceLogRepo = {
  async append() {},
  async prune() {},
  async totals() {
    return [];
  },
  async history() {
    return [];
  },
};
