import { Card, Tag } from "@/shared/ui/primitives";
import type { Prf, ReferenceCoverage } from "@/shared/infra/evaluation/evaluation";
import { pct } from "@/shared/ui/format";

export function Kpi({ label, v }: { label: string; v: Prf }) {
  return (
    <Card className="p-3">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold">F1 {v.f1.toFixed(2)}</div>
      <div className="font-mono text-xs text-muted-foreground">
        P {pct(v.precision)} · R {pct(v.recall)}
      </div>
    </Card>
  );
}

/** Reference coverage beside a score: how much of what it was measured over is actually verified. */
export function Coverage({ c }: { c: ReferenceCoverage }) {
  return (
    <Tag tone={c.ratio >= 0.7 ? "success" : c.ratio >= 0.3 ? "warning" : "danger"} mono>
      ref {pct(c.ratio)} of {c.scored}
    </Tag>
  );
}
