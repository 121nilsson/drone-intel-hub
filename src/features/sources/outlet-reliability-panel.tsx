import type { RawDispatch } from "@/entities/dispatch/types";
import { outletRecords } from "@/entities/source/outlet-record";
import { Panel } from "@/shared/ui/primitives";

export function OutletReliabilityPanel({ dispatches }: { dispatches: readonly RawDispatch[] }) {
  return (
    <Panel title="Outlet reliability">
      {(() => {
        const rows = outletRecords(dispatches)
          .filter((r) => r.stored >= 1)
          .sort((a, b) => {
            if (Math.abs(b.weight - a.weight) > 0.001) return a.weight - b.weight;
            return b.stored - a.stored;
          })
          .slice(0, 12);
        if (rows.length === 0) {
          return (
            <p className="text-sm text-muted-foreground">
              Not enough dispatch history yet. Reliability appears once outlets have stored posts.
            </p>
          );
        }
        return (
          <div className="space-y-1 font-mono text-xs">
            {rows.map((r) => {
              const ratio = r.stored === 0 ? 0 : r.relevant / r.stored;
              const tone =
                r.weight < 1
                  ? "text-destructive"
                  : r.weight > 1
                    ? "text-primary"
                    : "text-muted-foreground";
              return (
                <div key={r.key} className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="truncate">{r.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.stored} stored · {r.relevant} relevant · {Math.round(ratio * 100)}% signal
                    </div>
                  </div>
                  <div className={`text-[11px] ${tone}`}>{r.weight.toFixed(2)}</div>
                </div>
              );
            })}
            <p className="mt-2 text-[11px] text-muted-foreground">
              Weight 0.5–1.5 (neutral &lt; 5 posts). 100% relevant → 1.5, 0% → 0.5.
            </p>
          </div>
        );
      })()}
    </Panel>
  );
}
