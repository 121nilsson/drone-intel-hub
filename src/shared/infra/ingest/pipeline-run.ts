import type { Candidate, Drone, Extraction, ExtractedSpec } from "@/entities/drone/types";
import { ProviderOutageError } from "@/shared/contracts/ai";
import type { PipelineDeps } from "./pipeline-types";
import {
  enrichProcurement,
  procurementsFrom,
  splitFinancialSpecs,
} from "@/entities/procurement/routing";
import { mergeLinks, normalizeExtraction, toRFLink } from "@/entities/normalization/apply";
import { mergeSpecs } from "@/entities/drone/spec-engine";
import { counterpartIdsFor, linkCounterparts } from "@/entities/drone/relations";
import { combineExtractions, needsDeepAI, needsFastAI } from "@/entities/drone/extraction-gates";
import { outletKey } from "@/entities/source/outlet-record";
import { linkVariant, mergeDroneIntelligence } from "@/entities/drone/merge-intelligence";
import type { AnalysisContext, PipelineTrace, PipelineResult } from "./pipeline-types";
import {
  annotate,
  applyNormalization,
  collisionKey,
  findExistingSystemByIdentity,
  linkVariantReplay,
  withCounterparts,
  withNormalizedRf,
} from "./pipeline-internal";
import { collidesWithCatalog, learnedNegativeKeys, notASystemName } from "./pipeline-triage";
import { applyRelatedSystems, extractionForSystem } from "./pipeline-slice";
import { promote } from "./pipeline-actions";

