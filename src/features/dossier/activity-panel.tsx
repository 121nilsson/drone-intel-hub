import { useMemo } from "react";
import type { ActivityMetric, ActivityRecord } from "@/entities/drone/types";
import { EmptyNote, Panel } from "@/shared/ui/primitives";
import { SourceRef } from "@/shared/ui/links";

/**
 * What reports say happened with the system: launched, intercepted, delivered, produced. A series
 * by period, never a figure - it feeds no consensus - so it is listed, newest period first, with
 * the report each figure came from.
 */

const METRIC: Record<ActivityMetric, string> = {
  launched: "Launched",
  intercepted: "Intercepted / destroyed",
  delivered: "Delivered / received",
  produced: "Produced",
  kills: "Kills",
  ordered: "Ordered",
};

function figure(r: ActivityRecord): string {
  const n = (v: number) => v.toLocaleString("en-US");
  const q = r.quantity;
  // A range keeps both ends; a bound reads as one ("≥ 2,800"), with the report's own words on
  // hover for whether it was "more than" or "at least".
  const core =
    q.value !== undefined
      ? `${q.approximate ? "≈ " : ""}${n(q.value)}`
      : q.min !== undefined && q.max !== undefined
        ? `${n(q.min)}–${n(q.max)}`
        : q.min !== undefined
          ? `≥ ${n(q.min)}`
          : q.max !== undefined
            ? `≤ ${n(q.max)}`
            : r.raw;
  return `${core}${r.unit ? ` ${r.unit}` : ""}${r.per ? ` per ${r.per}` : ""}`;
}

export function ActivityPanel({ activity }: { activity: readonly ActivityRecord[] | undefined }) {
  const rows = useMemo(
    () =>
      [...(activity ?? [])].sort((a, b) =>
        (b.period?.from ?? b.date).localeCompare(a.period?.from ?? a.date),
      ),
    [activity],
  );
  return (
    <Panel id="activity" title="Reported activity" className="scroll-mt-28">
      {rows.length ? (
        <ul className="space-y-3 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="border-b border-border pb-3 last:border-0 last:pb-0">
              <p>
                <span className="font-mono" title={r.raw}>
                  {figure(r)}
                </span>{" "}
                <span className="text-muted-foreground">
                  {METRIC[r.metric].toLowerCase()}
                  {r.period ? ` · ${r.period.label}` : ""}
                  {r.provenance === "heuristic" ? " · the AI did not confirm it" : ""}
                </span>
              </p>
              {r.evidence && (
                <p className="mt-0.5 text-xs italic text-muted-foreground">“{r.evidence}”</p>
              )}
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                <SourceRef source={r.source} />
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyNote>No launches, deliveries or other activity reported.</EmptyNote>
      )}
    </Panel>
  );
}
