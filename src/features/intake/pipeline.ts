import type {
  Candidate,
  Drone,
  Extraction,
  SpecAttribute,
  SystemExtraction,
} from "@/entities/drone/types";
import type { IntelExtractor } from "@/shared/contracts/ai";
import type { CandidateRepository, DroneRepository } from "@/shared/contracts/repository";
import type { TaxonomyCandidateRepository } from "@/shared/contracts/taxonomy";
import type { Procurement } from "@/entities/procurement/types";
import { mergeLinks, normalizeExtraction, toRFLink } from "@/entities/normalization/apply";
import { attributeSemantic, mergeSpecs } from "@/features/dynamic-specs/spec-engine";
import { counterpartIdsFor, linkCounterparts } from "@/entities/drone/relations";
import { chatCompletionOnce } from "@/shared/infra/ai-proxy.server";
import { combineExtractions, needsDeepAI, needsFastAI } from "./extraction-gates";
import { linkVariant, mergeDroneIntelligence } from "@/entities/drone/merge-intelligence";
import { ProcurementExtractionSchema } from "@/shared/contracts/extraction.schema";

export interface PipelineDeps {
  tier1: IntelExtractor;
  tier2: IntelExtractor;
  /** Local heuristic engine used when an AI tier throws (provider outage), so ingestion never hard-fails. */
  fallback?: IntelExtractor;
  /** Mandatory deterministic first pass in production. */
  heuristic?: IntelExtractor;
  heuristicFirst?: boolean;
  /** Analyst override: spend tier-2 budget even when automatic gates are satisfied. */
  forceDeepAnalysis?: boolean;
  drones: DroneRepository;
  candidates: CandidateRepository;
  /** When set, unknown propulsion terms are queued for an analyst. Absent in tests and older callers. */
  taxonomyCandidates?: TaxonomyCandidateRepository;
  escalationThreshold: number;
  autoMergeThreshold: number;
  /** Unset disables auto-promotion; every new system then waits for review. */
  autoPromoteThreshold?: number;
  /** Unset disables auto-discard. */
  autoDiscardThreshold?: number;
}

export interface AnalysisContext {
  dispatchId?: string;
  url?: string;
  publishedAt?: string;
}

type PipelinePrimaryResult =
  | { kind: "auto-merged"; droneId: string; candidate: Candidate }
  | { kind: "auto-promoted"; droneId: string; candidate: Candidate }
  | { kind: "auto-discarded"; candidate: Candidate }
  | { kind: "queued"; candidate: Candidate };

export type PipelineResult = PipelinePrimaryResult & {
  relatedCandidates?: Candidate[];
  droneIds?: string[];
};

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Collision keys strip punctuation and spacing, not just case: to a source document
 * "Shahed-136" and "Shahed 136" are the same system, and auto-promotion must not create a
 * duplicate catalog entry just because the source hyphenated differently than the catalog did.
 */
const collisionKey = (s: string) => norm(s).replace(/[\s\-_./]+/g, "");

/** Mark an extraction with why it came from a degraded tier, visible to the analyst in triage. */
function annotate(extraction: Extraction, note: string): Extraction {
  return extraction.rationale
    ? { ...extraction, rationale: `${extraction.rationale} · ${note}` }
    : { ...extraction, rationale: note };
}

/** A parser bug must not burn a dispatch attempt. The raw extraction is kept when normalization throws. */
function applyNormalization(extraction: Extraction): ReturnType<typeof normalizeExtraction> {
  try {
    return normalizeExtraction(extraction);
  } catch (err) {
    console.error("[normalize]", err);
    return { extraction, unknowns: [] };
  }
}

function withNormalizedRf(drone: Drone, extraction: Extraction): Drone {
  const links = (extraction.rf ?? []).map(toRFLink);
  if (!links.length) return drone;
  return { ...drone, rf: mergeLinks(drone.rf, links) };
}

/** True when any of the extraction's names is already a catalog name or alias. */
function collidesWithCatalog(e: Extraction, catalog: Drone[]): boolean {
  const known = new Set<string>();
  for (const d of catalog) {
    if (d.name) known.add(collisionKey(d.name));
    if (d.cyrillic) known.add(collisionKey(d.cyrillic));
    for (const a of d.aliases) known.add(collisionKey(a));
  }
  return [e.name ?? "", ...e.aliases].some((n) => n.trim() && known.has(collisionKey(n)));
}

