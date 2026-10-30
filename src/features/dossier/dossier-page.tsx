import { Link, useNavigate } from "@tanstack/react-router";
import { ExternalSourceLink, SourceRef, withUnit } from "@/shared/ui/links";
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { consensus } from "@/entities/drone/consensus";
import { groupSpecs } from "@/entities/drone/spec-groups";
import { claimKey } from "@/entities/drone/claim-review";
import { payloadSpecs, sensorSpecs } from "@/entities/drone/observations";
import { contractsForDrone } from "@/entities/procurement/match";
import { ieeeLabel, natoLabel } from "@/entities/normalization/bands";
import { effectiveIeeeBands, effectiveNatoBands, linkIsFiber } from "@/entities/normalization/rf";
import { type Drone, type SpecAttribute } from "@/entities/drone/types";
import { CountryBadge } from "@/shared/ui/country-badge";
import { ClaimChip, ProvenanceSheet, type ClaimSelection } from "./provenance-sheet";
import { AddSpecForm } from "./add-spec-form";
import { AliasRegistry } from "./alias-registry";
import { useDrones, useServices } from "@/shared/infra/services";
import { useProcurements } from "@/shared/infra/use-procurements";
import { translateText, generateSystemSummary } from "@/shared/infra/ai-proxy.functions";
import { buildSystemEvidenceDigest } from "@/shared/infra/system-evidence-digest";
import { Btn, ConfidenceTag, Loading, Panel, Tag, EmptyNote } from "@/shared/ui/primitives";
import { DataTable, type Column } from "@/shared/ui/data-table";
import { SectionNav } from "@/shared/ui/section-nav";
import { KeyFigures } from "./key-figures";
import { SummaryText } from "@/shared/ui/summary-text";
import { ContractRow } from "@/shared/ui/contracts";
import { useRelatedIntel, RelatedRail } from "@/shared/ui/intel-graph";

const DOSSIER_SECTIONS = [
  { id: "specs", label: "Specifications" },
  { id: "aliases", label: "Aliases" },
  { id: "related", label: "Related intel" },
  { id: "rf", label: "RF spectrum" },
  { id: "supply", label: "Supply chain" },
  { id: "contracts", label: "Procurement" },
  { id: "payloads", label: "Payloads" },
  { id: "sensors", label: "Sensors" },
  { id: "variants", label: "Variants" },
  { id: "counterparts", label: "Counterparts" },
  { id: "timeline", label: "Timeline" },
  { id: "claims", label: "Claim timeline" },
] as const;

