import type { MonitoredSource } from "@/entities/source/types";
import { MAX_ATTEMPTS, type RawDispatch } from "@/entities/dispatch/types";
import { MIN_CHARS_FOR_DEDUPE, simHash64 } from "@/entities/dispatch/simhash";
import { clusterEvents } from "@/entities/dispatch/events";
import type { FetchedPost } from "@/shared/infra/sources/source-fetch.functions";
import type { DispatchRepository } from "@/shared/contracts/repository";
import { runTwoTier, type PipelineDeps, type PipelineResult } from "@/shared/infra/ingest/pipeline";
import type { Drone } from "@/entities/drone/types";
import { heldReviews, restoreReviews, type HeldReview } from "@/entities/drone/claim-review";
import { ProviderOutageError } from "@/shared/contracts/ai";
import { EXTRACTION_PROMPT_VERSION } from "@/shared/contracts/extraction.schema";
import { traceFailure, traceItem, traceLevel } from "@/shared/infra/pipeline-trace";

export const DRONE_HINT =
  /drone|uav|ugv|usv|fpv|shahed|geran|lancet|bpla|бла|бпла|дрон|квадрокоптер|ланцет|герань|шахед|мавик|молния|курьер|термит|катран|магура|баба яга|interceptor|loitering|unmanned|jammer|РЭБ|EW\b|c-?uas|counter-?drone|anti-?drone|антидрон|протидрон|перехват|shorad|зрк|зрпк|pantsir|панцир|tunguska|тунгуск|gepard|гепард|volnorez|волнорез|skywiper|edm4s|stupor|ступор|harpoon-?3|гарпун|tsukorok|цукорок|bulat|булат|(?<![\p{L}])(?:tor-?m\d?|тор-?м\d?|osa-?akm|оса-?акм)(?![\p{L}])/iu;

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
  /** Posts suppressed as near-duplicates of something already stored. */
  duplicates: number;
  /** Wall-clock for this source, so a slow host is visible in the activity log. */
  durationMs: number;
  error?: string;
}
export interface ProcessReport {
  processed: number;
  irrelevant: number;
  merged: number;
  /** New systems auto-promoted into the catalog. */
  promoted: number;
  /** Low-confidence candidates auto-discarded. */
  discarded: number;
  queued: number;
  failed: number;
  remaining: number;
  /** Documents leased exclusively by this run - 0 when another worker holds them all. */ leased: number;
  /** Why this batch stopped, when a provider or pipeline error aborted the rest. */
  stopReason?: string;
  heuristicOnly?: number;
  tier1Calls?: number;
  tier2Calls?: number;
  parseFailures?: number;
}

const PROVIDER_KINDS: [RegExp, string][] = [
  [/timeout/i, "timeout"],
  [/429|rate[\s-]?limit/i, "rate limit"],
  [/401|403|\bauth\b|api key|unauthorized/i, "auth"],
  [/402|\bcredits?\b|quota|insufficient/i, "credits"],
  [/\b(425|500|502|503|504)\b|unavailable/i, "unavailable"],
  [/\b400\b|bad request/i, "bad request"],
  [/\b404\b|not found/i, "not found"],
  [/typeerror|\bnetwork\b|fetch failed|econn/i, "network"],
  [/invalid provider response|unexpected token|syntaxerror/i, "invalid response"],
];

/** A stable label for a provider failure, including older messages already stored on a dispatch. */
export function providerErrorKind(message: string): string | null {
  for (const [pattern, kind] of PROVIDER_KINDS) {
    if (pattern.test(message)) return kind;
  }
  return null;
}

/**
 * Provider-level failure kinds that will also fail every remaining document in the batch:
 * the run stops and the cooldown backoff takes over. Any other failure (a parse bug, an
 * unexpected extraction shape, a timeout on one oversized post) says nothing about the next
 * document, so the batch continues and only that document is retried.
 */