function extractionForSystem(parent: Extraction, s: SystemExtraction): Extraction {
  return {
    name: s.name,
    aliases: s.aliases ?? [],
    ...(s.domain ? { domain: s.domain } : {}),
    ...(s.origin ? { origin: s.origin } : {}),
    ...(s.manufacturer ? { manufacturer: s.manufacturer } : {}),
    operators: s.operators ?? [],
    ...(s.propulsion ? { propulsion: s.propulsion } : {}),
    ...(s.installation ? { installation: s.installation } : {}),
    specs: s.specs,
    rfBands: s.rfBands,
    systems: [
      {
        name: s.name,
        ...(s.matchId ? { matchId: s.matchId } : {}),
        ...(s.variantOf ? { variantOf: s.variantOf } : {}),
      },
    ],
    components: s.components ?? [],
    payloads: s.payloads ?? [],
    sensors: s.sensors ?? [],
    guidance: s.guidance ?? [],
    ...(s.matchId ? { matchId: s.matchId } : {}),
    confidence: s.confidence,
    rationale: s.rationale ?? parent.rationale,
    ...(parent.metadata ? { metadata: parent.metadata } : {}),
  };
}

function applyRelatedSystems(
  primary: PipelinePrimaryResult,
  all: Extraction,
  source: string,
  d: PipelineDeps,
  context: AnalysisContext,
): PipelineResult {
  const slices = all.systemExtractions ?? [];
  if (slices.length < 2) return primary;
  const primaryName = primary.candidate.extraction.name?.toLowerCase();
  const primaryMatch = primary.candidate.extraction.matchId;
  const relatedCandidates: Candidate[] = [];
  const droneIds = new Set<string>(
    primary.kind === "auto-merged" || primary.kind === "auto-promoted" ? [primary.droneId] : [],
  );

  for (const slice of slices) {
    if (
      (primaryMatch && slice.matchId === primaryMatch) ||
      (!primaryMatch && primaryName && slice.name.toLowerCase() === primaryName)
    )
      continue;
    const extraction = applyNormalization(extractionForSystem(all, slice)).extraction;
    const candidate: Candidate = {
      id: crypto.randomUUID(),
      raw: primary.candidate.raw,
      source,
      createdAt: new Date().toISOString(),
      tier: primary.candidate.tier,
      extraction,
      status: "pending",
    };
    if (extraction.matchId && extraction.confidence >= d.autoMergeThreshold) {
      const target = d.drones.get(extraction.matchId);
      if (target) {
        const merged = mergeDroneIntelligence(
          withNormalizedRf(
            mergeSpecs(target, extraction.specs, source, {
              ...(context.dispatchId ? { sourceId: context.dispatchId } : {}),
              extractionConfidence: extraction.confidence,
            }),
            extraction,
          ),
          extraction,
          context.dispatchId,
        );
        d.drones.upsert(merged);
        if (slice.variantOf) {
          const parent = d.drones.get(slice.variantOf);
          if (parent) for (const linked of linkVariant(parent, merged)) d.drones.upsert(linked);
        }
        candidate.status = "merged";
        candidate.resolvedInto = target.id;
        candidate.resolvedBy = "auto";
        droneIds.add(target.id);
      }
    } else if (
      d.autoPromoteThreshold !== undefined &&
      extraction.name &&
      extraction.confidence >= d.autoPromoteThreshold &&
      !collidesWithCatalog(extraction, d.drones.list())
    ) {
      d.candidates.add(candidate);
      const promoted = promote(candidate, d);
      candidate.status = "promoted";
      candidate.resolvedInto = promoted.id;
      candidate.resolvedBy = "auto";
      droneIds.add(promoted.id);
      relatedCandidates.push(candidate);
      continue;
    }
    d.candidates.add(candidate);
    relatedCandidates.push(candidate);
  }
  return {
    ...primary,
    ...(relatedCandidates.length ? { relatedCandidates } : {}),
    ...(droneIds.size ? { droneIds: [...droneIds] } : {}),
  };
}

