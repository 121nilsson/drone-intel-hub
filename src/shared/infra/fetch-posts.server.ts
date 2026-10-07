import { chatCompletionOnce } from "./ai-proxy.server";
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
import { collectSource, processPending, type SyncReport } from "@/features/sources/auto-ingest";
import { fetchOne } from "./fetch-posts";

/**
 * Server-side auto-ingest: the body the scheduled task invokes.
 *
 * Reuses the same write-through repositories the browser uses, attached to PostgresStore,
 * so candidates and merged specs persist exactly as on a manual sync. Only the transport
 * is server-side; collectSource, processPending and the two-tier pipeline are shared with the UI.
 */
export async function fetchAllSources(): Promise<SyncReport[]> {
  if (!dbConfigured()) throw new Error("Auto-sync needs DATABASE_URL (PostgreSQL)");

  const store = new PostgresStore();
  const sources = new LocalSourceRepository();
  const drones = new LocalDroneRepository();
  const candidates = new LocalCandidateRepository();
  const dispatches = new LocalDispatchRepository();
  await Promise.all([sources.attach(store), drones.attach(store), candidates.attach(store), dispatches.attach(store)]);

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
  };

  // Stage 1: collect every source into the dispatch queue (network only).
  const targets = sources.list().filter((s) => s.platform !== "X");
  const reports: SyncReport[] = [];
  for (const s of targets) {
    const c = await collectSource(s, fetchOne, dispatches);
    sources.update(s.id, { lastFetched: new Date().toISOString(), lastError: c.error });
    reports.push({ source: s.name, fetched: c.stored, relevant: 0, merged: 0, queued: 0, ...(c.error ? { error: c.error } : {}) });
  }
  // Stage 2: drain a bounded batch; the rest waits for the next tick.
  const p = await processPending(dispatches, deps, 25);
  reports.push({ source: "Queue", fetched: p.processed + p.irrelevant, relevant: p.processed, merged: p.merged, queued: p.queued, ...(p.failed ? { error: `${p.failed} failed, ${p.remaining} pending` } : {}) });
  return reports;
}