export async function runTwoTier(
  raw: string,
  source: string,
  d: PipelineDeps,
  context: AnalysisContext = {},
): Promise<PipelineResult> {
  const catalog = d.drones.list();
  let tier: 1 | 2 = 1;
  let extraction: Extraction | undefined;
  /** Why a tier fell back, re-applied to every per-system candidate (see extractionForSystem). */
  const degraded: string[] = [];
  /** Which engines actually answered, for the per-item trace. */
  const engines: string[] = [];
  const heuristic = d.heuristicFirst !== false ? (d.heuristic ?? d.fallback) : undefined;
  if (heuristic) {
    extraction = await heuristic.extract(raw, catalog);
    engines.push("heuristic");
  }

  const fastGate = extraction
    ? needsFastAI(extraction, d.escalationThreshold)
    : { needed: true, reasons: ["heuristic-disabled"] };
  const tier1IsHeuristic = heuristic && d.tier1.label === heuristic.label;
  if (fastGate.needed && !tier1IsHeuristic) {
    try {
      const refined = await d.tier1.extract(raw, catalog, extraction);
      extraction = extraction ? combineExtractions(extraction, refined) : refined;
      if (extraction.metadata) extraction.metadata.escalationReasons = fastGate.reasons;
      engines.push("t1");
    } catch (err) {
      if (d.deferOnOutage && err instanceof ProviderOutageError) throw err;
      if (!extraction) {
        if (!d.fallback) throw err;
        degraded.push("tier-1 AI unavailable — heuristic");
        extraction = annotate(await d.fallback.extract(raw, catalog), degraded.at(-1)!);
      } else {
        degraded.push("tier-1 AI unavailable — kept heuristic");
        extraction = annotate(extraction, degraded.at(-1)!);
      }
      console.error(
        "[pipeline] tier-1 call failed, using deterministic result",
        (err as Error).message,
        "source:",
        source,
      );
    }
  }
  if (!extraction) {
    extraction = await d.tier1.extract(raw, catalog);
    engines.push("t1");
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
      engines.push("t2");
      if (extraction.metadata) {
        extraction.metadata.escalationReasons = [
          ...(extraction.metadata.escalationReasons ?? []),
          ...deepGate.reasons,
        ];
      }
    } catch (err) {
      // The deep pass was owed (low confidence or conflicting identity); keeping the shallow
      // result during an outage would skip it for good.
      if (d.deferOnOutage && err instanceof ProviderOutageError) throw err;
      tier = 1;
      console.error("[pipeline] tier-2 call failed, keeping tier-1 result", (err as Error).message);
      degraded.push("tier-2 AI unavailable — kept tier 1");
      extraction = annotate(extraction, degraded.at(-1)!);
    }
  }
  const fullExtraction: Extraction = extraction;
  // Built once and attached to whichever outcome is returned. `specsMerged` is filled in on the
  // merge path below, where the pre- and post-merge catalog entry are both in hand.
  const trace: PipelineTrace = {
    heuristic: engines.includes("heuristic"),
    engines,
    degraded: [...degraded],
    reasons: [
      ...(fastGate.needed && !tier1IsHeuristic ? fastGate.reasons : []),
      ...(deepGate.needed && !tier2IsSameHeuristic ? deepGate.reasons : []),
    ],
    specs: fullExtraction.specs.length,
    // `systems`, not `systemExtractions`: the latter only exists for a multi-system split, so
    // counting it reports 0 for every ordinary post.
    systems: fullExtraction.systems?.length ?? (fullExtraction.name ? 1 : 0),
  };
  if ((fullExtraction.systemExtractions?.length ?? 0) > 1) {
    const primary =
      fullExtraction.systemExtractions?.find((s) => s.matchId === fullExtraction.matchId) ??
      fullExtraction.systemExtractions?.find((s) => s.name === fullExtraction.name) ??
      fullExtraction.systemExtractions?.[0];
    if (primary) extraction = extractionForSystem(fullExtraction, primary, degraded);
  }
  const normalized = applyNormalization(extraction);
  extraction = normalized.extraction;
  // Deal figures leave the drone specs here and become procurement records.
  {
    const routed = splitFinancialSpecs(extraction);
    extraction = routed.extraction;
    if (d.procurements && routed.financial.length) {
      // The post may name several systems while `extraction` is the primary slice. Keep every
      // name/id available for linking, while the amount/company still come from the routed claims.
      const procurementExtraction: Extraction = {
        ...extraction,
        ...(fullExtraction.systems ? { systems: fullExtraction.systems } : {}),
        ...(fullExtraction.systemExtractions
          ? { systemExtractions: fullExtraction.systemExtractions }
          : {}),
      };
      let records = procurementsFrom(routed.financial, procurementExtraction, source, context.url, {
        ...(context.dispatchId ? { sourceId: context.dispatchId } : {}),
        ...(context.publishedAt ? { publishedAt: context.publishedAt } : {}),
      });
      if (d.procurementExtractor) {
        try {
          const extracted = await d.procurementExtractor(raw, source);
          if (extracted) records = records.map((p) => enrichProcurement(p, extracted));
        } catch (err) {
          // A procurement record with the source figure is still useful when the metadata call
          // fails; the deterministic fields are already complete.
          console.error(
            "[pipeline] procurement extraction failed, keeping routed record",
            (err as Error).message,
            "source:",
            source,
          );
        }
      }
      for (const p of records) d.procurements.add(p);
    }
  }
  // Autonomy brake: a model-produced figure is only actionable if its evidence actually
  // appears in the original post. Identity fields are untouched.
  const fold = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const hasEvidence = (spec: ExtractedSpec) => {
    const proof = spec.evidence ?? spec.raw;
    if (!proof) return true;
    return fold(raw).includes(fold(String(proof)));
  };
  if (extraction.specs) extraction.specs = extraction.specs.filter(hasEvidence);
  if (extraction.systemExtractions)
    extraction.systemExtractions = extraction.systemExtractions.map((s) => ({
      ...s,
      specs: s.specs.filter(hasEvidence),
    }));
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
          ...(!extraction.specs.length
            ? ["no structured facts to merge: mention-only candidate"]
            : []),
          ...(extraction.specs.some((spec) => !spec.evidence)
            ? ["some specs lack quoted evidence"]
            : []),
        ]),
      ],
    },
    status: "pending",
  };
  const suppressed = learnedNegativeKeys(d.candidates.list());
  if (!extraction.matchId) {
    const inferredMatchId = findExistingSystemByIdentity(extraction, catalog);
    if (
      inferredMatchId &&
      extraction.confidence >= d.autoMergeThreshold &&
      !collidesWithCatalog(extraction, catalog)
    ) {
      extraction.matchId = inferredMatchId;
      if (candidate.extraction) candidate.extraction.matchId = inferredMatchId;
    }
  }

  if (extraction.matchId && extraction.confidence >= d.autoMergeThreshold) {
    // The guard above (re-checked synchronously, no awaits since) guarantees this exists.
    const target = d.drones.get(extraction.matchId)!;
    const specsBefore = target.specs.length;
    const applyMerge = (base: Drone) =>
      mergeDroneIntelligence(
        withNormalizedRf(
          mergeSpecs(base, extraction.specs, source, {
            ...(context.dispatchId ? { sourceId: context.dispatchId } : {}),
            extractionConfidence: extraction.confidence,
            ...(extraction.metadata?.engine
              ? { extractionEngine: extraction.metadata.engine }
              : {}),
            ...(extraction.metadata?.model ? { model: extraction.metadata.model } : {}),
          }),
          extraction,
        ),
        extraction,
        context.dispatchId,
        { source },
      );
    const merged = applyMerge(target);
    d.drones.upsert(merged, applyMerge);
    const variantOf = extraction.systems?.find(
      (s) => s.matchId === target.id || s.name.toLowerCase() === target.name.toLowerCase(),
    )?.variantOf;
    if (variantOf) {
      const parent = d.drones.get(variantOf);
      if (parent)
        for (const linked of linkVariant(parent, merged))
          d.drones.upsert(linked, (fresh) =>
            linkVariantReplay(fresh, parent.id, merged.id, d.drones),
          );
    }
    // The extraction already reports systems[] and variantOf; persist those as catalog
    // relations so counterpart links come from ingest instead of being hand-maintained.
    const counterpartIds = counterpartIdsFor(extraction, catalog, target.id);
    for (const changed of linkCounterparts(merged, counterpartIds, catalog)) {
      const gained = changed.id === merged.id ? counterpartIds : [merged.id];
      d.drones.upsert(changed, (fresh) =>
        withCounterparts(
          fresh,
          gained.filter((id) => id !== fresh.id && d.drones.get(id)),
        ),
      );
    }
    candidate.status = "merged";
    candidate.resolvedInto = target.id;
    candidate.resolvedBy = "auto";
    if (candidate.quality) candidate.quality.decision = "auto-merged";
    d.candidates.add(candidate);
    trace.specsMerged = merged.specs.length - specsBefore;
    return applyRelatedSystems(
      { kind: "auto-merged", droneId: target.id, candidate, trace },
      fullExtraction,
      source,
      d,
      context,
      degraded,
    );
  }
  // A name colliding with the catalog means the model missed a match; promoting it would
  // create a duplicate, so it goes to review instead.
  if (
    d.autoPromoteThreshold !== undefined &&
    !extraction.matchId &&
    extraction.name?.trim() &&
    extraction.confidence >= d.autoPromoteThreshold &&
    !collidesWithCatalog(extraction, catalog) &&
    !notASystemName(extraction.name, source) &&
    !suppressed.has(collisionKey(extraction.name))
  ) {
    d.candidates.add(candidate);
    const drone = promote(candidate, d);
    if (candidate.quality) candidate.quality.decision = "auto-promoted";
    d.candidates.update(candidate.id, { resolvedBy: "auto" });
    return applyRelatedSystems(
      {
        kind: "auto-promoted",
        droneId: drone.id,
        candidate: { ...candidate, status: "promoted", resolvedInto: drone.id, resolvedBy: "auto" },
        trace,
      },
      fullExtraction,
      source,
      d,
      context,
      degraded,
    );
  }
  if (d.autoDiscardThreshold !== undefined && extraction.confidence < d.autoDiscardThreshold) {
    candidate.status = "discarded";
    candidate.resolvedBy = "auto";
    if (candidate.quality) candidate.quality.decision = "auto-discarded";
    // A nameless, system-less, matchless extraction has nothing to attribute, review or merge:
    // storing it only grew the discard pile (2,060 nameless rows of 3,224 discarded, measured
    // live). The outcome still lands on the dispatch; no candidate row is recorded. A screen
    // that matched or named something keeps its audit row.
    if (extraction.name || extraction.systems?.length || extraction.matchId)
      d.candidates.add(candidate);
    return applyRelatedSystems(
      { kind: "auto-discarded", candidate, trace },
      fullExtraction,
      source,
      d,
      context,
      degraded,
    );
  }
  if (candidate.quality) candidate.quality.decision = "queued";
  d.candidates.add(candidate);
  return applyRelatedSystems(
    { kind: "queued", candidate, trace },
    fullExtraction,
    source,
    d,
    context,
    degraded,
  );
}