export async function runTwoTier(
  raw: string,
  source: string,
  d: PipelineDeps,
  context: AnalysisContext = {},
): Promise<PipelineResult> {
  const catalog = d.drones.list();
  let tier: 1 | 2 = 1;
  let extraction: Extraction | undefined;
  const heuristic = d.heuristicFirst !== false ? (d.heuristic ?? d.fallback) : undefined;
  if (heuristic) extraction = await heuristic.extract(raw, catalog);

  const fastGate = extraction
    ? needsFastAI(extraction, d.escalationThreshold)
    : { needed: true, reasons: ["heuristic-disabled"] };
  const tier1IsHeuristic = heuristic && d.tier1.label === heuristic.label;
  if (fastGate.needed && !tier1IsHeuristic) {
    try {
      const refined = await d.tier1.extract(raw, catalog, extraction);
      extraction = extraction ? combineExtractions(extraction, refined) : refined;
      if (extraction.metadata) extraction.metadata.escalationReasons = fastGate.reasons;
    } catch (err) {
      if (!extraction) {
        if (!d.fallback) throw err;
        extraction = annotate(
          await d.fallback.extract(raw, catalog),
          "tier-1 AI unavailable — heuristic",
        );
      } else {
        extraction = annotate(extraction, "tier-1 AI unavailable — kept heuristic");
      }
      console.error(
        "[pipeline] tier-1 call failed, using deterministic result",
        (err as Error).message,
      );
    }
  }
  if (!extraction) {
    extraction = await d.tier1.extract(raw, catalog);
  }
  if (!extraction) throw new Error("Extraction engine returned no result");

  const deepGate = d.forceDeepAnalysis
    ? { needed: true, reasons: ["analyst-requested-deep-analysis"] }
    : needsDeepAI(extraction, d.escalationThreshold);
  const tier2IsSameHeuristic = heuristic && d.tier2.label === heuristic.label;
  if (deepGate.needed && !tier2IsSameHeuristic) {
    tier = 2;
    try {
      extraction = combineExtractions(extraction, await d.tier2.extract(raw, catalog, extraction));
      if (extraction.metadata) {
        extraction.metadata.escalationReasons = [
          ...(extraction.metadata.escalationReasons ?? []),
          ...deepGate.reasons,
        ];
      }
    } catch (err) {
      tier = 1;
      console.error("[pipeline] tier-2 call failed, keeping tier-1 result", (err as Error).message);
      extraction = annotate(extraction, "tier-2 AI unavailable — kept tier 1");
    }
  }
  const fullExtraction: Extraction = extraction;
  if ((fullExtraction.systemExtractions?.length ?? 0) > 1) {
    const primary =
      fullExtraction.systemExtractions?.find((s) => s.matchId === fullExtraction.matchId) ??
      fullExtraction.systemExtractions?.find((s) => s.name === fullExtraction.name) ??
      fullExtraction.systemExtractions?.[0];
    if (primary) extraction = extractionForSystem(fullExtraction, primary);
  }
  const normalized = applyNormalization(extraction);
  extraction = normalized.extraction;
  for (const unknown of normalized.unknowns) {
    d.taxonomyCandidates?.record(unknown.rawTerm, unknown.taxonomy, { source });
  }
  // An auto-merge must never crash the dispatch. The extractor matched against a catalog
  // snapshot; the target can since have been merged away by a concurrent analyst run (or the
  // id was hallucinated). Clear the stale match and let the promote/queue/discard gates decide
  // below — throwing here would burn the dispatch's retry budget for a transient state.
  if (extraction.matchId && !d.drones.get(extraction.matchId)) {
    const { matchId: stale, ...rest } = extraction;
    void stale;
    extraction = rest;
  }
  const candidate: Candidate = {
    id: crypto.randomUUID(),
    raw,
    source,
    createdAt: new Date().toISOString(),
    tier,
    extraction,
    status: "pending",
  };
  if (extraction.matchId && extraction.confidence >= d.autoMergeThreshold) {
    // The guard above (re-checked synchronously, no awaits since) guarantees this exists.
    const target = d.drones.get(extraction.matchId)!;
    const withSpecs = mergeSpecs(target, extraction.specs, source, {
      ...(context.dispatchId ? { sourceId: context.dispatchId } : {}),
      extractionConfidence: extraction.confidence,
      ...(extraction.metadata?.engine ? { extractionEngine: extraction.metadata.engine } : {}),
      ...(extraction.metadata?.model ? { model: extraction.metadata.model } : {}),
    });
    const merged = mergeDroneIntelligence(
      withNormalizedRf(withSpecs, extraction),
      extraction,
      context.dispatchId,
    );
    d.drones.upsert(merged);
    const variantOf = extraction.systems?.find(
      (s) => s.matchId === target.id || s.name.toLowerCase() === target.name.toLowerCase(),
    )?.variantOf;
    if (variantOf) {
      const parent = d.drones.get(variantOf);
      if (parent) for (const linked of linkVariant(parent, merged)) d.drones.upsert(linked);
    }
    // The extraction already reports systems[] and variantOf; persist those as catalog
    // relations so counterpart links come from ingest instead of being hand-maintained.
    for (const changed of linkCounterparts(
      merged,
      counterpartIdsFor(extraction, catalog, target.id),
      catalog,
    )) {
      d.drones.upsert(changed);
    }
    candidate.status = "merged";
    candidate.resolvedInto = target.id;
    candidate.resolvedBy = "auto";
    d.candidates.add(candidate);
    return applyRelatedSystems(
      { kind: "auto-merged", droneId: target.id, candidate },
      fullExtraction,
      source,
      d,
      context,
    );
  }
  // A name colliding with the catalog means the model missed a match; promoting it would
  // create a duplicate, so it goes to review instead.
  if (
    d.autoPromoteThreshold !== undefined &&
    !extraction.matchId &&
    extraction.name?.trim() &&
    extraction.confidence >= d.autoPromoteThreshold &&
    !collidesWithCatalog(extraction, catalog)
  ) {
    d.candidates.add(candidate);
    const drone = promote(candidate, d);
    d.candidates.update(candidate.id, { resolvedBy: "auto" });
    return applyRelatedSystems(
      {
        kind: "auto-promoted",
        droneId: drone.id,
        candidate: { ...candidate, status: "promoted", resolvedInto: drone.id, resolvedBy: "auto" },
      },
      fullExtraction,
      source,
      d,
      context,
    );
  }
  if (d.autoDiscardThreshold !== undefined && extraction.confidence < d.autoDiscardThreshold) {
    candidate.status = "discarded";
    candidate.resolvedBy = "auto";
    d.candidates.add(candidate);
    return applyRelatedSystems(
      { kind: "auto-discarded", candidate },
      fullExtraction,
      source,
      d,
      context,
    );
  }
  d.candidates.add(candidate);
  return applyRelatedSystems({ kind: "queued", candidate }, fullExtraction, source, d, context);
}

