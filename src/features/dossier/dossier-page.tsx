import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { consensus } from "@/entities/drone/consensus";
import { ieeeLabel, natoLabel } from "@/entities/normalization/bands";
import { effectiveIeeeBands, effectiveNatoBands, linkIsFiber } from "@/entities/normalization/rf";
import { type Drone, type SpecAttribute } from "@/entities/drone/types";
import { CountryBadge } from "@/shared/ui/country-badge";
import { ClaimChip, ProvenanceSheet, type ClaimSelection } from "./provenance-sheet";
import { useDrones, useServices } from "@/shared/infra/services";
import { removalImpact, removeDrone } from "@/features/intake/pipeline";
import { Btn, ConfidenceTag, Panel, Tag } from "@/shared/ui/primitives";

const DOSSIER_SECTIONS = [
  { id: "specs", label: "Specifications" },
  { id: "aliases", label: "Aliases" },
  { id: "rf", label: "RF spectrum" },
  { id: "supply", label: "Supply chain" },
  { id: "payloads", label: "Payloads" },
  { id: "sensors", label: "Sensors" },
  { id: "variants", label: "Variants" },
  { id: "counterparts", label: "Counterparts" },
  { id: "timeline", label: "Timeline" },
] as const;

function DossierSectionNav() {
  return (
    <nav
      aria-label="Dossier sections"
      className="sticky top-14 z-20 hidden border-y border-border bg-background/95 py-2 backdrop-blur md:block"
    >
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {DOSSIER_SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="font-mono text-[11px] text-muted-foreground hover:text-primary"
          >
            {s.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

export function SpecTable({ drone }: { drone: Drone }) {
  const [sel, setSel] = useState<ClaimSelection | null>(null);
  const chips = (s: SpecAttribute) => (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {s.claims.map((claim, i) => (
        <ClaimChip key={i} claim={claim} onOpen={() => setSel({ spec: s, claim })} />
      ))}
    </div>
  );
  return (
    <>
      {/* Phone: one card per attribute */}
      <ul className="space-y-2 sm:hidden">
        {drone.specs.map((s) => {
          const c = consensus(s);
          return (
            <li
              key={s.key}
              className="border border-border bg-background/40 p-3"
              data-testid={`spec-${s.key}`}
            >
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
                {c.min !== undefined && c.min !== c.max ? `${c.min}–${c.max} · ` : ""}
                {c.sources} source{c.sources === 1 ? "" : "s"}
              </p>
              {chips(s)}
            </li>
          );
        })}
      </ul>
      {/* table-fixed, and the widths are declared rather than negotiated. Under the default
          auto layout the browser hands the Attribute column whatever it wants, and a source URL
          is a long unbroken string, so it took every pixel and left the value columns crammed
          against each other with the row overflowing the panel. A fixed layout takes the widths
          from this header row instead, so no cell content can widen the table. */}
      <table className="hidden w-full table-fixed text-sm sm:table">
        <thead>
          <tr className="text-left font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="w-[52%] pb-2">Attribute</th>
            <th className="w-[18%] pb-2">Consensus</th>
            <th className="w-[12%] pb-2">Spread</th>
            <th className="w-[9%] pb-2">Sources</th>
            <th className="w-[9%] pb-2">Conf.</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {drone.specs.map((s) => {
            const c = consensus(s);
            return (
              <tr key={s.key} className="align-top">
                <td className="py-2">
                  {s.label}{" "}
                  {s.discoveredBy === "ai" && (
                    <Tag tone="accent" className="ml-1">
                      AI-discovered
                    </Tag>
                  )}
                  {chips(s)}
                </td>
                <td className="py-2 font-mono text-primary">
                  {c.display}{" "}
                  {c.disputed && (
                    <Tag tone="danger" className="ml-1">
                      Disputed
                    </Tag>
                  )}
                </td>
                <td className="py-2 font-mono text-xs text-muted-foreground">
                  {c.min !== undefined && c.min !== c.max ? `${c.min}–${c.max}` : "—"}
                </td>
                <td className="py-2 font-mono text-xs">{c.sources}</td>
                <td className="py-2">
                  <ConfidenceTag level={c.confidence} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ProvenanceSheet selection={sel} droneName={drone.name} onClose={() => setSel(null)} />
    </>
  );
}

/**
 * Delete a wrongly catalogued entry. Two steps: the first click shows what else the removal
 * touches, the second does it. See removeDrone for what is cleaned up.
 */
function DeleteSystem({ drone }: { drone: Drone }) {
  const svc = useServices();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  if (!confirming)
    return (
      <Btn variant="danger" onClick={() => setConfirming(true)}>
        Delete
      </Btn>
    );
  const impact = removalImpact(drone.id, svc);
  const effects = [
    impact.discarded &&
      `${impact.discarded} candidate${impact.discarded === 1 ? "" : "s"} marked discarded`,
    impact.unlinked &&
      `${impact.unlinked} linked system${impact.unlinked === 1 ? "" : "s"} unlinked`,
    impact.dispatches &&
      `${impact.dispatches} feed post${impact.dispatches === 1 ? "" : "s"} lose this link`,
  ].filter(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-2 border border-destructive/60 px-3 py-2 text-sm">
      <span>
        Delete <strong>{drone.name}</strong> and its {drone.specs.length} spec
        {drone.specs.length === 1 ? "" : "s"}?{effects.length ? ` ${effects.join(", ")}.` : ""} The
        name will not be auto-promoted again.
      </span>
      <Btn
        variant="danger"
        onClick={() => {
          removeDrone(drone.id, svc);
          void navigate({ to: "/catalog" });
        }}
      >
        Confirm delete
      </Btn>
      <Btn variant="ghost" onClick={() => setConfirming(false)}>
        Cancel
      </Btn>
    </div>
  );
}

export function DossierPage({ id }: { id: string }) {
  const drones = useDrones();
  const d = drones.find((x) => x.id === id);
  if (!d)
    return (
      <p className="text-muted-foreground">
        System not found.{" "}
        <Link to="/catalog" className="text-primary">
          Back to catalog
        </Link>
      </p>
    );
  const counterparts = drones.filter((x) => d.counterpartIds.includes(x.id));
  const parent = d.variantOfId ? drones.find((x) => x.id === d.variantOfId) : undefined;
  const variants = drones.filter((x) => d.variantIds?.includes(x.id) || x.variantOfId === d.id);
  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap gap-2">
          <Tag tone="primary">{d.domain}</Tag>
          <Tag caps={false} mono={false}>
            Origin <CountryBadge code={d.origin} />
          </Tag>
          {d.manufacturer && <Tag tone="accent">{d.manufacturer}</Tag>}
          {d.operators.map((o) => (
            <Tag key={o} tone="accent" caps={false} mono={false}>
              Operator <CountryBadge code={o} />
            </Tag>
          ))}
          <Tag>{d.propulsion}</Tag>
        </div>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-3xl font-semibold md:text-4xl">
            {d.name} {d.cyrillic && <span className="text-muted-foreground">{d.cyrillic}</span>}
          </h1>
          <DeleteSystem key={d.id} drone={d} />
        </div>
        <p className="mt-2 max-w-3xl text-base leading-relaxed text-muted-foreground">
          {d.summary}
        </p>
        {d.reference && (
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            <a
              href={d.reference.url}
              target="_blank"
              rel="noreferrer"
              className="underline"
              data-testid="reference-link"
            >
              {d.reference.url.includes("wikipedia.org") ? "Wikipedia, CC BY-SA 4.0" : "Wikidata"}
            </a>
          </p>
        )}
        {(() => {
          const cost = d.specs.find((s) => s.key === "unit_cost");
          return cost ? (
            <p className="mt-3 inline-flex items-center gap-2 border border-accent/40 px-3 py-1.5 font-mono text-sm">
              <span className="text-xs uppercase text-muted-foreground">Unit cost</span>
              <span className="text-accent">{consensus(cost).display}</span>
              <span className="text-xs text-muted-foreground">({cost.claims.length} src)</span>
            </p>
          ) : null;
        })()}
      </div>
      <DossierSectionNav />
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel id="specs" title="Consensus specifications" className="lg:col-span-2">
          <SpecTable drone={d} />
        </Panel>
        <Panel id="aliases" title="Alias registry">
          <ul className="space-y-1 font-mono text-sm">
            <li>
              <span className="text-muted-foreground">canonical</span> {d.name}
            </li>
            {d.cyrillic && (
              <li>
                <span className="text-muted-foreground">cyrillic</span> {d.cyrillic}
              </li>
            )}
            {d.aliases.map((a) => (
              <li key={a}>
                <span className="text-muted-foreground">alias</span> {a}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel id="rf" title="RF spectrum">
          <ul className="space-y-2">
            {d.rf.map((r, i) => {
              const ieee = effectiveIeeeBands(r).map(ieeeLabel);
              const nato = effectiveNatoBands(r).map(natoLabel);
              const fiber = linkIsFiber(r);
              return (
                <li
                  key={i}
                  className="flex items-start justify-between gap-2 text-sm"
                  title={r.band}
                >
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
        <Panel id="supply" title="Supply chain">
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
              <li className="text-muted-foreground">No components traced.</li>
            )}
          </ul>
        </Panel>
        <Panel id="payloads" title="Payload configurations">
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
            {!d.payloads?.length && <li className="text-muted-foreground">No payloads traced.</li>}
          </ul>
        </Panel>
        <Panel id="sensors" title="Sensors & cameras">
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
            {!d.sensors?.length && <li className="text-muted-foreground">No sensors traced.</li>}
          </ul>
        </Panel>
        <Panel id="variants" title="Variant family">
          {parent && (
            <Link
              data-testid={`parent-link-${parent.id}`}
              to="/systems/$id"
              params={{ id: parent.id }}
              className="block py-1 hover:text-primary"
            >
              Parent: {parent.name} →
            </Link>
          )}
          {variants.map((variant) => (
            <Link
              data-testid={`variant-link-${variant.id}`}
              key={variant.id}
              to="/systems/$id"
              params={{ id: variant.id }}
              className="block py-1 hover:text-primary"
            >
              Variant: {variant.name} →
            </Link>
          ))}
          {!parent && !variants.length && (
            <p className="text-sm text-muted-foreground">No family relationship recorded.</p>
          )}
        </Panel>
        <Panel id="counterparts" title="Counterparts">
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
      </div>
      <Panel id="timeline" title="Spec evolution timeline">
        <ol className="relative ml-2 border-l border-border">
          {[...d.evolution]
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((e, i) => (
              <li key={i} className="mb-4 ml-4">
                <span className="absolute -left-1.5 mt-1.5 h-3 w-3 border border-primary bg-background" />
                <p className="font-mono text-xs text-muted-foreground">
                  {e.date.slice(0, 10)} · {e.kind}
                </p>
                <p className="text-sm">
                  {e.description}{" "}
                  <span className="font-mono text-xs text-muted-foreground">— {e.source}</span>
                </p>
              </li>
            ))}
        </ol>
      </Panel>
      <div className="h-14 sm:hidden" />
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 gap-2 border-t border-border bg-background/95 p-2 backdrop-blur sm:hidden">
        <Link
          data-testid="compare-link"
          to="/counterparts"
          search={{ a: d.id, b: counterparts[0]?.id ?? "" }}
          className="border border-primary/50 py-2.5 text-center font-mono text-xs uppercase text-primary"
        >
          Compare
        </Link>
        <Link
          data-testid="source-posts-link"
          to="/dispatches"
          search={{ q: d.name }}
          className="border border-border py-2.5 text-center font-mono text-xs uppercase text-muted-foreground"
        >
          Posts
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger
            type="button"
            className="border border-border py-2.5 text-center font-mono text-xs uppercase text-muted-foreground outline-none hover:text-primary"
          >
            Jump to…
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="max-h-64 overflow-y-auto">
            {DOSSIER_SECTIONS.map((s) => (
              <DropdownMenuItem key={s.id} asChild>
                <a href={`#${s.id}`}>{s.label}</a>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>
    </div>
  );
}
