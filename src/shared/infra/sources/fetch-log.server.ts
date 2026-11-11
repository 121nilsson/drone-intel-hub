import { db, dbConfigured } from "@/shared/infra/postgres/db.server";
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
  if (!dbConfigured()) return;
  try {
    await db()`
      insert into source_fetch_log (source_id, ok, fetched, duplicates, error)
      values (${entry.sourceId}, ${entry.ok}, ${entry.fetched}, ${entry.duplicates},
              ${entry.error?.slice(0, 500) ?? null})`;
  } catch (e) {
    console.error(`[source-fetch-log] could not record fetch of ${entry.sourceId}`, e);
  }
}

/**
 * Drop history older than KEEP_DAYS. Called once per sync rather than per fetch, so a sync of
 * ~80 sources issues one delete instead of eighty. Same best-effort rules as recordSourceFetch.
 */
export async function pruneSourceFetchLog(): Promise<void> {
  if (!dbConfigured()) return;
  try {
    await db()`delete from source_fetch_log where at < now() - make_interval(days => ${KEEP_DAYS})`;
  } catch (e) {
    console.error("[source-fetch-log] could not prune", e);
  }
}

interface TotalsRow {
  source_id: string;
  fetches: number;
  failures: number;
  fetched: number;
  relevant: number;
  last_ok_at: Date | null;
}

interface HistoryRow {
  source_id: string;
  at: Date;
  ok: boolean;
  fetched: number;
  relevant: number;
  error: string | null;
}

/** Per-source health over the last `days`: totals, the last success and failure, and a drift flag. */
export async function listSourceFetchHealth(
  days = 30,
  now = new Date(),
): Promise<SourceFetchHealth[]> {
  if (!dbConfigured()) return [];
  try {
    const sql = db();
    const totals = await sql<TotalsRow[]>`
      select source_id,
             count(*)::int as fetches,
             count(*) filter (where not ok)::int as failures,
             coalesce(sum(fetched), 0)::int as fetched,
             coalesce(sum(relevant), 0)::int as relevant,
             max(at) filter (where ok) as last_ok_at
        from source_fetch_log
       where at >= now() - make_interval(days => ${days})
       group by source_id`;
    const history = await sql<HistoryRow[]>`
      select source_id, at, ok, fetched, relevant, error from (
        select *, row_number() over (partition by source_id order by at desc) as n
          from source_fetch_log
         where at >= now() - make_interval(days => ${days})) r
       where n <= ${DRIFT_ROWS}`;

    const bySource = new Map<string, FetchHistoryEntry[]>();
    const lastError = new Map<string, { at: number; error: string }>();
    for (const r of history) {
      const list = bySource.get(r.source_id) ?? [];
      list.push({ at: r.at.toISOString(), ok: r.ok, fetched: r.fetched, relevant: r.relevant });
      bySource.set(r.source_id, list);
      if (!r.ok && r.error) {
        const prev = lastError.get(r.source_id);
        if (!prev || r.at.getTime() > prev.at)
          lastError.set(r.source_id, { at: r.at.getTime(), error: r.error });
      }
    }

    return totals.map((t) => {
      const drift = yieldDrift(bySource.get(t.source_id) ?? [], now.getTime());
      const err = lastError.get(t.source_id)?.error;
      return {
        sourceId: t.source_id,
        fetches: t.fetches,
        failures: t.failures,
        fetched: t.fetched,
        relevant: t.relevant,
        ...(t.last_ok_at ? { lastOkAt: t.last_ok_at.toISOString() } : {}),
        ...(err ? { lastError: err } : {}),
        ...(drift ? { drift } : {}),
      };
    });
  } catch (e) {
    console.error("[source-fetch-log] could not read health", e);
    return [];
  }
}
