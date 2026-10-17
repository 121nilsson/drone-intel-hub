import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  linkExposure,
  radarSystems,
  segmentStatus,
  spectrumEntries,
  type Exposure,
  type SegmentStatus,
} from "@/entities/normalization/spectrum-bands";
import { useDrones, useServices } from "@/shared/infra/services";
import { Loading, Panel } from "@/shared/ui/primitives";
import { useRelatedIntel, RelatedRail } from "@/features/intel-graph";

const EXPOSURE: Record<Exposure, { label: string; cls: string }> = {
  jammed: { label: "Jammed", cls: "border-destructive/60 bg-destructive/10 text-destructive" },
  evades: { label: "Evades", cls: "border-success/60 bg-success/10 text-success" },
  fiber: { label: "Fiber immune", cls: "border-primary/60 bg-primary/10 text-primary" },
  unknown: { label: "Unknown", cls: "border-border text-muted-foreground" },
};

function Chips({
  items,
  cls,
  focus,
}: {
  items: { system: string; systemId: string }[];
  cls: string;
  focus: string | undefined;
}) {
  const names = [...new Map(items.map((i) => [i.systemId, i.system])).entries()];
  if (!names.length) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {names.map(([id, n]) => (
        <span
          key={id}
          className={`border px-1.5 py-0.5 font-mono text-[11px] ${cls} ${
            focus && focus !== id ? "opacity-40" : ""
          }`}
        >
          {n}
        </span>
      ))}
    </div>
  );
}

function SegmentCard({ s, focus }: { s: SegmentStatus; focus: string | undefined }) {
  return (
    <div className="border border-border bg-card p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-sm font-semibold text-foreground">{s.segment.label}</span>
        {s.evasionGap && (
          <span className="border border-warning/60 bg-warning/10 px-1.5 font-mono text-[10px] uppercase text-warning">
            Evasion gap
          </span>
        )}
      </div>
      <p className="mb-2 text-xs text-muted-foreground">{s.segment.use}</p>
      <dl className="space-y-1.5 text-xs">
        <Row label="Drone links">
          <Chips items={s.links} cls="border-accent/50 text-accent" focus={focus} />
        </Row>
        <Row label="Jammers">
          <Chips items={s.jammers} cls="border-destructive/50 text-destructive" focus={focus} />
        </Row>
        <Row label="Radars">
          <Chips items={s.radars} cls="border-primary/50 text-primary" focus={focus} />
        </Row>
        {s.detectors.length > 0 && (
          <Row label="RF detectors">
            <Chips items={s.detectors} cls="border-border text-foreground" focus={focus} />
          </Row>
        )}
      </dl>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

export function SpectrumPage() {
  const drones = useDrones();
  const svc = useServices();
  const entries = useMemo(() => spectrumEntries(drones), [drones]);
  const segments = useMemo(() => segmentStatus(entries), [entries]);
  const radars = radarSystems(entries);
  const linkSystems = drones.filter((d) =>
    entries.some((e) => e.systemId === d.id && e.kind === "link"),
  );
  const [focus, setFocus] = useState<string>();
  const focused = drones.find((d) => d.id === focus);
  const exposure = focused ? linkExposure(focused, entries) : [];
  const relatedIntel = useRelatedIntel(focus);

  // Until the store attaches, every segment reads as "no documented RF" — hold instead.
  if (!svc.attached) return <Loading label="Loading spectrum…" />;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-mono text-xl font-bold tracking-widest text-primary">
          SPECTRUM CAT &amp; MOUSE
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Where drones transmit, where jammers blanket, and where C-UAS radars watch. Radars detect
          airframes even when a drone is radio-silent or fiber-tethered.
        </p>
      </header>

      <Panel title="Inspect a system">
        <select
          value={focus ?? ""}
          onChange={(e) => setFocus(e.target.value || undefined)}
          aria-label="Inspect system"
          className="w-full border border-border bg-background px-3 py-2 font-mono text-sm sm:w-80"
        >
          <option value="">-- All systems --</option>
          {linkSystems.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        {focused && (
          <div className="mt-4 space-y-2">
            {!exposure.length && (
              <p className="text-sm text-muted-foreground">No radio links recorded.</p>
            )}
            {exposure.map((x, i) => (
              <div key={i} className={`border-l-2 p-2.5 ${EXPOSURE[x.exposure].cls}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs uppercase">{x.link.role}</span>
                  <span className="font-mono text-[11px] font-semibold uppercase">
                    {EXPOSURE[x.exposure].label}
                  </span>
                </div>
                <p className="font-mono text-sm text-foreground">
                  {x.link.freqMHz ? `${x.link.freqMHz[0]}–${x.link.freqMHz[1]} MHz` : x.link.label}
                </p>
                <p className="text-xs text-muted-foreground">
                  {x.exposure === "jammed"
                    ? `Covered by ${x.by.join(", ")}`
                    : x.exposure === "evades"
                      ? "No recorded jammer covers this band"
                      : x.exposure === "fiber"
                        ? "Physical tether bypasses all RF jamming"
                        : "Frequency not recorded"}
                </p>
              </div>
            ))}
            {radars.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Airframe still detectable by radar: {radars.join(", ")}.{" "}
                <Link
                  to="/systems/$id"
                  params={{ id: focused.id }}
                  className="text-primary underline"
                >
                  Open dossier
                </Link>
              </p>
            )}
            {focused && (
              <div className="mt-4 pt-4 border-t border-border">
                <RelatedRail
                  edges={relatedIntel?.edges ?? []}
                  title={`Related to ${focused.name}`}
                  maxItems={8}
                />
              </div>
            )}
          </div>
        )}
      </Panel>

      <section>
        <h2 className="mb-3 font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Spectrum strip · low → high
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {segments.map((s) => (
            <SegmentCard key={s.segment.id} s={s} focus={focus} />
          ))}
        </div>
      </section>
    </div>
  );
}
