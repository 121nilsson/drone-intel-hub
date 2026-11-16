import type {
  SourceFetchHistoryRow,
  SourceFetchTotals,
  SourceLogRepo,
} from "@/shared/contracts/source-log-repo";
import { db } from "@/shared/infra/postgres/db.server";

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

/** PostgreSQL adapter for SourceLogRepo. */
export function createPostgresSourceLogRepo(): SourceLogRepo {
  return {
    async append(entry) {
      await db()`
      insert into source_fetch_log (source_id, ok, fetched, duplicates, error)
      values (${entry.sourceId}, ${entry.ok}, ${entry.fetched}, ${entry.duplicates},
              ${entry.error})`;
    },

    async prune(days) {
      await db()`delete from source_fetch_log where at < now() - make_interval(days => ${days})`;
    },

    async totals(days): Promise<SourceFetchTotals[]> {
      const totals = await db()<TotalsRow[]>`
      select source_id,
             count(*)::int as fetches,
             count(*) filter (where not ok)::int as failures,
             coalesce(sum(fetched), 0)::int as fetched,
             coalesce(sum(relevant), 0)::int as relevant,
             max(at) filter (where ok) as last_ok_at
        from source_fetch_log
       where at >= now() - make_interval(days => ${days})
       group by source_id`;
      return totals.map((t) => ({
        sourceId: t.source_id,
        fetches: t.fetches,
        failures: t.failures,
        fetched: t.fetched,
        relevant: t.relevant,
        lastOkAt: t.last_ok_at,
      }));
    },

    async history(days, perSource): Promise<SourceFetchHistoryRow[]> {
      const history = await db()<HistoryRow[]>`
      select source_id, at, ok, fetched, relevant, error from (
        select *, row_number() over (partition by source_id order by at desc) as n
          from source_fetch_log
         where at >= now() - make_interval(days => ${days})) r
       where n <= ${perSource}`;
      return history.map((r) => ({
        sourceId: r.source_id,
        at: r.at,
        ok: r.ok,
        fetched: r.fetched,
        relevant: r.relevant,
        error: r.error,
      }));
    },
  };
}
