import type { RawDispatch } from "@/entities/dispatch/types";
import type { DispatchRepository } from "@/shared/contracts/repository";
import { PIPELINE_VERSION } from "@/shared/infra/ingest/pipeline-version";

/** Posts per auto-sync run handed back for re-analysis, once the live queue is empty. */
export const REANALYSIS_BATCH = 25;

/** A post analysed by an older pipeline, or one that failed for good, still holding its text. */
export function isStale(d: RawDispatch): boolean {
  return (
    (d.status === "processed" || d.status === "failed") &&
    !!d.text.trim() &&
    d.pipelineVersion !== PIPELINE_VERSION
  );
}

/**
 * Hand up to `limit` stale posts back to the queue, newest first: recent reporting matters most
 * to the briefing. They are processed by the same leased, outage-aware processPending as new posts,
 * which replaces their earlier contribution (see retractContribution) once the new run succeeds.
 */
export function requeueStale(dispatches: DispatchRepository, limit: number): number {
  const stale = dispatches
    .list()
    .filter(isStale)
    .sort((a, b) => (b.publishedAt ?? b.createdAt).localeCompare(a.publishedAt ?? a.createdAt))
    .slice(0, limit);
  for (const d of stale)
    dispatches.update(d.id, { status: "pending", attempts: 0, error: undefined, reanalyze: true });
  return stale.length;
}

/**
 * Hand a failed post back to the queue: reset its attempt budget and error so a transient
 * failure (a timeout, a provider that has since recovered) can be retried without a pipeline
 * version bump. Only posts that still carry their text, since a stub has nothing to analyse.
 */
export function requeueFailed(dispatches: DispatchRepository, ids?: string[]): number {
  const set = ids && ids.length ? new Set(ids) : null;
  const failed = dispatches
    .list()
    .filter((d) => d.status === "failed" && !!d.text.trim() && (!set || set.has(d.id)))
    .sort((a, b) => (b.publishedAt ?? b.createdAt).localeCompare(a.publishedAt ?? a.createdAt));
  for (const d of failed)
    dispatches.update(d.id, { status: "pending", attempts: 0, error: undefined });
  return failed.length;
}