export function promote(
  c: Candidate,
  d: Pick<PipelineDeps, "drones" | "candidates">,
  nameOverride?: string,
): Drone {
  const e = applyNormalization(c.extraction).extraction;
  const name =
    nameOverride?.trim() ||
    e.name ||
    `Uncataloged ${e.domain ?? "system"} ${c.id.slice(0, 4).toUpperCase()}`;
  const now = new Date().toISOString();
  const base: Drone = {
    id:
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") +
      "-" +
      c.id.slice(0, 4),
    name,
    aliases: e.aliases,
    domain: e.domain ?? "Multi",
    origin: e.origin ?? "??",
    ...(e.manufacturer ? { manufacturer: e.manufacturer } : {}),
    operators: e.operators,
    propulsion: e.propulsion ?? "Unknown",
    ...(e.propulsionId ? { propulsionId: e.propulsionId } : {}),
    ...(e.installation?.trim() ? { installation: e.installation.trim() } : {}),
    ...(e.installationId ? { installationId: e.installationId } : {}),
    summary: c.raw.slice(0, 200),
    specs: [],
    rf: (e.rf ?? []).map(toRFLink),
    components: e.components ?? [],
    ...(e.payloads?.length ? { payloads: e.payloads } : {}),
    ...(e.sensors?.length ? { sensors: e.sensors } : {}),
    evolution: [
      { date: now, kind: "other", description: "Promoted from intake queue", source: c.source },
    ],
    counterpartIds: [],
    createdAt: now,
    updatedAt: now,
  };
  const drone = mergeSpecs(base, e.specs, c.source);
  d.drones.upsert(drone);
  // A promoted system often arrives alongside ones already catalogued ("Shahed-136 seen
  // with Geran-2"), so seed its relations from the same systems[] the auto-merge path uses.
  const catalog = d.drones.list();
  const changed = linkCounterparts(drone, counterpartIdsFor(e, catalog, drone.id), catalog);
  for (const c2 of changed) d.drones.upsert(c2);
  const variantOf = e.systems?.find((s) => s.name.toLowerCase() === name.toLowerCase())?.variantOf;
  if (variantOf) {
    const parent = d.drones.get(variantOf);
    const child = d.drones.get(drone.id);
    if (parent && child) {
      for (const linked of linkVariant(parent, child)) d.drones.upsert(linked);
    }
  }
  d.candidates.update(c.id, { status: "promoted", resolvedInto: drone.id });
  // Return the linked version so callers don't hold a stale copy without counterpartIds.
  return changed.find((x) => x.id === drone.id) ?? drone;
}

