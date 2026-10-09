import type { Candidate, Drone, Extraction, SpecAttribute } from "@/entities/drone/types";
import type { IntelExtractor } from "@/shared/contracts/ai";
import type { CandidateRepository, DroneRepository } from "@/shared/contracts/repository";
import type { TaxonomyCandidateRepository } from "@/shared/contracts/taxonomy";
import type { Procurement } from "@/entities/procurement/types";
import { mergeLinks, normalizeExtraction, toRFLink } from "@/entities/normalization/apply";
import { attributeSemantic, mergeSpecs } from "@/features/dynamic-specs/spec-engine";
import { counterpartIdsFor, linkCounterparts } from "@/entities/drone/relations";
import { chatCompletionOnce } from "@/shared/infra/ai-proxy.server";

export interface PipelineDeps {
  tier1: IntelExtractor;
  tier2: IntelExtractor;
  /** Local heuristic engine used when an AI tier throws (provider outage), so ingestion never hard-fails. */
  fallback?: IntelExtractor;
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

export type PipelineResult =
  | { kind: "auto-merged"; droneId: string; candidate: Candidate }
  | { kind: "auto-promoted"; droneId: string; candidate: Candidate }
  | { kind: "auto-discarded"; candidate: Candidate }
  | { kind: "queued"; candidate: Candidate };

const norm = (s: string) => s.trim().toLowerCase();

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
    known.add(norm(d.name));
    if (d.cyrillic) known.add(norm(d.cyrillic));
    for (const a of d.aliases) known.add(norm(a));
  }
  return [e.name ?? "", ...e.aliases].some((n) => n.trim() && known.has(norm(n)));
}

export async function runTwoTier(
  raw: string,
  source: string,
  d: PipelineDeps,
): Promise<PipelineResult> {
  const catalog = d.drones.list();
  let tier: 1 | 2 = 1;
  // A provider outage must not hard-fail ingestion: tier 1 falls back to the built-in
  // heuristic engine, and a failing tier 2 keeps the tier-1 result. Either way the paste
  // still lands in triage, marked as degraded so the analyst can trust it less blindly.
  let extraction: Extraction;
  try {
    extraction = await d.tier1.extract(raw, catalog);
  } catch (err) {
    if (!d.fallback) throw err;
    console.error("[pipeline] tier-1 call failed, using heuristic engine", (err as Error).message);
    extraction = annotate(
      await d.fallback.extract(raw, catalog),
      "tier-1 AI unavailable — heuristic",
    );
  }
  if (extraction.confidence < d.escalationThreshold || !extraction.matchId) {
    tier = 2;
    try {
      extraction = await d.tier2.extract(raw, catalog);
    } catch (err) {
      tier = 1;
      console.error("[pipeline] tier-2 call failed, keeping tier-1 result", (err as Error).message);
      extraction = annotate(extraction, "tier-2 AI unavailable — kept tier 1");
    }
  }
  const normalized = applyNormalization(extraction);
  extraction = normalized.extraction;
  for (const unknown of normalized.unknowns) {
    d.taxonomyCandidates?.record(unknown.rawTerm, unknown.taxonomy, { source });
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
    const target = d.drones.get(extraction.matchId)!;
    const merged = withNormalizedRf(
      mergeSpecs(target, extraction.specs, source, { extractionConfidence: extraction.confidence }),
      extraction,
    );
    d.drones.upsert(merged);
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
    return { kind: "auto-merged", droneId: target.id, candidate };
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
    return {
      kind: "auto-promoted",
      droneId: drone.id,
      candidate: { ...candidate, status: "promoted", resolvedInto: drone.id, resolvedBy: "auto" },
    };
  }
  if (d.autoDiscardThreshold !== undefined && extraction.confidence < d.autoDiscardThreshold) {
    candidate.status = "discarded";
    candidate.resolvedBy = "auto";
    d.candidates.add(candidate);
    return { kind: "auto-discarded", candidate };
  }
  d.candidates.add(candidate);
  return { kind: "queued", candidate };
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
    components: [],
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
    summary,
    specs: Array.from(specsMap.values()),
    rf,
    components,
    evolution,
    counterpartIds,
    createdAt,
    updatedAt: new Date().toISOString(),
  };

  // Upsert merged target
  d.drones.upsert(result);

  // 7. Update counterpart links on other drones pointing to mergeId
  for (const other of d.drones.list()) {
    if (other.id === keepId || other.id === mergeId) continue;
    if (other.counterpartIds.includes(mergeId)) {
      const updated = [
        ...new Set(
          other.counterpartIds
            .map((cId) => (cId === mergeId ? keepId : cId))
            .filter((cId) => cId !== other.id),
        ),
      ];
      d.drones.upsert({ ...other, counterpartIds: updated, updatedAt: new Date().toISOString() });
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
  const merged = withNormalizedRf(
    mergeSpecs(target, extracted.specs, c.source, { extractionConfidence: extracted.confidence }),
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
    const j = JSON.parse(r.content.replace(/^```json|```$/g, "").trim()) as Record<string, unknown>;
    if (!j || !j["company"]) return null;
    return {
      id: crypto.randomUUID(),
      company: String(j["company"]),
      country: j["country"] ? String(j["country"]) : "",
      ...(j["amount"] ? { amount: String(j["amount"]) } : {}),
      ...(j["currency"] ? { currency: String(j["currency"]) } : {}),
      ...(j["program"] ? { program: String(j["program"]) } : {}),
      ...(j["product"] ? { product: String(j["product"]) } : {}),
      ...(j["customer"] ? { customer: String(j["customer"]) } : {}),
      ...(j["announcedAt"] ? { announcedAt: String(j["announcedAt"]) } : {}),
      source,
      ...(j["notes"] ? { notes: String(j["notes"]) } : {}),
      createdAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
