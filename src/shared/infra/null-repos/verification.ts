import type { VerificationRepo } from "@/shared/contracts/verification-repo";

/** What db() threw with no DATABASE_URL: the writes and reads a job only makes with a database. */
const noDatabase = async (): Promise<never> => {
  throw new Error("DATABASE_URL not set");
};

/**
 * Used when the backend has no SQL database: reproduces the old dbConfigured() early returns. The
 * two reads the status pages made behind `dbConfigured()` answer "nothing"; everything else a job
 * only does with a database throws as db() did.
 */
export const nullVerificationRepo: VerificationRepo = {
  postsForVerification: noDatabase,
  postTexts: noDatabase,
  askedClaimIds: noDatabase,
  recordControl: noDatabase,
  // verifierControlsStatus: no database means an empty record.
  controlVerdicts: async () => [],
  // tokenUsageToday: no database means nothing spent.
  usedToday: async () => ({ input: 0, output: 0 }),
  recordUsage: noDatabase,
};
