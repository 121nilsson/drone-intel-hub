/**
 * Barrel for the two-stage ingest pipeline. The implementation lives in the sibling modules
 * below, split by concern; importers keep this path, so the split changes no call site.
 *
 * Stage 1 (collect.ts) stores raw posts as pending dispatches with no AI. Stage 2
 * (process-pending.ts) drains the queue under a lease, and retraction.ts / requeue.ts handle
 * re-analysis. Outage handling and cooldowns are in provider-outage.ts.
 */
export { DRONE_HINT } from "@/shared/infra/ingest/ingest-relevance";
export { leaseFor, MAX_LEASE_MS } from "@/shared/infra/ingest/ingest-lease";
export {
  formatProviderError,
  nextCooldown,
  COOLDOWN_MAX_MS,
  PROVIDER_OUTAGE_KINDS,
  providerErrorKind,
} from "@/shared/infra/ingest/provider-outage";
export type { Cooldown } from "@/shared/infra/ingest/provider-outage";
export {
  QUEUE_ROW,
  WORK_STALE_MS,
  fetchingProgress,
  progressFromItem,
} from "@/shared/infra/ingest/ingest-progress";
export type { WorkItemEvent, WorkPhase, WorkProgress } from "@/shared/infra/ingest/ingest-progress";
export type {
  CollectReport,
  ProcessReport,
  SyncReport,
} from "@/shared/infra/ingest/ingest-reports";
export { stampEvents } from "@/shared/infra/ingest/event-stamp";
export { collectSource, dispatchId } from "@/shared/infra/ingest/collect";
export type { Fetcher } from "@/shared/infra/ingest/collect";
export { processPending } from "@/shared/infra/ingest/process-pending";
export { PIPELINE_VERSION } from "@/shared/infra/ingest/pipeline-version";
export {
  REANALYSIS_BATCH,
  isStale,
  requeueFailed,
  requeueStale,
} from "@/shared/infra/ingest/requeue";
