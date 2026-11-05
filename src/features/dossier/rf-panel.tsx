import { Panel, Tag, EmptyNote } from "@/shared/ui/primitives";
import { ieeeLabel, natoLabel } from "@/entities/normalization/bands";
import { effectiveIeeeBands, effectiveNatoBands, linkIsFiber } from "@/entities/normalization/rf";
import { type Drone } from "@/entities/drone/types";

export function RfPanel({ drone: d }: { drone: Drone }) {
  return (
    <Panel id="rf" title="RF spectrum" className="scroll-mt-28">
      {!d.rf.length && <EmptyNote>No RF links recorded.</EmptyNote>}
      <ul className="space-y-2">
        {d.rf.map((r, i) => {
          const ieee = effectiveIeeeBands(r).map(ieeeLabel);
          const nato = effectiveNatoBands(r).map(natoLabel);
          const fiber = linkIsFiber(r);
          return (
            <li key={i} className="flex items-start justify-between gap-2 text-sm" title={r.band}>
              <Tag tone={r.role === "antijam" ? "accent" : fiber ? "accent" : "default"}>
                {fiber ? "tether" : r.role}
              </Tag>
              <div className="flex-1 text-right">
                <span className="font-mono">
                  {r.freqMHz ? `${r.freqMHz[0]}–${r.freqMHz[1]} MHz` : r.band}
                </span>
                {(ieee.length > 0 || nato.length > 0) && (
                  <p className="font-mono text-xs text-muted-foreground">
                    {[...ieee, ...nato].join(" · ")}
                  </p>
                )}
                {r.protocols?.length ? (
                  <p className="font-mono text-xs text-muted-foreground">
                    {r.protocols.join(", ")}
                  </p>
                ) : null}
                {r.notes && <p className="text-xs text-muted-foreground">{r.notes}</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
