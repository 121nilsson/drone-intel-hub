import type { EvaluationRepo } from "@/shared/contracts/evaluation-repo";
import { createPostgresEvaluationLock } from "@/shared/infra/postgres/evaluation-repo-lock.server";
import {
  createPostgresAdjudicationStore,
  createPostgresCorpusVersions,
  createPostgresGitCorpusStore,
  createPostgresHarvestStore,
} from "@/shared/infra/postgres/evaluation-repo-corpus.server";
import { createPostgresPendingFixtureStore } from "@/shared/infra/postgres/evaluation-repo-fixtures.server";
import {
  createPostgresEvaluationReportStore,
  createPostgresSeedAuditReader,
} from "@/shared/infra/postgres/evaluation-repo-reports.server";

/** PostgreSQL adapter for EvaluationRepo: composes the role adapters beside it. */
export function createPostgresEvaluationRepo(): EvaluationRepo {
  return {
    ...createPostgresEvaluationLock(),
    ...createPostgresCorpusVersions(),
    ...createPostgresGitCorpusStore(),
    ...createPostgresHarvestStore(),
    ...createPostgresAdjudicationStore(),
    ...createPostgresPendingFixtureStore(),
    ...createPostgresEvaluationReportStore(),
    ...createPostgresSeedAuditReader(),
  };
}
