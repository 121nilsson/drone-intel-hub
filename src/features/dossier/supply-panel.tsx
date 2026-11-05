import { Panel, EmptyNote } from "@/shared/ui/primitives";
import { CountryBadge } from "@/shared/ui/country-badge";
import { type Drone } from "@/entities/drone/types";

export function SupplyPanel({ drone: d }: { drone: Drone }) {
  return (
    <Panel id="supply" title="Supply chain" className="scroll-mt-28">
      <ul className="space-y-2 text-sm">
        {d.components.map((c, i) => (
          <li key={i}>
            <p>{c.part}</p>
            <p className="font-mono text-xs text-muted-foreground">
              {c.manufacturer} · <CountryBadge code={c.origin} />
            </p>
          </li>
        ))}
        {!d.components.length && (
          <li>
            <EmptyNote>No components traced.</EmptyNote>
          </li>
        )}
      </ul>
    </Panel>
  );
}
