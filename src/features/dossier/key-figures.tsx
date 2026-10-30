import { useMemo } from "react";
import { consensus } from "@/entities/drone/consensus";
import { topSpecs } from "@/entities/drone/spec-groups";
import type { Drone } from "@/entities/drone/types";
import { useDispatches } from "@/shared/infra/services";
import { TimeAgo } from "@/shared/ui/time-ago";

function Figure({
  label,
  children,
  sub,
  tone = "primary",
}: {
  label: string;
  children: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "primary" | "accent" | "muted";
}) {
  return (
    <div className="min-w-0 border border-border bg-card/60 px-3 py-2">
      <p className="truncate font-mono text-2xs uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p
        className={
          tone === "accent"
            ? "truncate font-mono text-lg text-accent"
            : tone === "muted"
              ? "truncate font-mono text-lg text-foreground/80"
              : "truncate font-mono text-lg text-primary"
        }
      >
        {children}
      </p>
      {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

/**
 * The first screen of a dossier answers "what is this, and how current": the defining figures,
 * the price when one is known, and how much reporting stands behind it. Every figure here is also
 * in the specification table below; this only lifts the ones a reader looks for first.
 */
export function KeyFigures({ drone }: { drone: Drone }) {
  const dispatches = useDispatches();
  const reporting = useMemo(() => {
    let count = 0;
    let last = "";
    for (const d of dispatches)
      if (d.droneIds?.includes(drone.id)) {
        count++;
        const at = d.publishedAt ?? d.createdAt;
        if (at > last) last = at;
      }
    return { count, last };
  }, [dispatches, drone.id]);
  const figures = topSpecs(drone.specs, 4);
  const cost = drone.specs.find((s) => s.key === "unit_cost");
  const sources = new Set(drone.specs.flatMap((s) => s.claims.map((c) => c.source))).size;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="key-figures">
      {figures.map((s) => {
        const c = consensus(s);
        return (
          <Figure
            key={s.key}
            label={s.label}
            sub={`${c.sources} source${c.sources === 1 ? "" : "s"}${c.disputed ? " · disputed" : ""}`}
          >
            {c.display}
          </Figure>
        );
      })}
      {cost && (
        <Figure
          label="Unit cost"
          tone="accent"
          sub={`${cost.claims.length} source${cost.claims.length === 1 ? "" : "s"}`}
        >
          {consensus(cost).display}
        </Figure>
      )}
      <Figure
        label="Last report"
        tone="muted"
        sub={`${reporting.count} report${reporting.count === 1 ? "" : "s"} · ${sources} source${sources === 1 ? "" : "s"}`}
      >
        {reporting.last ? <TimeAgo iso={reporting.last} /> : "none yet"}
      </Figure>
    </div>
  );
}
