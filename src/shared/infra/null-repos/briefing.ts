import type { BriefingRepo } from "@/shared/contracts/briefing-repo";

/**
 * Used when the backend has no SQL database: reproduces the old dbConfigured() early returns. The
 * callers that must not go on without a database (generating a summary) check the backend's SQL
 * capability themselves.
 */
export const nullBriefingRepo: BriefingRepo = {
  async readSummary() {
    return undefined;
  },
  async writeSummary() {},
};
