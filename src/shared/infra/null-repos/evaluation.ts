import type { EvaluationRepo } from "@/shared/contracts/evaluation-repo";

/** Used when the backend has no SQL database: reproduces the old dbConfigured() early returns. */
export const nullEvaluationRepo: EvaluationRepo = {};
