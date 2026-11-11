import { useEffect, useMemo, useState } from "react";
import type { SourceFetchHealth } from "@/shared/contracts/autonomy-insights";
import { useServices, useSources } from "@/shared/infra/use-services";
import { DataTable, type Column } from "@/shared/ui/data-table";
import { dateTime } from "@/shared/ui/format";
import { Panel, Tag } from "@/shared/ui/primitives";

/**
 * Sources whose fetches failed or whose yield drifted over the last 30 days, worst first. A source
 * that fetched cleanly is left out: the list is for the ones a person should look at.
 */

const MAX_ROWS = 25;

/**
 * A source is fetched about every ten minutes, so a stray failure over 30 days is normal. Without
 * a drift flag a source is listed only when at least this share of its fetches failed.
 */
const UNSTEADY_SHARE = 0.2;
const unsteady = (h: SourceFetchHealth) =>
  h.fetches > 0 && h.failures / h.fetches >= UNSTEADY_SHARE;

/** Failing before quiet, then the sources with the most failures. */
const rank = (h: SourceFetchHealth) => (h.drift === "failing" ? 0 : h.drift === "quiet" ? 1 : 2);

export function SourceHealthPanel() {
  const { autonomyInsights } = useServices();
  const sources = useSources();
  const [health, setHealth] = useState<SourceFetchHealth[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    autonomyInsights.sourceHealth(30).then(
      (h) => {
        if (!cancelled) setHealth(h);
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [autonomyInsights]);

  const names = useMemo(() => new Map(sources.map((s) => [s.id, s.name])), [sources]);

  const flagged = useMemo(
    () =>
      (health ?? [])
        .filter((h) => h.drift !== undefined || unsteady(h))
        .sort((a, b) => rank(a) - rank(b) || b.failures - a.failures),
    [health],
  );
  const rows = flagged.slice(0, MAX_ROWS);

  const columns: readonly Column<SourceFetchHealth>[] = [
    {
      id: "source",
      header: "Source",
      cell: (h) => (
        <>
          <span>{names.get(h.sourceId) ?? h.sourceId}</span>
          {h.lastError && (
            <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
              {h.lastError}
            </span>
          )}
        </>
      ),
    },
    {
      id: "fetches",
      header: "Fetches",
      cell: (h) => h.fetches,
      align: "right",
      className: "font-mono",
    },
    {
      id: "failures",
      header: "Failures",
      cell: (h) => h.failures,
      align: "right",
      className: "font-mono",
    },
    {
      id: "fetched",
      header: "Posts fetched",
      cell: (h) => h.fetched,
      align: "right",
      className: "font-mono",
    },
    {
      id: "lastOk",
      header: "Last success",
      cell: (h) =>
        h.lastOkAt ? <span className="font-mono text-xs">{dateTime(h.lastOkAt)}</span> : "—",
    },
    {
      id: "status",
      header: "Status",
      cell: (h) =>
        h.drift === "quiet" ? (
          <Tag tone="muted" mono>
            Quiet
          </Tag>
        ) : h.drift === "failing" ? (
          <Tag tone="danger" mono>
            Failing
          </Tag>
        ) : (
          <Tag tone="muted" mono>
            Unsteady
          </Tag>
        ),
    },
  ];

  return (
    <Panel
      title="Source fetch health (30 days)"
      right={
        flagged.length > MAX_ROWS ? (
          <Tag tone="muted" mono>
            showing {MAX_ROWS} of {flagged.length}
          </Tag>
        ) : undefined
      }
    >
      {error ? (
        <p className="text-sm text-destructive">Could not load source health ({error}).</p>
      ) : health === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Every source fetched without trouble.</p>
      ) : (
        <DataTable
          bare
          label="Source fetch health"
          columns={columns}
          rows={rows}
          rowKey={(h) => h.sourceId}
        />
      )}
    </Panel>
  );
}
