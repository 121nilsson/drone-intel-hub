import { chatCompletionOnce, providerRpm } from "./ai-proxy.server";
import { HeuristicExtractor } from "./heuristic-ai";
import {
  LocalCandidateRepository,
  LocalDispatchRepository,
  LocalDroneRepository,
  LocalSourceRepository,
  LocalTaxonomyCandidateRepository,
  LocalTaxonomyRepository,
} from "./local-repository";
import {
  OpenAICompatibleExtractor,
  openAICompatibleAdjudicator,
  openAIContradictionAdjudicator,
} from "./openai-compatible-ai";
import { autoTriage } from "@/features/intake/auto-triage";
import { outletWeights } from "@/entities/source/outlet-record";
import { adjudicateContradictions } from "@/features/intake/contradictions";
import { dbConfigured } from "./postgres/db.server";
import { PostgresStore } from "./postgres/postgres-store.server";
import { DEFAULT_SETTINGS } from "./settings-defaults";
import { readProviderEnvConfig } from "./provider-env.server";
import {
  QUEUE_ROW,
  collectSource,
  fetchingProgress,
  processPending,
  REANALYSIS_BATCH,
  requeueStale,
  progressFromItem,
  type SyncReport,
  type WorkProgress,
} from "@/features/sources/auto-ingest";
import { fetchOne, FETCH_CONCURRENCY, sourceHost } from "./fetch-posts";
import { mapWithConcurrency } from "./pool";
import { healthAfterFetch, isCollectable, platformDrift } from "@/features/sources/source-health";
import { isDue, yieldBySource } from "@/features/sources/cadence";

/** AI time per run. Under the 10-minute cron period so a run never overlaps the next tick. */
const AI_WINDOW_MS = 8 * 60_000;
const CALLS_PER_DISPATCH = 1.5;
/** How many dispatches one run may lease, also when pacing is off and only the deadline binds. */
const MAX_BATCH = 400;
/**
 * Deadline for one source's requests. `0` disables, matching the PROVIDER_TIMEOUT_MS convention in
 * the README; the default lives in fetch-posts.ts so the browser button shares it.
 */
const FETCH_TIMEOUT_MS = Number(process.env["FETCH_TIMEOUT_MS"] ?? 15_000);

/**
 * Server-side auto-ingest: the body the scheduled task invokes.
 *
 * Reuses the same write-through repositories the browser uses, attached to PostgresStore,
 * so candidates and merged specs persist exactly as on a manual sync. Only the transport
 * is server-side; collectSource, processPending and the two-tier pipeline are shared with the UI.
 */
