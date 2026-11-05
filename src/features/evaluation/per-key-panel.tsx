import { useMemo } from "react";
import { Btn, Card, ListRow, Panel, Tag } from "@/shared/ui/primitives";
import type { EvalReport } from "@/shared/infra/evaluation/evaluation";
import { Coverage } from "./evaluation-kpi";
import { pct } from "./evaluation-format";

export function PerKeyPanel({
  report,
  openKey,
  setOpenKey,
}: {
  report: EvalReport;
  openKey: string | null;
  setOpenKey: (key: string | null) => void;
}) {
  const keys = useMemo(
    () =>
      Object.entries(report.perKey)
        .filter(([, v]) => v.tp + v.fp + v.fn > 0)
        .sort(([, a], [, b]) => a.f1 - b.f1 || b.tp + b.fn - (a.tp + a.fn)),
    [report],
  );
  return (
    <Panel title="Per spec key (worst first)" contentClassName="p-0">
      {(report.unscoredMisses ?? 0) > 0 && (
        <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
          {report.unscoredMisses} stored figure{report.unscoredMisses === 1 ? "" : "s"} with no
          canonical meaning (role, status, container dimensions…) are not scored: the heuristic
          never tries to read them.
        </p>
      )}
      <ul className="divide-y divide-border">
        {keys.map(([k, v]) => {
          const mis = report.mismatches.filter((m) => m.specKey === k);
          return (
            // The key name is the toggle; a row cannot sit inside a button, since the
            // row is itself a list item.
            <ListRow
              key={k}
              className="px-3"
              title={
                <Btn
                  variant="link"
                  className="font-mono"
                  aria-expanded={openKey === k}
                  onClick={() => setOpenKey(openKey === k ? null : k)}
                >
                  {openKey === k ? "▾" : "▸"} {k}
                </Btn>
              }
              subtitle={`tp ${v.tp} · fp ${v.fp} · fn ${v.fn}`}
              meta={
                <div className="flex flex-wrap items-center gap-1.5">
                  <Tag tone={v.f1 < 0.5 ? "danger" : v.f1 < 0.8 ? "warning" : "success"} mono>
                    F1 {v.f1.toFixed(2)} · P {pct(v.precision)} · R {pct(v.recall)}
                  </Tag>
                  {report.perKeyReference[k] && <Coverage c={report.perKeyReference[k]!} />}
                </div>
              }
              below={
                openKey === k ? (
                  <div className="space-y-2">
                    {mis.length === 0 && (
                      <p className="text-xs text-muted-foreground">No mismatches.</p>
                    )}
                    {mis.map((m, i) => (
                      <Card key={i} className="text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <Tag tone="warning" mono>
                            {m.matchType}
                          </Tag>
                          <span className="min-w-0 break-all font-mono text-muted-foreground">
                            {m.source}
                          </span>
                        </div>
                        <div className="mt-1 font-mono">
                          key: {m.specKey} · {m.matchType}
                        </div>

                        <div className="mt-1 font-mono">
                          heuristic: {m.heuristicValue ?? "—"} {m.heuristicUnit ?? ""} → stored:{" "}
                          {m.referenceValue ?? "—"} {m.referenceUnit ?? ""}
                        </div>
                        {m.evidence && (
                          <p className="mt-1 break-words italic text-muted-foreground">
                            “{m.evidence}”
                          </p>
                        )}
                      </Card>
                    ))}
                  </div>
                ) : undefined
              }
            />
          );
        })}
      </ul>
    </Panel>
  );
}
