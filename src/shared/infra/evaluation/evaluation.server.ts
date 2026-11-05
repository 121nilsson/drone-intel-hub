/**
 * This file is a barrel: the server-side evaluation is split by concern into the
 * evaluation-*.server.ts modules beside it, and importers keep using this path.
 */

export {
  runEvaluation,
  runEvaluationHealth,
  type EvaluationRunResult,
  type EvaluationHealthResult,
} from "./evaluation-reports.server";
export { importGitCorpus } from "./evaluation-corpus.server";
export { harvestCorpus, type HarvestResult } from "./evaluation-harvest.server";
export {
  runAdjudication,
  adjudicationTrust,
  type AdjudicationResult,
} from "./evaluation-adjudication.server";
export {
  getEvalKeyTrends,
  getEvalReports,
  type EvalReportRow,
  type EvalKeyTrend,
} from "./evaluation-trends.server";
export {
  listPendingFixtures,
  decidePendingFixture,
  type PendingFixture,
} from "./evaluation-fixtures.server";
