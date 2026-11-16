import type { BackendKind, StorageBackend } from "@/shared/contracts/backend";
import { createBackend, detectBackendKind } from "@/shared/infra/storage/backend.server";
import type { LedgerRepo } from "@/shared/contracts/ledger-repo";
import { createPostgresLedgerRepo } from "@/shared/infra/postgres/ledger-repo.server";
import { nullLedgerRepo } from "@/shared/infra/null-repos/ledger";
import type { TaskRunRepo } from "@/shared/contracts/task-run-repo";
import { createPostgresTaskRunRepo } from "@/shared/infra/postgres/task-run-repo.server";
import { nullTaskRunRepo } from "@/shared/infra/null-repos/taskRuns";
import type { SyncStateRepo } from "@/shared/contracts/sync-state-repo";
import { createPostgresSyncStateRepo } from "@/shared/infra/postgres/sync-state-repo.server";
import { nullSyncStateRepo } from "@/shared/infra/null-repos/syncState";
import type { SourceLogRepo } from "@/shared/contracts/source-log-repo";
import { createPostgresSourceLogRepo } from "@/shared/infra/postgres/source-log-repo.server";
import { nullSourceLogRepo } from "@/shared/infra/null-repos/sourceLog";
import type { SourceSyncRepo } from "@/shared/contracts/source-sync-repo";
import { createPostgresSourceSyncRepo } from "@/shared/infra/postgres/source-sync-repo.server";
import { nullSourceSyncRepo } from "@/shared/infra/null-repos/sourceSync";
import type { BriefingRepo } from "@/shared/contracts/briefing-repo";
import { createPostgresBriefingRepo } from "@/shared/infra/postgres/briefing-repo.server";
import { nullBriefingRepo } from "@/shared/infra/null-repos/briefing";
import type { RulesRepo } from "@/shared/contracts/rules-repo";
import { createPostgresRulesRepo } from "@/shared/infra/postgres/rules-repo.server";
import { nullRulesRepo } from "@/shared/infra/null-repos/rules";
import type { EvaluationRepo } from "@/shared/contracts/evaluation-repo";
import { createPostgresEvaluationRepo } from "@/shared/infra/postgres/evaluation-repo.server";
import { nullEvaluationRepo } from "@/shared/infra/null-repos/evaluation";
import type { VerificationRepo } from "@/shared/contracts/verification-repo";
import { createPostgresVerificationRepo } from "@/shared/infra/postgres/verification-repo.server";
import { nullVerificationRepo } from "@/shared/infra/null-repos/verification";
import type { SeedAuditReader } from "@/shared/contracts/evaluation-repo";
import { createPostgresSeedAuditReader } from "@/shared/infra/postgres/evaluation-repo-reports.server";
import { nullSeedAuditReader } from "@/shared/infra/null-repos/seedAudit";
import type { AuditRepo } from "@/shared/contracts/audit-repo";
import { createPostgresAuditRepo } from "@/shared/infra/postgres/audit-repo.server";
import { nullAuditRepo } from "@/shared/infra/null-repos/audit";

/**
 * The server-side composition root, the counterpart of services.tsx for code that runs only on the
 * server (server functions, scheduled tasks). It is the one place that decides which adapter
 * implements each port: a SQL adapter when the backend has a database, a null adapter otherwise.
 * Domain modules call `serverServices()` and never import the database driver themselves.
 */
export interface ServerServices {
  backend: StorageBackend;
  ledger: LedgerRepo;
  taskRuns: TaskRunRepo;
  syncState: SyncStateRepo;
  sourceLog: SourceLogRepo;
  sourceSync: SourceSyncRepo;
  briefing: BriefingRepo;
  rules: RulesRepo;
  evaluation: EvaluationRepo;
  verification: VerificationRepo;
  audit: AuditRepo;
  /** The frozen seed set; only the seed measurement reads it. */
  seedAudit: SeedAuditReader;
}

function build(kind: BackendKind): ServerServices {
  const backend = createBackend(kind);
  return backend.capabilities.sql
    ? {
        backend,
        ledger: createPostgresLedgerRepo(),
        taskRuns: createPostgresTaskRunRepo(),
        syncState: createPostgresSyncStateRepo(),
        sourceLog: createPostgresSourceLogRepo(),
        sourceSync: createPostgresSourceSyncRepo(),
        briefing: createPostgresBriefingRepo(),
        rules: createPostgresRulesRepo(),
        evaluation: createPostgresEvaluationRepo(),
        verification: createPostgresVerificationRepo(),
        audit: createPostgresAuditRepo(),
        seedAudit: createPostgresSeedAuditReader(),
      }
    : {
        backend,
        ledger: nullLedgerRepo,
        taskRuns: nullTaskRunRepo,
        syncState: nullSyncStateRepo,
        sourceLog: nullSourceLogRepo,
        sourceSync: nullSourceSyncRepo,
        briefing: nullBriefingRepo,
        rules: nullRulesRepo,
        evaluation: nullEvaluationRepo,
        verification: nullVerificationRepo,
        audit: nullAuditRepo,
        seedAudit: nullSeedAuditReader,
      };
}

const built = new Map<BackendKind, ServerServices>();
let override: Partial<ServerServices> | null = null;

/**
 * The services for the backend the environment selects now. Resolved per call (a cheap env read,
 * then a cached instance per kind) so a test or a job that sets DATABASE_URL after import still
 * gets the right adapters.
 */
export function serverServices(): ServerServices {
  const kind = detectBackendKind();
  let services = built.get(kind);
  if (!services) {
    services = build(kind);
    built.set(kind, services);
  }
  return override ? { ...services, ...override } : services;
}

/** Test seam: replace some ports with fakes; pass null to restore the real adapters. */
export function setServerServices(partial: Partial<ServerServices> | null): void {
  override = partial;
}
