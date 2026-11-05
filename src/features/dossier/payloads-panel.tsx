import { Panel, EmptyNote } from "@/shared/ui/primitives";
import { consensus } from "@/entities/drone/consensus";
import { type Drone, type SpecAttribute } from "@/entities/drone/types";

export function PayloadsPanel({
  drone: d,
  payloadFacts,
}: {
  drone: Drone;
  payloadFacts: SpecAttribute[];
}) {
  return (
    <Panel id="payloads" title="Payload configurations" className="scroll-mt-28">
      <ul className="space-y-2 text-sm">
        {(d.payloads ?? []).map((p, i) => (
          <li key={`${p.name}-${i}`}>
            <p>
              {p.name}
              {p.quantity ? ` × ${p.quantity}` : ""}
            </p>
            <p className="font-mono text-xs text-muted-foreground">
              {[p.category, p.weightKg ? `${p.weightKg} kg` : undefined]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {p.evidence && (
              <p className="text-xs leading-relaxed text-muted-foreground">“{p.evidence}”</p>
            )}
          </li>
        ))}
        {!d.payloads?.length && !payloadFacts.length && (
          <li>
            <EmptyNote>No payloads traced.</EmptyNote>
          </li>
        )}
      </ul>
      {payloadFacts.length > 0 && (
        <>
          <p className="mt-3 text-xs font-medium text-muted-foreground">Figures</p>
          <ul className="mt-1 space-y-2 text-sm">
            {payloadFacts.map((s) => {
              const c = consensus(s);
              return (
                <li key={s.key}>
                  <p>{s.label}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {c.display} · {c.sources} source{c.sources === 1 ? "" : "s"}
                  </p>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Panel>
  );
}
