import type { BriefingRepo } from "@/shared/contracts/briefing-repo";

/** Used when the backend has no SQL database: reproduces the old dbConfigured() early returns. */
export const nullBriefingRepo: BriefingRepo = {};
