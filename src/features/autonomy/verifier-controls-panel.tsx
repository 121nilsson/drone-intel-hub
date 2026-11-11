import { useEffect, useState } from "react";
import { AUDIT_BUDGET } from "@/entities/drone/audit";
import { useServices } from "@/shared/infra/use-services";
import type { VerifierControlsStatus } from "@/shared/contracts/verification";
import { DataTable, type Column } from "@/shared/ui/data-table";
import { pct, pctPrecise } from "@/shared/ui/format";
import { CardGrid, Panel, Tag } from "@/shared/ui/primitives";
import type { ControlStratum } from "@/entities/drone/verifier-controls";
import { Stat } from "./stat";

/**
 * The second reader on claims that were altered to be wrong on purpose (plan Section 4.5). A
 * "supported" here is a false support, so the bound is set against the audit's budget. Measured
 * only: nothing acts on the result yet, and the panel says so.
 */

const STATUS: Record<
  ControlStratum["status"],
  { label: string; tone: "success" | "danger" | "muted" }
> = {
  within: { label: "Within budget", tone: "success" },
  over: { label: "Over budget", tone: "danger" },
  too_few: { label: "Too few to say", tone: "muted" },
};

const columns: readonly Column<ControlStratum>[] = [
  { id: "family", header: "Family", cell: (s) => s.family },
  { id: "language", header: "Language", cell: (s) => s.language, className: "font-mono" },
  { id: "asked", header: "Asked", cell: (s) => s.asked, align: "right", className: "font-mono" },
  {
    id: "falseSupports",
    header: "False supports",
    cell: (s) => s.supported,
    align: "right",
    className: "font-mono",
  },
  {
    id: "bound",
    header: "Bound",
    cell: (s) => pctPrecise(s.falseSupportBound),
    align: "right",
    className: "font-mono",
  },
  {
    id: "status",
    header: "Status",
    cell: (s) => (
      <Tag tone={STATUS[s.status].tone} mono>
        {STATUS[s.status].label}
      </Tag>
    ),
  },
];

export function VerifierControlsPanel() {
  const { autonomyInsights } = useServices();
  const [status, setStatus] = useState<VerifierControlsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    autonomyInsights.controls().then(
      (s) => {
        if (!cancelled) setStatus(s);
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [autonomyInsights]);

  const summary = status?.summary;

  return (
    <Panel
      title="Second reader on injected errors"
      right={
        <Tag tone="muted" mono>
          measured only
        </Tag>
      }
    >
      <p className="text-xs text-muted-foreground">
        These are claims altered on purpose so that they are wrong: the post does not state the
        figure. A &quot;supported&quot; answer on one is a false support. The result is measured;
        nothing acts on it yet.
      </p>
      {error ? (
        <p className="mt-3 text-sm text-destructive">Could not load the controls ({error}).</p>
      ) : !summary ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
      ) : summary.asked === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No controls asked yet. The job runs hourly.
        </p>
      ) : (
        <>
          <CardGrid cols={3} className="mt-4">
            <Stat
              label="Controls asked"
              value={`${summary.asked}`}
              hint="altered claims, all strata"
            />
            <Stat
              label="False supports"
              value={`${summary.supported}`}
              hint={`${summary.unsupported} unsupported · ${summary.uncertain} uncertain`}
            />
            <Stat
              label="Upper bound"
              value={pctPrecise(summary.falseSupportBound)}
              hint={`against a ${pct(AUDIT_BUDGET)} budget`}
            />
          </CardGrid>
          {status.strata.length > 0 && (
            <div className="mt-4">
              <DataTable
                bare
                label="Second reader strata"
                columns={columns}
                rows={status.strata}
                rowKey={(s) => `${s.family}|${s.language}`}
              />
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
