import { Link } from "@tanstack/react-router";
import { Panel } from "@/shared/ui/primitives";
import { CountryBadge } from "@/shared/ui/country-badge";
import { type Drone } from "@/entities/drone/types";

export function CounterpartsPanel({
  drone: d,
  counterparts,
}: {
  drone: Drone;
  counterparts: Drone[];
}) {
  return (
    <Panel id="counterparts" title="Counterparts" className="scroll-mt-28">
      {counterparts.map((c) => (
        <Link
          data-testid={`counterpart-link-${c.id}`}
          key={c.id}
          to="/counterparts"
          search={{ a: d.id, b: c.id }}
          className="block py-1 hover:text-primary"
        >
          {c.name}{" "}
          <span className="text-xs text-muted-foreground">
            <CountryBadge code={c.origin} />
          </span>{" "}
          →
        </Link>
      ))}
      {!counterparts.length && <p className="text-sm text-muted-foreground">None linked.</p>}
    </Panel>
  );
}