export function mergeDrones(
  keepId: string,
  mergeId: string,
  d: Pick<PipelineDeps, "drones" | "candidates">,
  reason?: string,
): Drone | undefined {
  if (keepId === mergeId) return undefined;
  const keep = d.drones.get(keepId);
  const merge = d.drones.get(mergeId);
  if (!keep || !merge) return undefined;

  // 1. Merge metadata & descriptive fields
  const name =
    keep.name.startsWith("Uncataloged") && !merge.name.startsWith("Uncataloged")
      ? merge.name
      : keep.name;
  const cyrillic = keep.cyrillic || merge.cyrillic;
  const aliases = [
    ...new Set([...keep.aliases, ...merge.aliases, ...(merge.name !== name ? [merge.name] : [])]),
  ].filter((a) => a.toLowerCase() !== name.toLowerCase());
  const domain = keep.domain && keep.domain !== "Multi" ? keep.domain : merge.domain || "Multi";
  const origin = keep.origin && keep.origin !== "??" ? keep.origin : merge.origin || "??";
  const manufacturer = keep.manufacturer || merge.manufacturer;
  const operators = [...new Set([...keep.operators, ...merge.operators])];
  const propulsion =
    keep.propulsion && keep.propulsion !== "Unknown"
      ? keep.propulsion
      : merge.propulsion || "Unknown";
  const summary =
    (keep.summary?.length ?? 0) >= (merge.summary?.length ?? 0) ? keep.summary : merge.summary;

  // 2. Merge specs preserving all claims and provenance
  const specsMap = new Map<string, SpecAttribute>();
  for (const s of keep.specs) {
    specsMap.set(attributeSemantic(s), { ...s, claims: [...s.claims] });
  }
  for (const s of merge.specs) {
    const existing = specsMap.get(attributeSemantic(s));
    if (existing) {
      for (const claim of s.claims) {
        const isDuplicate = existing.claims.some(
          (c) => String(c.value) === String(claim.value) && c.source === claim.source,
        );
        if (!isDuplicate) {
          existing.claims.push(claim);
        }
      }
    } else {
      specsMap.set(attributeSemantic(s), {
        ...s,
        semantic: attributeSemantic(s),
        claims: [...s.claims],
      });
    }
  }

  // 3. Merge RF links
  const rf = mergeLinks(keep.rf, merge.rf);

  // 4. Merge supply components
  const components = [...keep.components];
  for (const comp of merge.components) {
    const exists = components.some(
      (c) =>
        c.part.toLowerCase() === comp.part.toLowerCase() &&
        c.manufacturer.toLowerCase() === comp.manufacturer.toLowerCase(),
    );
    if (!exists) components.push(comp);
  }

  // 5. Merge evolution history (sorted by date)
  const mergeEvolution = merge.evolution.map((e) => ({
    ...e,
    description: e.description.includes(merge.name)
      ? e.description
      : `[${merge.name}] ${e.description}`,
  }));
  const evolution = [
    ...keep.evolution,
    {
      date: new Date().toISOString(),
      kind: "other" as const,
      description:
        reason || `Merged duplicate system '${merge.name}' (${mergeId}) into '${name}' (${keepId})`,
      source: "catalog-merge",
    },
    ...mergeEvolution,
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // 6. Merge counterpart IDs (cleaning up references to self and merged id)
  const counterpartIds = [...new Set([...keep.counterpartIds, ...merge.counterpartIds])].filter(
    (id) => id !== keepId && id !== mergeId,
  );

  const createdAt =
    keep.createdAt && merge.createdAt
      ? new Date(keep.createdAt) < new Date(merge.createdAt)
        ? keep.createdAt
        : merge.createdAt
      : keep.createdAt || merge.createdAt || new Date().toISOString();

  const result: Drone = {
    id: keepId,
    name,
    ...(cyrillic ? { cyrillic } : {}),
    aliases,
    domain,
    origin,
    ...(manufacturer ? { manufacturer } : {}),
    operators,
    propulsion,
    ...(keep.propulsionId || merge.propulsionId
      ? { propulsionId: keep.propulsionId ?? merge.propulsionId }
      : {}),
    ...(keep.installation || merge.installation
      ? { installation: keep.installation ?? merge.installation }
      : {}),
    ...(keep.installationId || merge.installationId
      ? { installationId: keep.installationId ?? merge.installationId }
      : {}),
    summary,
    specs: Array.from(specsMap.values()),
    rf,
    components,
    payloads: [
      ...(keep.payloads ?? []),
      ...(merge.payloads ?? []).filter(
        (p) => !(keep.payloads ?? []).some((x) => x.name === p.name && x.weightKg === p.weightKg),
      ),
    ],
    sensors: [
      ...(keep.sensors ?? []),
      ...(merge.sensors ?? []).filter(
        (s) => !(keep.sensors ?? []).some((x) => x.name === s.name && x.model === s.model),
      ),
    ],
    evolution,
    counterpartIds,
    ...(keep.variantOfId || merge.variantOfId
      ? { variantOfId: keep.variantOfId ?? merge.variantOfId }
      : {}),
    variantIds: [...new Set([...(keep.variantIds ?? []), ...(merge.variantIds ?? [])])].filter(
      (id) => id !== keepId && id !== mergeId,
    ),
    ...(keep.reference || merge.reference ? { reference: keep.reference ?? merge.reference } : {}),
    createdAt,
    updatedAt: new Date().toISOString(),
  };

  // Upsert merged target
  d.drones.upsert(result);

  // 7. Update counterpart links on other drones pointing to mergeId
  for (const other of d.drones.list()) {
    if (other.id === keepId || other.id === mergeId) continue;
    if (
      other.counterpartIds.includes(mergeId) ||
      other.variantOfId === mergeId ||
      other.variantIds?.includes(mergeId)
    ) {
      const updated = [
        ...new Set(
          other.counterpartIds
            .map((cId) => (cId === mergeId ? keepId : cId))
            .filter((cId) => cId !== other.id),
        ),
      ];
      d.drones.upsert({
        ...other,
        counterpartIds: updated,
        ...(other.variantOfId === mergeId ? { variantOfId: keepId } : {}),
        ...(other.variantIds
          ? {
              variantIds: [
                ...new Set(other.variantIds.map((id) => (id === mergeId ? keepId : id))),
              ],
            }
          : {}),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  // 8. Update candidates resolved into mergeId
  if (d.candidates) {
    for (const c of d.candidates.list()) {
      if (c.resolvedInto === mergeId) {
        d.candidates.update(c.id, { resolvedInto: keepId });
      }
    }
  }

  // 9. Remove merged drone
  d.drones.remove?.(mergeId);

  return result;
}

export function mergeInto(
  c: Candidate,
  droneId: string,
  d: Pick<PipelineDeps, "drones" | "candidates">,
) {
  const target = d.drones.get(droneId);
  if (!target) return;
  const extracted = applyNormalization(c.extraction).extraction;
  const merged = mergeDroneIntelligence(
    withNormalizedRf(
      mergeSpecs(target, extracted.specs, c.source, { extractionConfidence: extracted.confidence }),
      extracted,
    ),
    extracted,
  );
  merged.evolution = [
    ...merged.evolution,
    {
      date: new Date().toISOString(),
      kind: "other",
      description: `Merged intake: ${c.extraction.rationale}`,
      source: c.source,
    },
  ];
  d.drones.upsert(merged);
  d.candidates.update(c.id, { status: "merged", resolvedInto: droneId });
}

const PROCURE_SYS = `You are a defense procurement analyst. Extract contract and grant information from the report.
Reply in json with keys: company (string), country (ISO2), amount (string|null), currency (string|null),
program (string|null), product (string|null), customer (string|null), announcedAt (string|null), notes (string|null).
Only report information that appears in the text. If no procurement info is found, return null for all fields.`;

export async function extractProcurement(
  raw: string,
  source: string,
  cfg: { baseUrl: string; apiKey: string; model: string },
): Promise<Procurement | null> {
  const r = await chatCompletionOnce({
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.model,
    system: PROCURE_SYS,
    prompt: raw,
    json: true,
  });
  if (!r.ok) return null;
  try {
    const parsed = ProcurementExtractionSchema.safeParse(
      JSON.parse(r.content.replace(/^```json|```$/g, "").trim()),
    );
    if (!parsed.success) return null;
    const j = parsed.data;
    return {
      id: crypto.randomUUID(),
      company: j.company,
      country: j.country,
      ...(j.amount ? { amount: j.amount } : {}),
      ...(j.currency ? { currency: j.currency } : {}),
      ...(j.program ? { program: j.program } : {}),
      ...(j.product ? { product: j.product } : {}),
      ...(j.customer ? { customer: j.customer } : {}),
      ...(j.announcedAt ? { announcedAt: j.announcedAt } : {}),
      source,
      ...(j.notes ? { notes: j.notes } : {}),
      createdAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
