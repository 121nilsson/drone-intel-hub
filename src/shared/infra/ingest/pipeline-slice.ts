import type { Candidate, Drone, Extraction, SystemExtraction } from "@/entities/drone/types";
import type {
  AnalysisContext,
  PipelineDeps,
  PipelinePrimaryResult,
  PipelineResult,
} from "./pipeline-types";
import { collidesWithCatalog, learnedNegativeKeys, notASystemName } from "./pipeline-triage";
import {
  annotate,
  applyNormalization,
  collisionKey,
  linkVariantReplay,
  withNormalizedRf,
} from "./pipeline-internal";
import { promote } from "./pipeline-actions";
import { counterpartIdsFor, linkCounterparts } from "@/entities/drone/relations";
import { linkVariant, mergeDroneIntelligence } from "@/entities/drone/merge-intelligence";
import { mergeSpecs } from "@/entities/drone/spec-engine";
import { toRFLink } from "@/entities/normalization/apply";

/**
 * One system's slice of a multi-system extraction, as a standalone extraction.
 *
 * `notes` are the degraded-tier notes from the parent ("tier-1 AI unavailable — ..."). A slice's
 * own rationale replaces the parent's, so without re-applying them a candidate built from a
 * failed AI call reads exactly like one the AI produced.
 */
export function extractionForSystem(
  parent: Extraction,
  s: SystemExtraction,
  notes: string[] = [],
): Extraction {
  return notes.reduce(
    (e, note) => (e.rationale?.includes(note) ? e : annotate(e, note)),
    sliceExtraction(parent, s),
  );
}

function sliceExtraction(parent: Extraction, s: SystemExtraction): Extraction {
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

export function applyRelatedSystems(
  primary: PipelinePrimaryResult,
  all: Extraction,
  source: string,
  d: PipelineDeps,
  context: AnalysisContext,
  notes: string[] = [],
): PipelineResult {
  const slices = all.systemExtractions ?? [];
  if (slices.length < 2) return primary;
  // Learned negatives, read once for the loop rather than per slice: the candidate list does not
  // change meaningfully between slices of one extraction.
  const suppressed = learnedNegativeKeys(d.candidates.list());
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
    const extraction = applyNormalization(extractionForSystem(all, slice, notes)).extraction;
    const candidate: Candidate = {
      id: crypto.randomUUID(),
      raw: primary.candidate.raw,
      source,
      createdAt: new Date().toISOString(),
      tier: primary.candidate.tier,
      extraction,
      quality: {
        confidence: extraction.confidence,
        specCount: extraction.specs.length,
        evidenceSpecCount: extraction.specs.filter((spec) => Boolean(spec.evidence)).length,
        systemNames: extraction.systems?.length
          ? extraction.systems.map((s) => s.name).filter((name): name is string => Boolean(name))
          : extraction.name
            ? [extraction.name]
            : [],
        risks: [
          ...new Set([
            ...(extraction.metadata?.escalationReasons ?? []),
            ...(extraction.systems?.length && extraction.systems.length > 1
              ? ["multi-system-attribution"]
              : []),
            ...(collidesWithCatalog(extraction, d.drones.list())
              ? ["name collides with an existing catalog system"]
              : []),
            ...(extraction.name && notASystemName(extraction.name, source)
              ? ["name resembles an organisation or source"]
              : []),
            ...(extraction.confidence < (d.autoMergeThreshold ?? 0.85)
              ? ["confidence below auto-merge threshold"]
              : []),
            ...(extraction.confidence >= (d.autoMergeThreshold ?? 0.85) &&
            extraction.confidence < (d.autoPromoteThreshold ?? 0.9)
              ? ["confidence below auto-promote threshold"]
              : []),
            ...(extraction.specs.some((s) => !s.evidence)
              ? ["some specs lack quoted evidence"]
              : []),
          ]),
        ],
      },
      status: "pending",
    };
    const target = extraction.matchId ? d.drones.get(extraction.matchId) : undefined;
    const targetName = target?.name.trim().toLowerCase() ?? "";
    const extractedName = (extraction.name ?? "").trim().toLowerCase();
    const isDistinctVariant =
      !!target &&
      extractedName.length > targetName.length &&
      extractedName.startsWith(targetName) &&
      /^(?:ace|edge|mse|block\s*\d+|series)$/.test(extractedName.slice(targetName.length).trim());
    if (
      extraction.matchId &&
      extraction.confidence >= d.autoMergeThreshold &&
      target &&
      !isDistinctVariant
    ) {
      if (target) {
        const applyMerge = (base: Drone) =>
          mergeDroneIntelligence(
            withNormalizedRf(
              mergeSpecs(base, extraction.specs, source, {
                ...(context.dispatchId ? { sourceId: context.dispatchId } : {}),
                extractionConfidence: extraction.confidence,
              }),
              extraction,
            ),
            extraction,
            context.dispatchId,
            { source },
          );
        const merged = applyMerge(target);
        d.drones.upsert(merged, applyMerge);
        if (slice.variantOf) {
          const parent = d.drones.get(slice.variantOf);
          if (parent)
            for (const linked of linkVariant(parent, merged))
              d.drones.upsert(linked, (fresh) =>
                linkVariantReplay(fresh, parent.id, merged.id, d.drones),
              );
        }
        candidate.status = "merged";
        candidate.resolvedInto = target.id;
        candidate.resolvedBy = "auto";
        if (candidate.quality) candidate.quality.decision = "auto-merged";
        droneIds.add(target.id);
      }
    } else if (
      d.autoPromoteThreshold !== undefined &&
      extraction.name &&
      extraction.confidence >= d.autoPromoteThreshold &&
      !collidesWithCatalog(extraction, d.drones.list()) &&
      !notASystemName(extraction.name, source) &&
      !suppressed.has(collisionKey(extraction.name))
    ) {
      d.candidates.add(candidate);
      const promoted = promote(candidate, d);
      // Persisted, not just set on the local object: add() has already written the candidate.
      d.candidates.update(candidate.id, { resolvedBy: "auto" });
      candidate.status = "promoted";
      candidate.resolvedInto = promoted.id;
      candidate.resolvedBy = "auto";
      if (candidate.quality) candidate.quality.decision = "auto-promoted";
      droneIds.add(promoted.id);
      relatedCandidates.push(candidate);
      continue;
    } else if (
      d.autoDiscardThreshold !== undefined &&
      extraction.confidence < d.autoDiscardThreshold
    ) {
      // Same gate as the primary candidate. Without it a single noisy post queued a dozen
      // near-zero-confidence slices for review, burying the candidates worth an analyst's time.
      candidate.status = "discarded";
      candidate.resolvedBy = "auto";
      if (candidate.quality) candidate.quality.decision = "auto-discarded";
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
