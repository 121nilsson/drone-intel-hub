import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { ExternalSourceLink } from "@/shared/ui/links";
import { OriginControl } from "./origin-control";
import { CountryBadge } from "@/shared/ui/country-badge";
import { Panel, Tag, Loading } from "@/shared/ui/primitives";
import { useDrones, useServices, useAttached } from "@/shared/infra/use-services";
import { useProcurements } from "@/shared/infra/use-procurements";
import { resolveRelations } from "@/entities/drone/system-hierarchy";
import { payloadSpecs, sensorSpecs } from "@/entities/drone/observations";
import { contractsForDrone } from "@/entities/procurement/match";
import { ActivityPanel } from "./activity-panel";
import { FamilyBreadcrumb, SystemRelationsPanel } from "./system-relations-panel";
import { KeyFigures } from "./key-figures";
import { SectionNav } from "@/shared/ui/section-nav";
import { useRelatedIntel, RelatedRail } from "@/shared/ui/intel-graph";
import { AddSpecForm } from "./add-spec-form";
import { AliasRegistry } from "./alias-registry";
import { DOSSIER_SECTIONS } from "./dossier-sections";
import { DeleteSystem } from "./delete-system";
import { DossierSummary } from "./dossier-summary";
import { SpecTable } from "./spec-table";
import { RfPanel } from "./rf-panel";
import { SupplyPanel } from "./supply-panel";
import { ContractsPanel } from "./contracts-panel";
import { PayloadsPanel } from "./payloads-panel";
import { SensorsPanel } from "./sensors-panel";
import { CounterpartsPanel } from "./counterparts-panel";
import { EvolutionTimeline } from "./evolution-timeline";
import { ClaimTimeline } from "./claim-timeline";
import { MobileDock } from "./mobile-dock";

export function DossierPage({ id }: { id: string }) {
  const drones = useDrones();
  const procurements = useProcurements();
  const svc = useServices();
  const attached = useAttached();
  const d = drones.find((x) => x.id === id);
  const relatedIntel = useRelatedIntel(id);
  // Counterparts read through the one reader of relations, typed and legacy alike.
  const counterparts = useMemo(
    () =>
      d
        ? resolveRelations(d, drones)
            .filter((e) => e.kind === "counterpart_to")
            .map((e) => e.target)
        : [],
    [d, drones],
  );
  // The payload and sensor panels read the observations and the figures: a report's list of
  // what a system carries, and the specs that measure it.
  const payloadFacts = d ? payloadSpecs(d) : [];
  const sensorFacts = d ? sensorSpecs(d) : [];
  const contracts = d ? contractsForDrone(procurements, d) : [];

  if (!d)
    return attached ? (
      <p className="text-muted-foreground">
        System not found.{" "}
        <Link to="/catalog" className="text-primary">
          Back to catalog
        </Link>
      </p>
    ) : (
      // The repositories fill asynchronously after SSR; "not found" is only a verdict once the
      // store has actually been read.
      <Loading label="Loading system…" />
    );
  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap gap-2">
          <Tag tone="primary">{d.domain}</Tag>
          <OriginControl drone={d} />
          {d.manufacturer && <Tag tone="accent">{d.manufacturer}</Tag>}
          {d.organizationLinks?.map((link) => (
            <Tag
              key={`${link.organizationId}-${link.role}`}
              tone="accent"
              caps={false}
              mono={false}
            >
              {link.role}: {link.name}
              {link.country ? ` (${link.country})` : ""}
            </Tag>
          ))}
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
        <div className="mt-1">
          <FamilyBreadcrumb drone={d} catalog={drones} />
        </div>
        <div className="mt-4">
          <KeyFigures drone={d} />
        </div>
        <DossierSummary drone={d} svc={svc} />
        {d.reference && (
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            <span data-testid="reference-link">
              <ExternalSourceLink href={d.reference.url}>
                {d.reference.url.includes("wikipedia.org") ? "Wikipedia, CC BY-SA 4.0" : "Wikidata"}
              </ExternalSourceLink>
            </span>
          </p>
        )}
      </div>
      <SectionNav label="Dossier sections" sections={DOSSIER_SECTIONS} />
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Panel id="specs" title="Consensus specifications" className="lg:col-span-2 scroll-mt-28">
          <SpecTable drone={d} />
          <AddSpecForm droneId={d.id} droneName={d.name} specs={d.specs} />
        </Panel>
        <AliasRegistry drone={d} catalog={drones} />
        <Panel id="related" title="Related Intelligence" className="scroll-mt-28">
          <RelatedRail edges={relatedIntel?.edges ?? []} maxItems={10} />
        </Panel>
        <RfPanel drone={d} />
        <SupplyPanel drone={d} />
        <ContractsPanel drone={d} contracts={contracts} drones={drones} />
        <ActivityPanel activity={d.activity} />
        <PayloadsPanel drone={d} payloadFacts={payloadFacts} />
        <SensorsPanel drone={d} sensorFacts={sensorFacts} />
        <SystemRelationsPanel drone={d} catalog={drones} />
        <CounterpartsPanel drone={d} counterparts={counterparts} />
      </div>
      <EvolutionTimeline drone={d} />
      <ClaimTimeline drone={d} />
      <div className="h-14 sm:hidden" />
      <MobileDock drone={d} counterparts={counterparts} />
    </div>
  );
}