/** "min–max" when the claims disagree on the figure, else empty. */
function spread(c: ReturnType<typeof consensus>): string {
  return c.min !== undefined && c.max !== undefined && c.min !== c.max ? `${c.min}–${c.max}` : "";
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

/**
 * Delete a wrongly catalogued entry. Two steps: the first click shows what else the removal
 * touches, the second does it. See CatalogMutations.remove for what is cleaned up.
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
  const impact = svc.catalog.removalImpact(drone.id);
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
          svc.catalog.remove(drone.id);
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

/**
 * The structured AI dossier brief: the model's markdown overview plus the verified/caveat lists,
 * each labelled. Used both while a translation is still pending and as the steady-state brief,
 * so the two phases never disagree about the format.
 */
function SystemBrief({ brief }: { brief: NonNullable<Drone["llmBrief"]> }) {
  return (
    <div className="max-w-3xl space-y-3 text-sm leading-relaxed text-foreground/90">
      <SummaryText text={brief.overview} />
      {brief.verified.length ? (
        <section>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Verified facts
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {brief.verified.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {brief.caveats.length ? (
        <section>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Caveats and uncertainty
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {brief.caveats.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {brief.provenance.length ? (
        <section>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Sources and provenance
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {brief.provenance.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {brief.nextChecks.length ? (
        <section>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Suggested next checks
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {brief.nextChecks.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function DossierSummary({ drone, svc }: { drone: Drone; svc: ReturnType<typeof useServices> }) {
  const translateFn = useServerFn(translateText);
  const generateFn = useServerFn(generateSystemSummary);
  const generatedSummary = drone.llmSummary;
  const sourceSummary = drone.summary;
  const summary = generatedSummary ?? sourceSummary;
  const storageSummary = drone.summaryEnglish;
  const likelyEnglish = Boolean(generatedSummary);
  const [translated, setTranslated] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [briefGenerating, setBriefGenerating] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  const briefAttempted = useRef<string | null>(null);
  const briefFingerprint = buildSystemEvidenceDigest(drone).fingerprint;
  const briefStale =
    !drone.llmSummaryGeneratedAt ||
    Date.now() - Date.parse(drone.llmSummaryGeneratedAt) > 7 * 24 * 60 * 60 * 1000;
  // A brief whose overview is a fenced or raw JSON blob is the earlier parser's failure, not a
  // brief; detecting it makes opening the card regenerate through the fixed parser at once.
  const briefIsBlob =
    !!drone.llmBrief &&
    !drone.llmBrief.verified.length &&
    /^\s*(```|\{|\[)/.test(drone.llmBrief.overview);
  const briefNeedsWork =
    !generatedSummary ||
    drone.llmSummaryFingerprint !== briefFingerprint ||
    briefStale ||
    briefIsBlob;

  useEffect(() => {
    // A generated brief is English and is the steady-state content; translating the scrape
    // summary around it would make the panel rewrite itself twice on open.
    if (drone.llmBrief) {
      setTranslated(null);
      setError(null);
      setTranslating(false);
      return;
    }
    if (storageSummary) {
      setTranslated(generatedSummary ? null : storageSummary);
      setError(null);
      setTranslating(false);
      return;
    }
    if (likelyEnglish || generatedSummary) {
      setTranslated(null);
      setError(null);
      setTranslating(false);
      return;
    }
    let cancelled = false;
    setTranslating(true);
    setError(null);
    void translateFn({ data: { text: sourceSummary, model: svc.settings.translateModel } })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setTranslated(res.translated);
          try {
            svc.drones.upsert({ ...drone, summaryEnglish: res.translated }, (fresh) => ({
              ...fresh,
              summaryEnglish: res.translated,
            }));
          } catch (err) {
            console.warn("[dossier] could not persist translated summary", err);
          }
        } else setError(res.error);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Translation failed");
      })
      .finally(() => {
        if (!cancelled) setTranslating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    drone,
    generatedSummary,
    likelyEnglish,
    sourceSummary,
    storageSummary,
    svc,
    svc.settings.translateModel,
    translateFn,
  ]);

  const runBriefGeneration = useCallback(
    async (force = false) => {
      if (!svc.aiConfigured) {
        setBriefError("Configure an AI model in settings to generate a system brief.");
        return;
      }
      if (!force && !briefNeedsWork) return;
      setBriefGenerating(true);
      setBriefError(null);
      try {
        const result = await generateFn({ data: { drone } });
        if (!result.ok) {
          setBriefError(result.error);
          return;
        }
        const generatedAt = new Date().toISOString();
        const brief = {
          llmSummary: result.summary,
          llmBrief: result.brief,
          llmSummaryGeneratedAt: generatedAt,
          llmSummaryFingerprint: briefFingerprint,
        };
        svc.drones.upsert({ ...drone, ...brief }, (fresh) => ({ ...fresh, ...brief }));
      } catch (err) {
        setBriefError(err instanceof Error ? err.message : "AI brief failed");
      } finally {
        setBriefGenerating(false);
      }
    },
    [briefNeedsWork, briefFingerprint, drone, svc, generateFn],
  );

  useEffect(() => {
    if (!svc.aiConfigured) return;
    if (!briefNeedsWork) return;
    const generationKey = `${drone.id}:${briefFingerprint}:${drone.llmSummaryGeneratedAt ?? "never"}`;
    if (briefAttempted.current === generationKey) return;
    briefAttempted.current = generationKey;
    void runBriefGeneration(false);
  }, [
    briefFingerprint,
    briefNeedsWork,
    drone.id,
    drone.llmSummaryGeneratedAt,
    svc.aiConfigured,
    runBriefGeneration,
  ]);

  // A landed AI brief outranks a pending translation at any render, not only once the
  // translation effect has caught up.
  if (translated && !drone.llmBrief) {
    return (
      <div className="space-y-2">
        <p className="max-w-3xl text-base leading-relaxed">{translated}</p>
        <details className="font-mono text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            Original ({likelyEnglish ? "English" : "source language"})
          </summary>
          <p className="mt-1 max-w-3xl leading-relaxed text-muted-foreground">{summary}</p>
        </details>
      </div>
    );
  }

  if (!likelyEnglish && translating) {
    return (
      <div className="space-y-2">
        <p className="max-w-3xl animate-pulse font-mono text-sm text-muted-foreground">
          Translating summary...
        </p>
        {drone.llmBrief ? <SystemBrief brief={drone.llmBrief} /> : <SummaryText text={summary} />}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {drone.llmBrief ? <SystemBrief brief={drone.llmBrief} /> : <SummaryText text={summary} />}
      {briefGenerating && (
        <p className="font-mono text-xs text-muted-foreground">
          Generating intelligence summary...
        </p>
      )}
      {!briefGenerating && (
        <div className="flex flex-wrap gap-2 pt-1">
          <Btn
            variant="ghost"
            onClick={() => void runBriefGeneration(true)}
            disabled={briefGenerating}
          >
            {generatedSummary ? "Regenerate AI brief" : "Generate AI brief"}
          </Btn>
        </div>
      )}
      {briefError && <p className="font-mono text-xs text-destructive">{briefError}</p>}
    </div>
  );
}

export function DossierPage({ id }: { id: string }) {
  const drones = useDrones();
  const procurements = useProcurements();
  const svc = useServices();
  const d = drones.find((x) => x.id === id);
  const relatedIntel = useRelatedIntel(id);
  const counterparts = d ? drones.filter((x) => d.counterpartIds.includes(x.id)) : [];
  const parent = d?.variantOfId ? drones.find((x) => x.id === d.variantOfId) : undefined;
  const variants = d
    ? drones.filter((x) => d.variantIds?.includes(x.id) || x.variantOfId === d.id)
    : [];
  // The payload and sensor panels read the observations and the figures: a report's list of
  // what a system carries, and the specs that measure it.
  const payloadFacts = d ? payloadSpecs(d) : [];
  const sensorFacts = d ? sensorSpecs(d) : [];
  const contracts = d ? contractsForDrone(procurements, d) : [];

  if (!d)
    return svc.attached ? (
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
          <Tag caps={false} mono={false}>
            Origin <CountryBadge code={d.origin} />
          </Tag>
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
        <Panel id="rf" title="RF spectrum" className="scroll-mt-28">
          {!d.rf.length && <EmptyNote>No RF links recorded.</EmptyNote>}
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
        <Panel
          id="contracts"
          title="Contracts & procurement"
          className="scroll-mt-28"
          right={
            <Link
              to="/procurement"
              search={{ system: d.id }}
              className="font-mono text-xs text-primary hover:underline"
            >
              All contracts →
            </Link>
          }
        >
          {contracts.length ? (
            <ul className="space-y-3">
              {contracts.map((contract) => (
                <li
                  key={contract.id}
                  className="border-b border-border pb-3 last:border-0 last:pb-0"
                >
                  <ContractRow contract={contract} drones={drones} showNotes />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No contract or production-deal records linked to this system yet.
            </p>
          )}
        </Panel>
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
        <Panel id="variants" title="Variant family" className="scroll-mt-28">
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
          {!parent && !variants.length && <EmptyNote>No family relationship recorded.</EmptyNote>}
        </Panel>
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
      </div>
      <Panel id="timeline" title="Spec evolution timeline" className="scroll-mt-28">
        <ol className="relative ml-2 border-l border-border">
          {[...d.evolution]
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((e, i) => (
              <li key={i} className="mb-4 ml-4 min-w-0">
                <span className="absolute -left-1.5 mt-1.5 h-3 w-3 border border-primary bg-background" />
                <p className="font-mono text-xs text-muted-foreground">
                  {e.date.slice(0, 10)} · {e.kind}
                </p>
                <p className="min-w-0 break-words text-sm [overflow-wrap:anywhere]">
                  {e.description}{" "}
                  <span className="font-mono text-xs text-muted-foreground">
                    — <SourceRef source={e.source} className="max-w-[16rem] align-bottom" />
                  </span>
                </p>
              </li>
            ))}
        </ol>
      </Panel>
      <Panel id="claims" title="Spec claim timeline" className="scroll-mt-28">
        <ol className="relative ml-2 border-l border-border">
          {d.specs
            .flatMap((s) => s.claims.map((claim, i) => ({ spec: s, claim, index: i })))
            .sort((a, b) => (b.claim.date ?? "").localeCompare(a.claim.date ?? ""))
            .slice(0, 40)
            .map(({ spec, claim, index }) => (
              <li key={`${spec.key}-${index}`} className="mb-3 ml-4 min-w-0">
                <span className="absolute -left-1.5 mt-1.5 h-2.5 w-2.5 border border-primary bg-background" />
                <p className="font-mono text-xs text-muted-foreground">
                  {(claim.date ?? "").slice(0, 10)} · {spec.label}
                </p>
                <p className="min-w-0 break-words text-sm [overflow-wrap:anywhere]">
                  {withUnit(claim.value, spec.unit)}{" "}
                  <span className="font-mono text-xs text-muted-foreground">
                    —{" "}
                    <SourceRef
                      source={claim.source || claim.model}
                      className="max-w-[16rem] align-bottom"
                    />
                  </span>
                </p>
              </li>
            ))}
          {!d.specs.some((s) => s.claims.length) && <EmptyNote>No dated claims.</EmptyNote>}
        </ol>
      </Panel>
      <div className="h-14 sm:hidden" />
      <nav className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-border bg-background/95 p-2 backdrop-blur sm:hidden">
        {/* Compare would deep-link to an arbitrary fallback system when no counterpart is linked;
            hiding it keeps "Jump to…" and "Posts" as the honest two actions. */}
        {counterparts.length > 0 && (
          <Link
            data-testid="compare-link"
            to="/counterparts"
            search={{ a: d.id, b: counterparts[0]?.id ?? "" }}
            className="flex-1 border border-primary/50 py-2.5 text-center font-mono text-xs uppercase text-primary"
          >
            Compare
          </Link>
        )}
        <Link
          data-testid="source-posts-link"
          to="/dispatches"
          search={{ q: d.name }}
          className="flex-1 border border-border py-2.5 text-center font-mono text-xs uppercase text-muted-foreground"
        >
          Posts
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger
            type="button"
            className="flex-1 border border-border py-2.5 text-center font-mono text-xs uppercase text-muted-foreground hover:text-primary"
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
