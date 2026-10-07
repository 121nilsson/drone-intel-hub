import type { MonitoredSource } from "@/entities/source/types";
import { MAX_ATTEMPTS, type RawDispatch } from "@/entities/dispatch/types";
import type { FetchedPost } from "@/shared/infra/source-fetch.functions";
import type { DispatchRepository } from "@/shared/contracts/repository";
import { runTwoTier, type PipelineDeps } from "@/features/intake/pipeline";

export const DRONE_HINT =
  /drone|uav|ugv|usv|fpv|shahed|geran|lancet|bpla|бпла|дрон|квадрокоптер|ланцет|герань|interceptor|loitering|unmanned|jammer|РЭБ|EW\b/i;

export type Fetcher = (
  s: MonitoredSource,
) => Promise<{ ok: true; posts: FetchedPost[] } | { ok: false; error: string }>;

/** Label the server job uses for its stage-2 queue row, which is not a monitored source. */
export const QUEUE_ROW = "Queue";

/**
 * How long a processing lease is held before another worker may reclaim the document.
 * Generous enough to cover a slow two-tier extraction (which can take tens of seconds) plus
 * the transport's retry budget, but short enough that a crashed worker blocks a document for
 * minutes rather than hours. Overlapping claims only matter if a run is abandoned outright,
 * since leases are released in a `finally`.
 */
export const LEASE_MS = 5 * 60_000;

export interface CollectReport {
  source: string;
  fetched: number;
  stored: number;
  error?: string;
}
export interface ProcessReport {
  processed: number;
  irrelevant: number;
  merged: number;
  queued: number;
  failed: number;
  remaining: number;
  /** Documents leased exclusively by this run - 0 when another worker holds them all. */ leased: number;
}
/** Combined report kept for the server job's stored result. */
export interface SyncReport {
  source: string;
  fetched: number;
  relevant: number;
  merged: number;
  queued: number;
  error?: string;
}

export const dispatchId = (sourceId: string, externalId: string) => `${sourceId}|${externalId}`;

/**
 * Stage 1 — network only. Fetch a source and store every new post as a pending dispatch.
 * No AI calls, so it is fast and never blocked by model latency or rate limits.
 */
export async function collectSource(
  s: MonitoredSource,
  fetcher: Fetcher,
  dispatches: DispatchRepository,
): Promise<CollectReport> {
  const res = await fetcher(s);
  if (!res.ok) return { source: s.name, fetched: 0, stored: 0, error: res.error };
  const now = new Date().toISOString();
  let stored = 0;
  for (const p of res.posts) {
    const d: RawDispatch = {
      id: dispatchId(s.id, p.id),
      sourceId: s.id,
      sourceName: s.name,
      externalId: p.id,
      url: p.url,
      text: p.text,
      publishedAt: p.date,
      createdAt: now,
      status: "pending",
    };
    if (dispatches.add(d)) stored++;
  }
  return { source: s.name, fetched: res.posts.length, stored };
}

/**
 * Stage 2 — AI work on stored dispatches, bounded per run. Non-drone posts are reduced to a
 * stub (kept only for dedupe); drone posts keep full text and get provenance links.
 * Each item is marked in the same step that processes it, so a re-run never redoes work.
 */
export async function processPending(
  dispatches: DispatchRepository,
  deps: PipelineDeps,
  limit = 20,
  opts: { leaseMs?: number; owner?: string } = {},
): Promise<ProcessReport> {
  const rep: ProcessReport = {
    processed: 0,
    irrelevant: 0,
    merged: 0,
    queued: 0,
    failed: 0,
    remaining: 0,
    leased: 0,
  };

  // Lease first, then process. Reading `pending()` directly is a read-then-write race: the
  // browser's "Analyse queue" and the cron task both call this, and both would see the same
  // documents and produce duplicate candidates and duplicate merges. Claiming in storage
  // makes the set exclusive. A null result means the store cannot lease, so fall back.
  const leaseMs = opts.leaseMs ?? LEASE_MS;
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

    for (const d of batch) {
      const now = new Date().toISOString();
      if (!DRONE_HINT.test(d.text)) {
        dispatches.update(d.id, { status: "irrelevant", text: "", processedAt: now });
        rep.irrelevant++;
        continue;
      }
      try {
        const r = await runTwoTier(d.text, `${d.sourceName} · ${d.url}`, deps);
        dispatches.update(d.id, {
          status: "processed",
          processedAt: now,
          outcome: r.kind,
          candidateIds: [r.candidate.id],
          droneIds:
            r.kind === "auto-merged"
              ? [r.droneId]
              : r.candidate.extraction.matchId
                ? [r.candidate.extraction.matchId]
                : [],
          error: undefined,
        });
        rep.processed++;
        if (r.kind === "auto-merged") rep.merged++;
        else rep.queued++;
      } catch (e) {
        const attempts = (d.attempts ?? 0) + 1;
        const error = e instanceof Error ? e.message : "Processing failed";
        dispatches.update(d.id, {
          attempts,
          error,
          status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
        });
        rep.failed++;
        // Stop the batch on errors (rate limits, credits, provider down) — next run retries.
        break;
      }
    }
  } finally {
    // Release everything this run took, including the ones it never reached after `break`,
    // so a rate-limited pass does not stall the queue for the rest of the lease window.
    if (claimed?.length) await dispatches.release?.(claimed, owner).catch(() => {});
  }
  rep.remaining = dispatches.pending(Number.MAX_SAFE_INTEGER).length;
  return rep;
}
