import { serverServices } from "@/shared/infra/server-services.server";
import { yieldDrift, type FetchHistoryEntry } from "@/entities/source/health";
import type { SourceFetchHealth } from "@/shared/contracts/autonomy-insights";

export interface SourceFetchEntry {
  sourceId: string;
  ok: boolean;
  fetched: number;
  duplicates: number;
  error?: string | undefined;
}

/** Rows older than this are dropped once per sync; a source is fetched every ~10 minutes. */
const KEEP_DAYS = 90;
/** Fetches per source read for the drift check; enough to see ten successes plus a long earlier run. */
const DRIFT_ROWS = 200;

/**
 * Append one fetch to the source's history. Best effort: this runs beside the sync and must not
 * change its result or its speed, so any failure is logged and dropped, and without a database it
 * does nothing.
 */
export async function recordSourceFetch(entry: SourceFetchEntry): Promise<void> {
  try {
    await serverServices().sourceLog.append({
      sourceId: entry.sourceId,
      ok: entry.ok,
      fetched: entry.fetched,
      duplicates: entry.duplicates,
      error: entry.error?.slice(0, 500) ?? null,
    });
  } catch (e) {
    console.error(`[source-fetch-log] could not record fetch of ${entry.sourceId}`, e);
  }
}

/**
 * Drop history older than KEEP_DAYS. Called once per sync rather than per fetch, so a sync of
 * ~80 sources issues one delete instead of eighty. Same best-effort rules as recordSourceFetch.
 */
export async function pruneSourceFetchLog(): Promise<void> {
  try {
    await serverServices().sourceLog.prune(KEEP_DAYS);
  } catch (e) {
    console.error("[source-fetch-log] could not prune", e);
  }
}

/** Per-source health over the last `days`: totals, the last success and failure, and a drift flag. */
export async function listSourceFetchHealth(
  days = 30,
  now = new Date(),
): Promise<SourceFetchHealth[]> {
  try {
    const log = serverServices().sourceLog;
    const totals = await log.totals(days);
    const history = await log.history(days, DRIFT_ROWS);

    const bySource = new Map<string, FetchHistoryEntry[]>();
    const lastError = new Map<string, { at: number; error: string }>();
    for (const r of history) {
      const list = bySource.get(r.sourceId) ?? [];
      list.push({ at: r.at.toISOString(), ok: r.ok, fetched: r.fetched, relevant: r.relevant });
      bySource.set(r.sourceId, list);
      if (!r.ok && r.error) {
        const prev = lastError.get(r.sourceId);
        if (!prev || r.at.getTime() > prev.at)
          lastError.set(r.sourceId, { at: r.at.getTime(), error: r.error });
      }
    }

    return totals.map((t) => {
      const drift = yieldDrift(bySource.get(t.sourceId) ?? [], now.getTime());
      const err = lastError.get(t.sourceId)?.error;
      return {
        sourceId: t.sourceId,
        fetches: t.fetches,
        failures: t.failures,
        fetched: t.fetched,
        relevant: t.relevant,
        ...(t.lastOkAt ? { lastOkAt: t.lastOkAt.toISOString() } : {}),
        ...(err ? { lastError: err } : {}),
        ...(drift ? { drift } : {}),
      };
    });
  } catch (e) {
    console.error("[source-fetch-log] could not read health", e);
    return [];
  }
}