export const PROVIDER_OUTAGE_KINDS = new Set(["rate limit", "credits", "auth", "unavailable"]);

/** Short line for the status strip, activity log, and dispatch row. Status codes are kept. */
export function formatProviderError(message: string): string {
  const kind = providerErrorKind(message);
  if (!kind) return message.replace(/\s+/g, " ").trim().slice(0, 120);
  const status = message.match(/\b(400|401|402|403|404|408|425|429|500|502|503|504)\b/);
  return status ? `Provider ${kind} (${status[1]})` : `Provider ${kind}`;
}

const COOLDOWN_BASE_MS = 5 * 60_000;
export const COOLDOWN_MAX_MS = 60 * 60_000;

/** Backoff after a run stopped on a provider-level outage (rate limit, credits, auth, provider down). */
export interface Cooldown {
  /** Consecutive stopped runs, so each repeat waits twice as long. */
  level: number;
  until: string;
}

/** The cooldown to store after another rate-limited run: 5 min, doubling, capped at an hour. */
export function nextCooldown(previous: Cooldown | null, now = Date.now()): Cooldown {
  const level = previous?.level ?? 0;
  const ms = Math.min(COOLDOWN_MAX_MS, COOLDOWN_BASE_MS * 2 ** level);
  return { level: level + 1, until: new Date(now + ms).toISOString() };
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
  /** Optional: heartbeats written before auto-triage existed lack them. */
  promoted?: number;
  discarded?: number;
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
  promoted: number;
  discarded: number;
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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The per-item log line: what ran, what was found, what was written.
 *
 * Ordered so the two things you scan for are in a fixed place — position and source at the front,
 * outcome and remaining backlog at the end — with the diagnostics in between. Optional parts drop
 * out rather than printing a placeholder, so a line never contains "undefined" and a missing
 * stage reads as absent rather than as a value.
 */
function describeItem(
  d: RawDispatch,
  r: PipelineResult,
  index: number,
  total: number,
  rep: ProcessReport,
  deps: PipelineDeps,
  remaining: number,
): (string | number | undefined)[] {
  const e = r.candidate.extraction;
  const t = r.trace;
  // The catalog name, not the extracted one: on a merge these can differ, and the line is
  // about what the catalog now holds.
  const target =
    r.kind === "auto-merged" || r.kind === "auto-promoted" ? deps.drones.get(r.droneId) : undefined;
  const name = target?.name ?? e.name ?? "unidentified";

  const engines = t?.engines.length ? t.engines.join("+") : (e.metadata?.engine ?? "unknown");
  const found = [
    plural(t?.systems ?? 1, "system"),
    plural(t?.specs ?? e.specs.length, "spec"),
  ].join(", ");

  let added: string;
  if (r.kind === "auto-merged") {
    const addedSpecs = t?.specsMerged;
    added = `merged into ${JSON.stringify(name)}${addedSpecs ? ` (+${addedSpecs} specs)` : ""}`;
  } else if (r.kind === "auto-promoted") {
    added = `promoted new catalog entry ${JSON.stringify(name)}`;
  } else if (r.kind === "auto-discarded") {
    added = `discarded (conf below threshold)`;
  } else {
    added = "queued for review";
  }

  return [
    `${index}/${total}`,
    d.sourceName,
    `engine=${engines}`,
    e.metadata?.model ? `model=${e.metadata.model}` : undefined,
    `conf=${Math.round(e.confidence * 100)}%`,
    `found ${found}`,
    ...(t?.reasons.length ? [`why=${t.reasons.join(",")}`] : []),
    ...(t?.degraded.length ? [`degraded=${t.degraded.join(";")}`] : []),
    ...(r.relatedCandidates?.length ? [plural(r.relatedCandidates.length, "related")] : []),
    traceLevel() >= 2 ? `excerpt=${JSON.stringify(postExcerpt(d.text))}` : undefined,
    added,
    `left=${remaining}`,
    `run: ${rep.processed} analysed, ${rep.merged} merged, ${rep.promoted} promoted`,
  ];
}

/** The same line for a post the pre-filter dropped before any model was called. */
function describeIrrelevant(
  d: RawDispatch,
  index: number,
  total: number,
  remaining: number,
): (string | number | undefined)[] {
  return [
    `${index}/${total}`,
    d.sourceName,
    "engine=pre-filter",
    "found 0 systems",
    "skipped (no drone signal)",
    traceLevel() >= 2 ? `excerpt=${JSON.stringify(postExcerpt(d.text))}` : undefined,
    `left=${remaining}`,
  ];
}

/**
 * Correlate the analysed archive into events and stamp the ids on the dispatches. Only members
 * of a real cluster get one, and only when it changed, so a re-run is idempotent. Runs after a
 * batch: the correlation is about what the archive now holds, not about one dispatch.
 */
export function stampEvents(dispatches: DispatchRepository): number {
  const list = dispatches.list();
  const clusters = clusterEvents(list);
  if (clusters.size === 0) {
    // Clusters can also *lose* a member (a claim retracted, a merge collapsed two systems), so
    // a stale stamp is cleared even when nothing clusters this run.
    return list
      .filter((d) => d.eventId)
      .reduce((n, d) => {
        dispatches.update(d.id, { eventId: undefined });
        return n + 1;
      }, 0);
  }
  let changed = 0;
  for (const d of list) {
    const eventId = clusters.get(d.id);
    if (eventId !== d.eventId) {
      dispatches.update(d.id, eventId ? { eventId } : { eventId: undefined });
      changed++;
    }
  }
  return changed;
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
    promoted: event.promoted,
    discarded: event.discarded,
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
  /** Posts suppressed as near-duplicates. Only source rows carry it; see collectSource. */
  duplicates?: number;
  /** Wall-clock for this source. Only source rows carry it. */
  durationMs?: number;
  error?: string;
}

export const dispatchId = (sourceId: string, externalId: string) => `${sourceId}|${externalId}`;

/**
 * Stage 1 — network only. Fetch a source and store every new post as a pending dispatch.
 * No AI calls, so it is fast and never blocked by model latency or rate limits.
 *
 * A post that duplicates one already stored is written as a `duplicate` stub: same external id, so
 * it is never re-fetched, text stripped so it is never analysed, and pointing at the canonical
 * dispatch so the archive still shows which sources carried the story. Suppressing them here is
 * what stops one fact from being extracted three times over and recorded as three claim sources in
 * consensus().
 */
export async function collectSource(
  s: MonitoredSource,
  fetcher: Fetcher,
  dispatches: DispatchRepository,
): Promise<CollectReport> {
  const started = Date.now();
  const res = await fetcher(s);
  if (!res.ok)
    return {
      source: s.name,
      fetched: 0,
      stored: 0,
      duplicates: 0,
      durationMs: Date.now() - started,
      error: res.error,
    };
  const now = new Date().toISOString();
  let stored = 0;
  let duplicates = 0;
  for (const p of res.posts) {
    const id = dispatchId(s.id, p.id);
    // URL identity first: the same article republished by another source is one story regardless
    // of how much text each feed served, which is not something the fingerprint below can decide.
    // Checked before the row exists, so the document's own id is not yet in the index.
    const duplicateOf =
      dispatches.duplicateOfUrl?.(p.url, id) ??
      // Only long enough posts are fingerprinted: below MIN_CHARS_FOR_DEDUPE a fingerprint is
      // noise, and short posts are cheap to re-analyse anyway.
      (p.text.length >= MIN_CHARS_FOR_DEDUPE
        ? (dispatches.duplicateOf?.(simHash64(p.text)) ?? null)
        : null);
    const fingerprint = p.text.length >= MIN_CHARS_FOR_DEDUPE ? simHash64(p.text) : undefined;

    const d: RawDispatch = duplicateOf
      ? {
          id,
          sourceId: s.id,
          sourceName: s.name,
          externalId: p.id,
          url: p.url,
          text: "",
          publishedAt: p.date,
          createdAt: now,
          status: "duplicate",
          contentHash: fingerprint,
          duplicateOf,
        }
      : {
          id,
          sourceId: s.id,
          sourceName: s.name,
          externalId: p.id,
          url: p.url,
          text: p.text,
          publishedAt: p.date,
          createdAt: now,
          status: "pending",
          contentHash: fingerprint,
        };
    // add() still dedupes on the external id, so a re-fetch of a known post stores nothing and is
    // counted in neither bucket.
    if (dispatches.add(d)) {
      if (duplicateOf) duplicates++;
      else stored++;
    }
  }
  return {
    source: s.name,
    fetched: res.posts.length,
    stored,
    duplicates,
    durationMs: Date.now() - started,
  };
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
        });
        if (d.reanalyze) supersedeCandidates(d, r.candidate.id, deps);
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
          ...(r.candidate.extraction.metadata ? { analysis: r.candidate.extraction.metadata } : {}),
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