export async function fetchAllSources(
  report?: (progress: WorkProgress) => Promise<void> | void,
  opts: {
    /** While set, stage 2 is skipped: the provider recently rate-limited this key. */
    cooldownUntil?: string;
    /** Poll every collectable source, not just those the cadence says are due. Manual runs force. */
    force?: boolean;
  } = {},
): Promise<{ reports: SyncReport[]; stopReason?: string }> {
  if (!dbConfigured()) throw new Error("Auto-sync needs DATABASE_URL (PostgreSQL)");

  const store = new PostgresStore();
  const sources = new LocalSourceRepository();
  const drones = new LocalDroneRepository();
  const candidates = new LocalCandidateRepository();
  const dispatches = new LocalDispatchRepository();
  const taxonomies = new LocalTaxonomyRepository();
  const taxonomyCandidates = new LocalTaxonomyCandidateRepository();
  await Promise.all([
    sources.attach(store),
    drones.attach(store),
    candidates.attach(store),
    dispatches.attach(store),
    taxonomies.attach(store),
    taxonomyCandidates.attach(store),
  ]);

  // Any provider with a key enables AI, and the models are the ones the chain sends first - the
  // same resolution the Settings page and the browser use (see readProviderEnvConfig).
  const env = await readProviderEnvConfig();
  const useRemote = env.hasKey;
  const cfg = {
    ...DEFAULT_SETTINGS,
    baseUrl: env.baseUrl ?? DEFAULT_SETTINGS.baseUrl,
    tier1Model: env.tier1Model ?? DEFAULT_SETTINGS.tier1Model,
    tier2Model: env.tier2Model ?? DEFAULT_SETTINGS.tier2Model,
    apiKey: "",
  };

  // Call the transport directly: the cron tick has no Start request context, so routing
  // through the chatCompletion server function would throw.
  const deps = {
    drones,
    candidates,
    taxonomyCandidates,
    tier1: useRemote
      ? new OpenAICompatibleExtractor(1, cfg, chatCompletionOnce)
      : new HeuristicExtractor(1),
    tier2: useRemote
      ? new OpenAICompatibleExtractor(2, cfg, chatCompletionOnce)
      : new HeuristicExtractor(2),
    heuristic: new HeuristicExtractor(1),
    fallback: new HeuristicExtractor(1),
    heuristicFirst: DEFAULT_SETTINGS.heuristicFirst,
    // A provider outage leaves the post pending for the next tick instead of recording a
    // heuristic-only result as final.
    deferOnOutage: true,
    escalationThreshold: DEFAULT_SETTINGS.escalationThreshold,
    autoMergeThreshold: DEFAULT_SETTINGS.autoMergeThreshold,
    autoPromoteThreshold: DEFAULT_SETTINGS.autoPromoteThreshold,
    autoDiscardThreshold: DEFAULT_SETTINGS.autoDiscardThreshold,
  };

  // Stage 1: collect every source into the dispatch queue (network only).
  // Opt-out rather than opt-in: sources without the flag predate it and keep being polled.
  // Off and paused sources are skipped; a pause ends on its own (see source-health.ts).
  // Within that, each source keeps a lane its own measured yield earned (cadence.ts), so the
  // fixed 10-minute cron stops spending most of its requests on sources that never paid off.
  // A manual run forces the whole list: an operator asking for "all" means all.
  const yields = yieldBySource(dispatches.list());
  const targets = sources
    .list()
    .filter(
      (s) =>
        s.platform !== "X" &&
        isCollectable(s) &&
        (opts.force === true || isDue(s, yields.get(s.id))),
    );
  const reports: SyncReport[] = [];

  // Article bodies need a DOM, so the extractor is server-only and injected into the shared
  // transport. Imported once per run, not once per source.
  // Also import content filters for post-processing
  const articleText =
    process.env["FETCH_ARTICLE_BODIES"] !== "0"
      ? (await import("./article.server")).extractArticleText
      : undefined;

  // Content filters for reducing noise in extracted text
  const { filterGeneralContent, getFilterForPlatform } = await import("./content-filters");

  // Collected in parallel lanes rather than one source at a time: ~79 hosts fetched sequentially
  // paid the sum of every latency, which ran to minutes before stage 2 even began. Same-host
  // sources are still serialised (see the pool's `key`) and each request shares one deadline, so a
  // single dead endpoint can no longer hold the whole pass open.
  const fetcher = (s: (typeof targets)[number]) =>
    fetchOne(s, {
      timeoutMs: FETCH_TIMEOUT_MS,
      ...(process.env["X_BRIDGE_BASE"] ? { xBridgeBase: process.env["X_BRIDGE_BASE"] } : {}),
      ...(process.env["X_JINA_READER"] === "1" ? { xJinaReader: true } : {}),
      ...(articleText ? { articleText } : {}),
    });

  // How many posts each fetched source returned, for the drift check below. A source that
  // errored is deliberately left out: an erroring host is the health streak's business, and
  // counting it as "no posts" would blame a parser for an outage.
  const fetchedById = new Map<string, number>();
  const collected = await mapWithConcurrency(
    targets,
    FETCH_CONCURRENCY,
    async (s) => {
      const c = await collectSource(s, fetcher, dispatches);
      if (!c.error) fetchedById.set(s.id, c.fetched);
      sources.update(s.id, {
        lastFetched: new Date().toISOString(),
        lastError: c.error,
        ...healthAfterFetch(s, c.error, Date.now(), c.fetched),
      });
      return c;
    },
    {
      // One in-flight request per host: parallel requests to one host trip its rate limit.
      key: sourceHost,
      onSettled: (p) => {
        void report?.(fetchingProgress(p.item?.name ?? "", p.done, p.total));
      },
    },
  );

  // Every source on one platform answering 200 with no posts in the same run is what a parser
  // change looks like - one silent source reads as a quiet day, the fleet pattern does not.
  // Sources the cadence deferred are not in fetchedById, so they cannot masquerade as silence.
  const drift = platformDrift(
    sources
      .list()
      .filter((s) => fetchedById.has(s.id))
      .map((s) => ({
        platform: s.platform,
        fetched: fetchedById.get(s.id)!,
        lastPostAt: s.lastPostAt,
      })),
  );
  if (drift.length)
    console.log(
      `[sources:sync] suspicious: ${drift.join("; ")} — likely a parser change, not a quiet day`,
    );

  for (const result of collected) {
    // collectSource reports failures as a value, so a rejected worker is a bug (or a store
    // serialisation failure) rather than an unreachable source - either way it must be reported.
    const c = result.status === "fulfilled" ? result.value : null;
    reports.push({
      source: c?.source ?? "Unknown",
      fetched: c?.fetched ?? 0,
      relevant: 0,
      merged: 0,
      queued: 0,
      duplicates: c?.duplicates ?? 0,
      durationMs: c?.durationMs ?? 0,
      ...(c ? (c.error ? { error: c.error } : {}) : { error: "Collection failed" }),
    });
  }
  if (opts.cooldownUntil) {
    const pending = dispatches.pending(Number.MAX_SAFE_INTEGER).length;
    const current = `Cooling down until ${opts.cooldownUntil} after a provider rate limit`;
    await report?.({ ...fetchingProgress(current, 0, 0), phase: "done", remaining: pending });
    reports.push({
      source: QUEUE_ROW,
      fetched: 0,
      relevant: 0,
      merged: 0,
      queued: 0,
      error: `${current}, ${pending} pending`,
    });
    return { reports };
  }

  // Stage 2: drain the queue for a fixed window; the rest waits for the next tick. Leased, so a
  // manual browser run overlapping this tick cannot process the same dispatch twice.
  //
  // The batch is sized from the request budget rather than a fixed count: the pacer allows
  // `rpm` calls a minute and a dispatch costs ~1.5 calls (tier-2 escalation), so this is about
  // what the window can actually fit. The deadline is the real bound - it keeps a slow model
  // from running the job into the next tick. With pacing off (self-hosted) the deadline alone
  // bounds the run. The lease scales with the batch (leaseFor) so it outlives the run.
  const rpm = providerRpm();
  const limit = rpm ? Math.ceil(((AI_WINDOW_MS / 60_000) * rpm) / CALLS_PER_DISPATCH) : MAX_BATCH;
  // Assigned only inside onItem, which control-flow analysis cannot see; the cast keeps it
  // from being narrowed to `null` for the rest of the function.
  let lastItem = null as WorkProgress | null;
  const p = await processPending(dispatches, deps, Math.min(limit, MAX_BATCH), {
    deadline: Date.now() + AI_WINDOW_MS,
    onItem: async (event) => {
      lastItem = progressFromItem(event);
      await report?.(lastItem);
    },
  });
  // Spare capacity goes to re-analysing posts an older pipeline handled. Only once the live
  // queue is empty and providers are answering, so fresh reporting always comes first; the
  // requeued posts are picked up by the next tick.
  if (!p.stopReason && p.remaining === 0) {
    const requeued = requeueStale(dispatches, REANALYSIS_BATCH);
    if (requeued) console.log(`[sources:sync] queued ${requeued} older post(s) for re-analysis`);
  }
  // Work the Queue: corroborated names promoted, borderline matches adjudicated, stale
  // low-confidence candidates discarded. No model calls while the providers are out.
  const triage = await autoTriage(
    { drones, candidates },
    {
      // Outlet precision from the same archive the cadence reads, so a name is corroborated by
      // outlets whose past reporting backs them, not by two feeds that only ever repost.
      outletWeights: outletWeights(dispatches.list()),
      ...(useRemote && !p.stopReason
        ? { adjudicate: openAICompatibleAdjudicator(cfg, chatCompletionOnce) }
        : {}),
    },
  );
  if (
    triage.corroborated ||
    triage.adjudicatedMerged ||
    triage.adjudicatedReleased ||
    triage.agedOut
  )
    console.log(
      `[sources:sync] triage: ${triage.corroborated} corroborated, ${triage.adjudicatedMerged} merged and ${triage.adjudicatedReleased} released by adjudication, ${triage.agedOut} aged out${triage.stopReason ? ` (adjudication stopped: ${triage.stopReason})` : ""}`,
    );
  // Contested figures: the deep model says, once per disputed spec, which report behind the
  // disagreement is best supported. Provenance stays whole; the claims carry the verdict.
  const contradictions = await adjudicateContradictions(
    drones,
    useRemote && !p.stopReason
      ? { adjudicate: openAIContradictionAdjudicator(cfg, chatCompletionOnce) }
      : {},
  );
  if (contradictions.checked)
    console.log(
      `[sources:sync] contradictions: ${contradictions.checked} spec(s) checked, ${contradictions.outliers} claim(s) marked outlier${contradictions.stopReason ? ` (stopped: ${contradictions.stopReason})` : ""}`,
    );
  await report?.({
    phase: "done",
    current: lastItem?.current ?? QUEUE_ROW,
    ...(lastItem?.currentId ? { currentId: lastItem.currentId } : {}),
    index: lastItem?.index ?? 0,
    total: lastItem?.total ?? 0,
    processed: p.processed,
    irrelevant: p.irrelevant,
    merged: p.merged,
    promoted: p.promoted,
    discarded: p.discarded,
    queued: p.queued,
    failed: p.failed,
    remaining: p.remaining,
    updatedAt: new Date().toISOString(),
  });
  reports.push({
    source: QUEUE_ROW,
    fetched: p.processed + p.irrelevant,
    relevant: p.processed,
    merged: p.merged,
    queued: p.queued,
    // Backlog is reported whenever there is any, not only on failure - otherwise a queue that
    // is quietly growing looks identical to a healthy one.
    ...(p.failed || p.remaining
      ? {
          error: `${p.failed} failed${p.stopReason ? ` · ${p.stopReason}` : ""}, ${p.remaining} pending`,
        }
      : {}),
  });
  return { reports, ...(p.stopReason ? { stopReason: p.stopReason } : {}) };
}
