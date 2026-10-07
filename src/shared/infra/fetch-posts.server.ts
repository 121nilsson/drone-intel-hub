import { chatCompletionOnce, providerRpm } from "./ai-proxy.server";
import { HeuristicExtractor } from "./heuristic-ai";
import {
  LocalCandidateRepository,
  LocalDispatchRepository,
  LocalDroneRepository,
  LocalSourceRepository,
} from "./local-repository";
import { OpenAICompatibleExtractor } from "./openai-compatible-ai";
import { dbConfigured } from "./postgres/db.server";
import { PostgresStore } from "./postgres/postgres-store.server";
import { DEFAULT_SETTINGS } from "./settings-defaults";
import {
  QUEUE_ROW,
  collectSource,
  fetchingProgress,
  processPending,
  progressFromItem,
  type SyncReport,
  type WorkProgress,
} from "@/features/sources/auto-ingest";
import { fetchOne } from "./fetch-posts";

/** AI time per run. Under the 10-minute cron period so a run never overlaps the next tick. */
const AI_WINDOW_MS = 8 * 60_000;
const CALLS_PER_DISPATCH = 1.5;
/** How many dispatches one run may lease, also when pacing is off and only the deadline binds. */
const MAX_BATCH = 400;

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
  } = {},
): Promise<{ reports: SyncReport[]; stopReason?: string }> {
  if (!dbConfigured()) throw new Error("Auto-sync needs DATABASE_URL (PostgreSQL)");

  const store = new PostgresStore();
  const sources = new LocalSourceRepository();
  const drones = new LocalDroneRepository();
  const candidates = new LocalCandidateRepository();
  const dispatches = new LocalDispatchRepository();
  await Promise.all([
    sources.attach(store),
    drones.attach(store),
    candidates.attach(store),
    dispatches.attach(store),
  ]);

  const useRemote = !!process.env["NVIDIA_API_KEY"];
  const cfg = {
    ...DEFAULT_SETTINGS,
    baseUrl: process.env["NVIDIA_BASE_URL"] || DEFAULT_SETTINGS.baseUrl,
    tier1Model: process.env["NVIDIA_TIER1_MODEL"] || DEFAULT_SETTINGS.tier1Model,
    tier2Model: process.env["NVIDIA_TIER2_MODEL"] || DEFAULT_SETTINGS.tier2Model,
    apiKey: "",
  };

  // Call the transport directly: the cron tick has no Start request context, so routing
  // through the chatCompletion server function would throw.
  const deps = {
    drones,
    candidates,
    tier1: useRemote
      ? new OpenAICompatibleExtractor(1, cfg, chatCompletionOnce)
      : new HeuristicExtractor(1),
    tier2: useRemote
      ? new OpenAICompatibleExtractor(2, cfg, chatCompletionOnce)
      : new HeuristicExtractor(2),
    escalationThreshold: DEFAULT_SETTINGS.escalationThreshold,
    autoMergeThreshold: DEFAULT_SETTINGS.autoMergeThreshold,
    autoPromoteThreshold: DEFAULT_SETTINGS.autoPromoteThreshold,
    autoDiscardThreshold: DEFAULT_SETTINGS.autoDiscardThreshold,
  };

  // Stage 1: collect every source into the dispatch queue (network only).
  // Opt-out rather than opt-in: sources without the flag predate it and keep being polled.
  const targets = sources.list().filter((s) => s.platform !== "X" && s.autoSync !== false);
  const reports: SyncReport[] = [];
  for (let i = 0; i < targets.length; i++) {
    const s = targets[i]!;
    await report?.(fetchingProgress(s.name, i + 1, targets.length));
    const c = await collectSource(s, fetchOne, dispatches);
    sources.update(s.id, { lastFetched: new Date().toISOString(), lastError: c.error });
    reports.push({
      source: s.name,
      fetched: c.stored,
      relevant: 0,
      merged: 0,
      queued: 0,
      ...(c.error ? { error: c.error } : {}),
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
  const limit = rpm ? Math.ceil((AI_WINDOW_MS / 60_000) * rpm / CALLS_PER_DISPATCH) : MAX_BATCH;
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
