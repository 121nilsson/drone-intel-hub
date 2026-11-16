import type { VerificationRepo } from "@/shared/contracts/verification-repo";

/** Used when the backend has no SQL database: reproduces the old dbConfigured() early returns. */
export const nullVerificationRepo: VerificationRepo = {};
