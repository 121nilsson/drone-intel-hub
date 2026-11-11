import { MAX_ATTEMPTS, type RawDispatch } from "@/entities/dispatch/types";
import type { DispatchRepository } from "@/shared/contracts/repository";
import { runTwoTier, type PipelineDeps } from "@/shared/infra/ingest/pipeline";
import { ProviderOutageError } from "@/shared/contracts/ai";
import { traceFailure, traceItem } from "@/shared/infra/pipeline-trace";
import { DRONE_HINT, buildCatalogPattern } from "@/shared/infra/ingest/ingest-relevance";
import { stampEvents } from "@/shared/infra/ingest/event-stamp";
import { retractContribution, supersedeCandidates } from "@/shared/infra/ingest/retraction";
import { describeIrrelevant, describeItem } from "@/shared/infra/ingest/trace-lines";
import { postExcerpt, type WorkItemEvent } from "@/shared/infra/ingest/ingest-progress";
import { leaseFor } from "@/shared/infra/ingest/ingest-lease";
import type { ProcessReport } from "@/shared/infra/ingest/ingest-reports";
import {
  formatProviderError,
  PROVIDER_OUTAGE_KINDS,
  providerErrorKind,
} from "@/shared/infra/ingest/provider-outage";
import { PIPELINE_VERSION } from "@/shared/infra/ingest/pipeline-version";

/**
 * Stage 2 — AI work on stored dispatches, bounded per run. Non-drone posts are reduced to a
 * stub (kept only for dedupe); drone posts keep full text and get provenance links.
 * Each item is marked in the same step that processes it, so a re-run never redoes work.
 */
