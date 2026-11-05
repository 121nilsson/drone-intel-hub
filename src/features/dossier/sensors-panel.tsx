import { Panel, EmptyNote } from "@/shared/ui/primitives";
import { consensus } from "@/entities/drone/consensus";
import { type Drone, type SpecAttribute } from "@/entities/drone/types";

export function SensorsPanel({
  drone: d,
  sensorFacts,
}: {
  drone: Drone;
  sensorFacts: SpecAttribute[];
}) {
  return (
    <Panel id="sensors" title="Sensors & cameras" className="scroll-mt-28">
      <ul className="space-y-2 text-sm">
        {(d.sensors ?? []).map((s, i) => (
          <li key={`${s.name}-${i}`}>
            <p>{s.name}</p>
            <p className="font-mono text-xs text-muted-foreground">
              {[s.category, s.model, s.manufacturer].filter(Boolean).join(" · ")}
            </p>
            {s.evidence && (
              <p className="text-xs leading-relaxed text-muted-foreground">“{s.evidence}”</p>
            )}
          </li>
        ))}
        {!d.sensors?.length && !sensorFacts.length && (
          <li>
            <EmptyNote>No sensors traced.</EmptyNote>
          </li>
        )}
      </ul>
      {sensorFacts.length > 0 && (
        <>
          <p className="mt-3 text-xs font-medium text-muted-foreground">Figures</p>
          <ul className="mt-1 space-y-2 text-sm">
            {sensorFacts.map((s) => {
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
