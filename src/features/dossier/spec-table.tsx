import { useState } from "react";
import { consensus } from "@/entities/drone/consensus";
import { groupSpecs } from "@/entities/drone/spec-groups";
import { claimKey } from "@/entities/drone/claim-review";
import { type Drone, type SpecAttribute } from "@/entities/drone/types";
import { ConfidenceTag, Tag } from "@/shared/ui/primitives";
import { DataTable, type Column } from "@/shared/ui/data-table";
import { displayUnit } from "@/entities/normalization/units";
import { ClaimChip } from "./claim-chip";
import { ProvenanceSheet } from "./provenance-sheet";
import type { ClaimSelection } from "./provenance-types";

/** "min–max" when the claims disagree on the figure, else empty. */
// The spread between point readings only: the envelope (min–max) mixes ranges and bounds, and
// would show a source's range that no source stated.
function spread(c: ReturnType<typeof consensus>): string {
  return c.observedSpread ? `${c.observedSpread.min}–${c.observedSpread.max}` : "";
}

/** What each source stated as a range or bound, one line per source: never merged into one range. */
function statedRanges(c: ReturnType<typeof consensus>): string[] {
  return (c.explicitRanges ?? []).map((r) => {
    const unit = displayUnit(r.canonicalUnit);
    const outlet = r.source.split(" · ")[0] ?? r.source;
    const figure =
      r.min !== undefined && r.max !== undefined
        ? `${r.min}–${r.max}`
        : r.max !== undefined
          ? `≤${r.max}`
          : `≥${r.min}`;
    return `${outlet}: ${figure} ${unit}`;
  });
}

function liveSelection(drone: Drone, sel: ClaimSelection): ClaimSelection | null {
  const spec = drone.specs.find((s) => s.key === sel.spec.key);
  const key = claimKey(sel.claim);
  const claim = spec?.claims.find((c) => claimKey(c) === key);
  return spec && claim ? { spec, claim } : null;
}

export function SpecTable({ drone }: { drone: Drone }) {
  const [sel, setSel] = useState<ClaimSelection | null>(null);
  // The sheet reads the selection from the live entry, so a verdict given in it shows at once
  // instead of on the copy that was clicked.
  const live = sel ? liveSelection(drone, sel) : null;
  const chips = (s: SpecAttribute) => (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {s.claims.map((claim, i) => (
        <ClaimChip key={i} claim={claim} onOpen={() => setSel({ spec: s, claim })} />
      ))}
    </div>
  );
  // Fixed widths: a source URL is a long unbroken string, and under auto layout it took every
  // pixel and crammed the value columns together.
  const columns: Column<SpecAttribute>[] = [
    {
      id: "attribute",
      header: "Attribute",
      width: "52%",
      cell: (s) => (
        <>
          {s.label}{" "}
          {s.discoveredBy === "ai" && (
            <Tag tone="accent" className="ml-1">
              AI-discovered
            </Tag>
          )}
          {chips(s)}
        </>
      ),
    },
    {
      id: "consensus",
      header: "Consensus",
      width: "18%",
      className: "font-mono text-primary",
      cell: (s) => {
        const c = consensus(s);
        return (
          <>
            {c.display}{" "}
            {c.disputed && (
              <Tag tone="danger" className="ml-1">
                Disputed
              </Tag>
            )}
          </>
        );
      },
    },
    {
      id: "spread",
      header: "Spread",
      width: "12%",
      className: "font-mono text-xs text-muted-foreground",
      cell: (s) => spread(consensus(s)) || "—",
    },
    {
      id: "sources",
      header: "Sources",
      width: "9%",
      className: "font-mono text-xs",
      cell: (s) => consensus(s).sources,
    },
    {
      id: "confidence",
      header: "Conf.",
      width: "9%",
      cell: (s) => <ConfidenceTag level={consensus(s).confidence} />,
    },
  ];
  return (
    <>
      <DataTable
        bare
        label="Specifications"
        columns={columns}
        rows={drone.specs}
        sections={groupSpecs(drone.specs).map((g) => ({ id: g.id, label: g.label, rows: g.specs }))}
        rowKey={(s) => s.key}
        card={(s) => {
          const c = consensus(s);
          return (
            <div data-testid={`spec-${s.key}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm">
                  {s.label}
                  {s.discoveredBy === "ai" && (
                    <Tag tone="accent" className="ml-1.5">
                      AI
                    </Tag>
                  )}
                </p>
                <ConfidenceTag level={c.confidence} />
              </div>
              <p className="mt-1 font-mono text-lg text-primary">
                {c.display}
                {c.disputed && (
                  <Tag tone="danger" className="ml-2 align-middle">
                    Disputed
                  </Tag>
                )}
              </p>
              <p className="font-mono text-xs text-muted-foreground">
                {spread(c) ? `${spread(c)} · ` : ""}
                {c.sources} source{c.sources === 1 ? "" : "s"}
              </p>
              {statedRanges(c).map((line) => (
                <p key={line} className="font-mono text-[11px] text-muted-foreground">
                  {line}
                </p>
              ))}
              {chips(s)}
            </div>
          );
        }}
      />
      <ProvenanceSheet
        selection={live}
        droneId={drone.id}
        droneName={drone.name}
        specs={drone.specs}
        onClose={() => setSel(null)}
      />
    </>
  );
}