/**
 * The analysis pipeline a post was processed with. Includes the prompt version, so a prompt
 * change re-analyses old posts on its own; bump the suffix for a pipeline change that should too
 * (`/2`: AI-decided identity, the auto-promotion guards, and the outage handling).
 */
export const PIPELINE_VERSION = `${EXTRACTION_PROMPT_VERSION}/2`;

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

/**
 * Remove the spec claims a post contributed, from every catalog entry. A claim is the post's when
 * it carries the post's id (the merge paths) or its source line (promotion, which predates ids).
 * Returns `restore`, which puts the entries back for when the re-run fails, and
 * `restoreReviews`, which puts analyst verdicts back on the claims a successful re-run produced.
 */
function retractContribution(
  d: RawDispatch,
  deps: PipelineDeps,
): { restore: () => void; restoreReviews: () => void } {
  const source = `${d.sourceName} · ${d.url}`;
  // A claim the analyst filed (a moved figure, a hand-entered one) is not the post's
  // contribution: the post is re-read, the analyst's own reading stands.
  const mine = (c: { sourceId?: string; source: string; extractionEngine?: string }) =>
    c.extractionEngine !== "analyst" && (c.sourceId === d.id || c.source === source);
  const before: Drone[] = [];
  const held: HeldReview[] = [];
  for (const drone of deps.drones.list()) {
    if (!drone.specs.some((s) => s.claims.some(mine))) continue;
    before.push(drone);
    held.push(...heldReviews(drone, mine));
    deps.drones.upsert({
      ...drone,
      specs: drone.specs
        .map((s) => ({ ...s, claims: s.claims.filter((c) => !mine(c)) }))
        .filter((s) => s.claims.length > 0),
    });
  }
  return {
    restore: () => {
      for (const drone of before) deps.drones.upsert(drone);
    },
    restoreReviews: () => {
      for (const id of new Set(held.map((h) => h.droneId))) {
        const drone = deps.drones.get(id);
        if (!drone) continue;
        const next = restoreReviews(drone, held, mine);
        if (next !== drone) deps.drones.upsert(next);
      }
    },
  };
}

/** The earlier run's candidates still awaiting triage are replaced by the new run's. */
function supersedeCandidates(d: RawDispatch, replacement: string, deps: PipelineDeps) {
  const pending = new Set(
    deps.candidates
      .list()
      .filter((c) => c.status === "pending")
      .map((c) => c.id),
  );
  for (const id of d.candidateIds ?? []) {
    if (!pending.has(id) || id === replacement) continue;
    deps.candidates.update(id, {
      status: "discarded",
      resolvedBy: "auto",
      supersededBy: replacement,
    });
  }
}