export async function processPending(
  dispatches: DispatchRepository,
  deps: PipelineDeps,
  limit = 20,
  opts: {
    leaseMs?: number;
    owner?: string;
    /** Epoch ms after which no new post is started; the rest stay pending for the next run. */
    deadline?: number;
    /** Called before each post is marked. A failure here is ignored so progress cannot fail the batch. */
    onItem?: (event: WorkItemEvent) => void | Promise<void>;
  } = {},
): Promise<ProcessReport> {
  const rep: ProcessReport = {
    processed: 0,
    irrelevant: 0,
    merged: 0,
    promoted: 0,
    discarded: 0,
    queued: 0,
    failed: 0,
    remaining: 0,
    leased: 0,
    heuristicOnly: 0,
    tier1Calls: 0,
    tier2Calls: 0,
    parseFailures: 0,
  };

  // Lease first, then process. Reading `pending()` directly is a read-then-write race: the
  // browser's "Analyse queue" and the cron task both call this, and both would see the same
  // documents and produce duplicate candidates and duplicate merges. Claiming in storage
  // makes the set exclusive. A null result means the store cannot lease, so fall back.
  const leaseMs = opts.leaseMs ?? leaseFor(limit);
  const owner = opts.owner ?? crypto.randomUUID();
  let claimed: string[] | null = null;
  if (dispatches.claim) claimed = await dispatches.claim(limit, leaseMs, owner);
  // Leases are released in `finally` so a thrown pipeline error cannot leave documents pinned
  // until the lease expires. A crashed worker is covered by the expiry instead.
  try {
    const batch =
      claimed === null
        ? dispatches.pending(limit)
        : claimed
            .map((id) => dispatches.list().find((d) => d.id === id))
            .filter((d): d is NonNullable<typeof d> => !!d);
    rep.leased = claimed?.length ?? 0;

    // Build the dynamic catalog pattern once per batch — regex construction is
    // relatively expensive, so we don't want to do it per-post.
    const catalogPattern = buildCatalogPattern(deps.drones.list());

    for (let i = 0; i < batch.length; i++) {
      const d = batch[i]!;
      if (opts.deadline !== undefined && Date.now() >= opts.deadline) break;
      try {
        await opts.onItem?.({
          id: d.id,
          sourceName: d.sourceName,
          excerpt: postExcerpt(d.text),
          index: i + 1,
          total: batch.length,
          processed: rep.processed,
          irrelevant: rep.irrelevant,
          merged: rep.merged,
          promoted: rep.promoted,
          discarded: rep.discarded,
          queued: rep.queued,
          failed: rep.failed,
          remaining: dispatches.pending(Number.MAX_SAFE_INTEGER).length,
        });
      } catch {
        /* progress must not fail the batch */
      }
      const now = new Date().toISOString();
      // A re-analysis replaces this post's earlier contribution rather than adding to it. Kept
      // restorable until the new run succeeds, so a failed re-run loses nothing.
      const retracted = d.reanalyze ? retractContribution(d, deps) : undefined;
      const isRelevant = DRONE_HINT.test(d.text) || (catalogPattern?.test(d.text) ?? false);
      if (!isRelevant) {
        dispatches.update(d.id, {
          status: "irrelevant",
          text: "",
          processedAt: now,
          pipelineVersion: PIPELINE_VERSION,
          reanalyze: false,
        });
        rep.irrelevant++;
        traceItem(
          describeIrrelevant(
            d,
            i + 1,
            batch.length,
            dispatches.pending(Number.MAX_SAFE_INTEGER).length,
          ),
        );
        continue;
      }
      try {
        const r = await runTwoTier(d.text, `${d.sourceName} · ${d.url}`, deps, {
          dispatchId: d.id,
          url: d.url,
          ...(d.publishedAt ? { publishedAt: d.publishedAt } : {}),
          ...(d.contentHash ? { contentHash: d.contentHash } : {}),
        });
        if (d.reanalyze)
          supersedeCandidates(
            d,
            [r.candidate.id, ...(r.relatedCandidates ?? []).map((c) => c.id)],
            deps,
          );
        retracted?.restoreReviews();
        dispatches.update(d.id, {
          status: "processed",
          processedAt: now,
          pipelineVersion: PIPELINE_VERSION,
          reanalyze: false,
          outcome: r.kind,
          candidateIds: [r.candidate.id, ...(r.relatedCandidates ?? []).map((c) => c.id)],
          droneIds: r.droneIds?.length
            ? r.droneIds
            : r.kind === "auto-merged" || r.kind === "auto-promoted"
              ? [r.droneId]
              : r.candidate.extraction.matchId
                ? [r.candidate.extraction.matchId]
                : [],
          error: undefined,
          analysisFingerprint: [
            d.contentHash ?? d.id,
            r.candidate.extraction.metadata?.schemaVersion ?? 1,
            r.candidate.extraction.metadata?.promptVersion ?? "legacy",
            r.candidate.extraction.metadata?.model ?? "local",
          ].join(":"),
          ...(r.candidate.extraction.metadata
            ? {
                analysis: {
                  ...r.candidate.extraction.metadata,
                  ...(r.trace?.droppedForEvidence
                    ? { droppedForEvidence: r.trace.droppedForEvidence }
                    : {}),
                  ...(r.trace?.requoted ? { requoted: r.trace.requoted } : {}),
                },
              }
            : {}),
        });
        rep.processed++;
        if (r.candidate.extraction.metadata?.engine === "heuristic") rep.heuristicOnly!++;
        else rep.tier1Calls!++;
        if (r.candidate.tier === 2) rep.tier2Calls!++;
        traceItem(
          describeItem(
            d,
            r,
            i + 1,
            batch.length,
            rep,
            deps,
            dispatches.pending(Number.MAX_SAFE_INTEGER).length,
          ),
        );
        if (r.kind === "auto-merged") rep.merged++;
        else if (r.kind === "auto-promoted") rep.promoted++;
        else if (r.kind === "auto-discarded") rep.discarded++;
        else rep.queued++;
      } catch (e) {
        retracted?.restore();
        const error = e instanceof Error ? e.message : "Processing failed";
        // A failure is the case where the log matters most, so it is traced even at level 0 and
        // names the post, so the line is actionable on its own.
        traceFailure([
          `${i + 1}/${batch.length}`,
          d.sourceName,
          "engine=failed",
          `FAILED: ${error}`,
        ]);
        if (e instanceof ProviderOutageError) {
          // Every provider is refusing or cooling down: the post is not at fault, so it keeps its
          // attempt budget and stays pending, and the batch stops. The reason is phrased so the
          // cooldown in source-sync recognises it as an outage even when the last provider's
          // error alone (say, a timeout) would not read as one.
          const formatted = formatProviderError(error);
          const kind = providerErrorKind(formatted);
          dispatches.update(d.id, { error });
          rep.failed++;
          rep.stopReason =
            kind && PROVIDER_OUTAGE_KINDS.has(kind) ? formatted : "Provider unavailable";
          break;
        }
        const attempts = (d.attempts ?? 0) + 1;
        if (/invalid extraction json|json/i.test(error)) rep.parseFailures!++;
        dispatches.update(d.id, {
          attempts,
          error,
          status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
        });
        rep.failed++;
        // Stop the batch only on provider-level outages (rate limit, credits, auth, provider
        // down): those will fail every remaining document too, so retrying after a cooldown is
        // cheaper than burning the window one rejection at a time. A document-specific failure
        // only skips that one post — one bad document must not starve the rest of the queue.
        // stopReason is set only when the batch actually stops; it is what the cooldown logic
        // in source-sync keys off, so a skipped document must not read as a stopped run.
        const kind = providerErrorKind(error);
        if (kind && PROVIDER_OUTAGE_KINDS.has(kind)) {
          rep.stopReason = formatProviderError(error);
          break;
        }
      }
    }
    // The batch is analysed: correlate what the archive now holds into events, so the feed can
    // show one story carried by many outlets. Additive - no analysis reads it yet.
    stampEvents(dispatches);
  } finally {
    // Release everything this run took, including the ones it never reached after `break`,
    // so a rate-limited pass does not stall the queue for the rest of the lease window.
    if (claimed?.length) await dispatches.release?.(claimed, owner).catch(() => {});
  }
  rep.remaining = dispatches.pending(Number.MAX_SAFE_INTEGER).length;
  return rep;
}
