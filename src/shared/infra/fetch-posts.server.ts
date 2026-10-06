import { chatCompletionOnce } from "./ai-proxy.server";
import { HeuristicExtractor } from "./heuristic-ai";
import {
  LocalCandidateRepository,
  LocalDroneRepository,
  LocalSourceRepository,
} from "./local-repository";
import { OpenAICompatibleExtractor } from "./openai-compatible-ai";
import { dbConfigured } from "./postgres/db.server";
import { PostgresStore } from "./postgres/postgres-store.server";
import { DEFAULT_SETTINGS } from "./settings-defaults";
import { syncSource, type SyncReport } from "@/features/sources/auto-ingest";
import { fetchOne } from "./fetch-posts";

/**
 * Server-side auto-ingest: the body the scheduled task invokes.
 *
 * Reuses the same write-through repositories the browser uses, attached to PostgresStore,
 * so candidates and merged specs persist exactly as on a manual sync. Only the transport
 * is server-side; syncSource and the two-tier pipeline are shared with the UI.
 */
export async function fetchAllSources(): Promise<SyncReport[]> {
  if (!dbConfigured()) throw new Error("Auto-sync needs DATABASE_URL (PostgreSQL)");

  const store = new PostgresStore();
  const sources = new LocalSourceRepository();
  const drones = new LocalDroneRepository();
  const candidates = new LocalCandidateRepository();
  await Promise.all([sources.attach(store), drones.attach(store), candidates.attach(store)]);

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

  const targets = sources.list().filter((s) => s.platform !== "X");
  const reports: SyncReport[] = [];
  for (const s of targets) {
    const rep = await syncSource(s, fetchOne, deps, (ids) => {
      const cur = sources.list().find((x) => x.id === s.id);
      sources.update(s.id, { seenIds: [...ids, ...(cur?.seenIds ?? [])].slice(0, 500) });
    });
    // Mirror the browser path: stamp the source and surface any fetch error on it.
    sources.update(s.id, { lastFetched: new Date().toISOString(), lastError: rep.error });
    reports.push(rep);
  }
  return reports;
}
