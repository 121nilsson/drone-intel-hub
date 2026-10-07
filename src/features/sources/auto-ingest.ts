import type { MonitoredSource } from "@/entities/source/types";
import { MAX_ATTEMPTS, type RawDispatch } from "@/entities/dispatch/types";
import type { FetchedPost } from "@/shared/infra/source-fetch.functions";
import type { DispatchRepository } from "@/shared/contracts/repository";
import { runTwoTier, type PipelineDeps } from "@/features/intake/pipeline";
import type { Drone } from "@/entities/drone/types";

export const DRONE_HINT =
  /drone|uav|ugv|usv|fpv|shahed|geran|lancet|bpla|бла|бпла|дрон|квадрокоптер|ланцет|герань|шахед|мавик|молния|курьер|термит|катран|магура|баба яга|interceptor|loitering|unmanned|jammer|РЭБ|EW\b/i;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a regex from every drone's name, cyrillic spelling, and aliases.
 * This grows automatically as the catalog expands — new systems are caught
 * without any code changes. Returns null when the catalog is empty.
 */
function buildCatalogPattern(drones: Drone[]): RegExp | null {
  const terms = new Set<string>();
  for (const d of drones) {
    if (d.name) terms.add(escapeRegex(d.name));
    if (d.cyrillic) terms.add(escapeRegex(d.cyrillic));
    for (const a of d.aliases) terms.add(escapeRegex(a));
  }
  if (terms.size === 0) return null;
  return new RegExp([...terms].join("|"), "i");
}

export type Fetcher = (
  s: MonitoredSource,
) => Promise<{ ok: true; posts: FetchedPost[] } | { ok: false; error: string }>;

/** Label the server job uses for its stage-2 queue row, which is not a monitored source. */
export const QUEUE_ROW = "Queue";

/**
 * Lease duration is derived from the batch size, not fixed. A lease must outlive the run that
 * took it: if it expires while the batch is still working, another worker can re-claim a
 * document this run is still processing - reintroducing exactly the double-processing the
 * lease exists to prevent. The real constraint is therefore batch duration, which scales with
 * `limit` (roughly two model calls per document, several seconds each).
 *
 * So the budget is per document, and short interactive runs keep a short lease - meaning fast
 * recovery if a worker dies - while a large cron batch gets proportionally longer cover.
 */
const LEASE_PER_ITEM_MS = 15_000;
const MIN_LEASE_MS = 5 * 60_000;
export const MAX_LEASE_MS = 60 * 60_000;

/** Long enough to cover the whole batch. See LEASE_PER_ITEM_MS. */
export const leaseFor = (limit: number) =>
  Math.min(MAX_LEASE_MS, Math.max(MIN_LEASE_MS, limit * LEASE_PER_ITEM_MS));

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

/** Longer than one provider attempt budget (3 × 90s plus backoff), so a slow call is not "stalled". */
export const WORK_STALE_MS = 6 * 60_000;

export type WorkPhase = "fetching" | "analysing" | "done";

/** Heartbeat for the Sources status strip. The auto-sync job persists this; a tab holds it in memory. */
export interface WorkProgress {
  phase: WorkPhase;
  /** Source name, or source name plus a short quoted excerpt while analysing. */
  current: string;
  /** Dispatch id while analysing, so the archive row can be tagged. */
  currentId?: string;
  index: number;
  total: number;
  processed: number;
  irrelevant: number;
  merged: number;
  queued: number;
  failed: number;
  remaining: number;
  updatedAt: string;
}

/** Fired at the start of a post, before it is marked, with the counts from earlier posts in this batch. */
export interface WorkItemEvent {
  id: string;
  sourceName: string;
  excerpt: string;
  index: number;
  total: number;
  processed: number;
  irrelevant: number;
  merged: number;
  queued: number;
  failed: number;
  remaining: number;
}

const EXCERPT_LEN = 80;

function postExcerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= EXCERPT_LEN) return flat;
  return `${flat.slice(0, EXCERPT_LEN - 1)}…`;
}

export function fetchingProgress(name: string, index: number, total: number): WorkProgress {
  return {
    phase: "fetching",
    current: name,
    index,
    total,
    processed: 0,
    irrelevant: 0,
    merged: 0,
    queued: 0,
    failed: 0,
    remaining: 0,
    updatedAt: new Date().toISOString(),
  };
}

export function progressFromItem(event: WorkItemEvent): WorkProgress {
  return {
    phase: "analysing",
    current: event.excerpt ? `${event.sourceName} · "${event.excerpt}"` : event.sourceName,
    currentId: event.id,
    index: event.index,
    total: event.total,
    processed: event.processed,
    irrelevant: event.irrelevant,
    merged: event.merged,
    queued: event.queued,
    failed: event.failed,
    remaining: event.remaining,
    updatedAt: new Date().toISOString(),
  };
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
  opts: {
    leaseMs?: number;
    owner?: string;
    /** Called before each post is marked. A failure here is ignored so progress cannot fail the batch. */
    onItem?: (event: WorkItemEvent) => void | Promise<void>;
  } = {},
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
          queued: rep.queued,
          failed: rep.failed,
          remaining: dispatches.pending(Number.MAX_SAFE_INTEGER).length,
        });
      } catch {
        /* progress must not fail the batch */
      }
      const now = new Date().toISOString();
      const isRelevant = DRONE_HINT.test(d.text) || (catalogPattern?.test(d.text) ?? false);
      if (!isRelevant) {
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
