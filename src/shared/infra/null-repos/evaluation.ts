import type { EvaluationRepo } from "@/shared/contracts/evaluation-repo";

/**
 * Used when the backend has no SQL database: reproduces the old dbConfigured() early returns.
 * Operations that guarded on dbConfigured() answer with the empty result they returned then; those
 * that never guarded called db() and threw "DATABASE_URL not set", which they still do. The
 * orchestrating jobs (run, health, harvest, adjudication, git import) stop before reaching here
 * on `backend.capabilities.sql`, with the reason strings they always had.
 */
const noDatabase = () => {
  throw new Error("DATABASE_URL not set");
};

export const nullEvaluationRepo: EvaluationRepo = {
  tryClaim: async () => noDatabase(),
  release: async () => noDatabase(),
  pinnedVersion: async () => noDatabase(),
  recordVersion: async () => noDatabase(),
  gitFixtureExists: async () => noDatabase(),
  insertGitFixture: async () => noDatabase(),
  fixtureIdExists: async () => noDatabase(),
  insertHarvestedFixture: async () => noDatabase(),
  adjudicatedIds: async () => noDatabase(),
  insertAdjudicatedPositive: async () => noDatabase(),
  insertAdjudicatedNegative: async () => noDatabase(),
  analystTally: async () => [],
  revokeAutonomousApprovals: async () => noDatabase(),
  countPending: async () => 0,
  listPending: async () => [],
  countAutoApproved: async () => 0,
  listAutoApproved: async () => [],
  decide: async () => false,
  insertReport: async () => noDatabase(),
  latestReport: async () => noDatabase(),
  newestReportsAscending: async () => [],
  recentReports: async () => [],
  seedAuditRows: async () => null,
};
