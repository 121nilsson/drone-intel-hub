import type { RulesRepo } from "@/shared/contracts/rules-repo";

/** Used when the backend has no SQL database: reproduces the old dbConfigured() early returns. */
export const nullRulesRepo: RulesRepo = {};
