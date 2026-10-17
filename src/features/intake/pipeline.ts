import type {
  Candidate,
  CandidateQuality,
  Drone,
  Extraction,
  ExtractedSpec,
  SpecAttribute,
  SystemExtraction,
} from "@/entities/drone/types";
import { ProviderOutageError, type IntelExtractor } from "@/shared/contracts/ai";
import type {
  CandidateRepository,
  DispatchRepository,
  DroneRepository,
} from "@/shared/contracts/repository";
import type { TaxonomyCandidateRepository } from "@/shared/contracts/taxonomy";
import type { Procurement } from "@/entities/procurement/types";
import { mergeLinks, normalizeExtraction, toRFLink } from "@/entities/normalization/apply";
import { attributeSemantic, mergeSpecs } from "@/features/dynamic-specs/spec-engine";
import { counterpartIdsFor, linkCounterparts } from "@/entities/drone/relations";
import { chatCompletionOnce } from "@/shared/infra/ai-proxy.server";
import { combineExtractions, needsDeepAI, needsFastAI } from "./extraction-gates";
import { outletKey } from "@/entities/source/outlet-record";
import { linkVariant, mergeDroneIntelligence } from "@/entities/drone/merge-intelligence";
import { ProcurementExtractionSchema } from "@/shared/contracts/extraction.schema";
import { phoneticKey, phoneticText } from "@/entities/drone/name-key";
import { organizationKey } from "@/entities/drone/types";

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
  /**
   * Rethrow a ProviderOutageError instead of degrading to the heuristic result. Set by queue
   * processors: a degraded result there is recorded as final and never re-analysed, so during an
   * outage the post must stay pending for a later run instead. An interactive paste leaves it
   * unset and gets the degraded result with a note.
   */
  deferOnOutage?: boolean;
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
  | { kind: "auto-merged"; droneId: string; candidate: Candidate; trace?: PipelineTrace }
  | { kind: "auto-promoted"; droneId: string; candidate: Candidate; trace?: PipelineTrace }
  | { kind: "auto-discarded"; candidate: Candidate; trace?: PipelineTrace }
  | { kind: "queued"; candidate: Candidate; trace?: PipelineTrace };

/**
 * What the run actually did, per item.
 *
 * Reporting rather than deciding: nothing branches on these fields, and they exist so the queue
 * can print "used the heuristic engine, escalated to tier 2, found 3 systems" instead of an
 * aggregate that hides which post behaved how.
 */
export interface PipelineTrace {
  /** The deterministic first pass ran. */
  heuristic: boolean;
  /** Which engines answered, e.g. "heuristic+t1+t2", "heuristic+t2", or "t1(heuristic)". */
  engines: string[];
  /** A tier that was called and failed, degrading to a deterministic result. */
  degraded: string[];
  /** Why the escalation gates fired (see extraction-gates). */
  reasons: string[];
  /** Specs the extraction produced, and systems it identified. */
  specs: number;
  systems: number;
  /** New specs written onto an existing catalog entry. Merge path only. */
  specsMerged?: number;
  /** Extraction rejected as not a system name before the promote gate. */
  rejected?: boolean;
}

export type PipelineResult = PipelinePrimaryResult & {
  relatedCandidates?: Candidate[];
  droneIds?: string[];
};

/**
 * Collision keys strip punctuation and spacing, not just case: to a source document
 * "Shahed-136" and "Shahed 136" are the same system, and auto-promotion must not create a
 * duplicate catalog entry just because the source hyphenated differently than the catalog did.
 * The same goes for script and romanisation: "Ланцет-3" collides with "Lancet-3".
 */
const collisionKey = (s: string) => phoneticKey(s);

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

/**
 * One system's slice of a multi-system extraction, as a standalone extraction.
 *
 * `notes` are the degraded-tier notes from the parent ("tier-1 AI unavailable — ..."). A slice's
 * own rationale replaces the parent's, so without re-applying them a candidate built from a
 * failed AI call reads exactly like one the AI produced.
 */
/**
 * Words that name an organisation, a unit or an outlet rather than a piece of equipment. A model
 * that misreads a report ("operators of the unmanned systems battalion destroyed a convoy") is
 * often confident about it, so confidence alone cannot keep these out of the catalog.
 */
const ORGANISATION =
  /\b(?:brigades?|battalions?|regiments?|divisions?|corps|command|forces|army|navy|air force|guards?|troops|grouping|agency|news|ministry|department|directorate|company|corporation|inc|ltd|llc|gmbh|jsc|holding|institute|university|bureau|paratroopers)\b|бригад|батальйон|батальон|полк|дивізі|дивизи|корпус|командуван|командован|угруповання|группировк|агентств|міністерств|министерств/iu;

/**
 * True when a name should not be promoted into the catalog without an analyst: it reads as an
 * organisation, or it is the outlet the report came from ("Ukrinform" from "Ukrinform (War)").
 * Only auto-promotion is gated; the candidate still goes to the Queue for review.
 */
export function notASystemName(name: string, source: string): boolean {
  if (ORGANISATION.test(name)) return true;
  const key = collisionKey(name);
  const outlet = collisionKey(source.split(" · ")[0]!.replace(/\(.*?\)/g, ""));
  // Short keys would match by accident ("UA" inside "Ukrainska Pravda").
  if (key.length < 4 || outlet.length < 4) return false;
  return outlet.includes(key) || key.includes(outlet);
}

function extractionForSystem(
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

function applyRelatedSystems(
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

function stemAndNumber(name: string): { stem: string; number: string } {
  const key = phoneticText(name).replace(/\s+/g, "");
  const match = key.match(/^(.*?)(\d+)$/);
  if (!match) return { stem: key.replace(/[aeiou]+$/, ""), number: "" };
  const [, stem, number] = match as [string, string, string];
  return { stem: stem.replace(/[aeiou]+$/, ""), number };
}

function phoneticNameMatches(left: string, right: string): boolean {
  const a = stemAndNumber(left);
  const b = stemAndNumber(right);
  if (a.number !== b.number) return false;
  if (!a.number && !b.number) return a.stem === b.stem;
  return a.stem === b.stem;
}

function findExistingSystemByIdentity(
  extraction: Extraction,
  catalog: Drone[],
): string | undefined {
  const candidate = extraction.name?.trim();
  if (!candidate) return undefined;
  const ids = new Set<string>();
  for (const drone of catalog) {
    for (const spelling of [drone.name, drone.cyrillic]) {
      if (spelling && phoneticNameMatches(candidate, spelling)) ids.add(drone.id);
    }
  }
  return ids.size === 1 ? [...ids][0] : undefined;
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
    if (candidate.quality) candidate.quality.decision = "auto-merged";
    d.candidates.add(candidate);
    trace.specsMerged = withSpecs.specs.length - specsBefore;
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
    ...(e.manufacturer
      ? {
          manufacturer: e.manufacturer,
          organizationLinks: [
            {
              organizationId: organizationKey(e.manufacturer),
              name: e.manufacturer,
              role: "manufacturer",
              source: c.source,
              firstSeen: now,
              lastSeen: now,
            },
          ],
        }
      : {}),
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

export interface RemoveDroneReport {
  /** Other catalog entries whose counterpart or variant links pointed at the removed one. */
  unlinked: number;
  /** Candidates that had been promoted or merged into it, now discarded by the analyst. */
  discarded: number;
  /** Feed posts whose provenance listed it. */
  dispatches: number;
}

/**
 * What removing an entry would touch, without changing anything. The dossier shows this before
 * the analyst confirms.
 */
export function removalImpact(
  id: string,
  d: Pick<PipelineDeps, "drones" | "candidates"> & { dispatches?: DispatchRepository },
): RemoveDroneReport {
  return {
    unlinked: d.drones.list().filter((x) => x.id !== id && linksTo(x, id)).length,
    discarded: d.candidates.list().filter((c) => c.resolvedInto === id).length,
    dispatches: (d.dispatches?.list() ?? []).filter((x) => x.droneIds?.includes(id)).length,
  };
}

function linksTo(drone: Drone, id: string): boolean {
  return (
    drone.counterpartIds.includes(id) ||
    drone.variantOfId === id ||
    (drone.variantIds?.includes(id) ?? false)
  );
}

/**
 * Remove a catalog entry an analyst has judged wrong (a unit or an outlet promoted as a system).
 *
 * Nothing is left pointing at it: other entries lose their links to it, feed posts drop it from
 * their provenance, and the candidates that created or fed it become "discarded by the analyst".
 * That last part is also what keeps it out: auto-promotion refuses a name an analyst has rejected
 * (see rejectedByAnalyst), so the next post naming it goes to the Queue instead of straight back
 * into the catalog. The candidates keep `resolvedInto` as history; the Queue shows it as deleted.
 */
export function removeDrone(
  id: string,
  d: Pick<PipelineDeps, "drones" | "candidates"> & { dispatches?: DispatchRepository },
): RemoveDroneReport | undefined {
  if (!d.drones.get(id)) return undefined;
  const report: RemoveDroneReport = { unlinked: 0, discarded: 0, dispatches: 0 };
  const now = new Date().toISOString();

  for (const other of d.drones.list()) {
    if (other.id === id || !linksTo(other, id)) continue;
    const { variantOfId, ...rest } = other;
    d.drones.upsert({
      ...rest,
      ...(variantOfId && variantOfId !== id ? { variantOfId } : {}),
      counterpartIds: other.counterpartIds.filter((x) => x !== id),
      ...(other.variantIds ? { variantIds: other.variantIds.filter((x) => x !== id) } : {}),
      updatedAt: now,
    });
    report.unlinked++;
  }

  for (const c of d.candidates.list()) {
    if (c.resolvedInto !== id) continue;
    d.candidates.update(c.id, { status: "discarded", resolvedBy: "analyst" });
    report.discarded++;
  }

  for (const post of d.dispatches?.list() ?? []) {
    if (!post.droneIds?.includes(id)) continue;
    d.dispatches!.update(post.id, { droneIds: post.droneIds.filter((x) => x !== id) });
    report.dispatches++;
  }

  d.drones.remove?.(id);
  return report;
}

/**
 * True when an analyst has already rejected this name: deleted the entry it created, or
 * discarded a candidate carrying it. Auto-promotion defers to that judgement.
 */
/**
 * Names the system has learned not to promote automatically. Two paths in:
 *
 * - an analyst discarded the name once — their word is final, as it has always been;
 * - the pipeline discarded it itself from LEARNED_NEGATIVE_REPEATS different outlets, which is a
 *   false-positive pattern repeating, not three coincidences.
 *
 * Only automatic paths consult this; the Queue page can still promote any name by hand.
 */
export const LEARNED_NEGATIVE_REPEATS = 3;

export function learnedNegativeKeys(candidates: readonly Candidate[]): Set<string> {
  const suppressed = new Set<string>();
  const autoDiscards = new Map<string, Set<string>>();
  for (const c of candidates) {
    if (c.status !== "discarded") continue;
    const name = c.extraction.name;
    if (!name) continue;
    const key = collisionKey(name);
    if (!key) continue;
    if (c.resolvedBy === "analyst") {
      suppressed.add(key);
      continue;
    }
    const outlets = autoDiscards.get(key) ?? new Set<string>();
    outlets.add(outletKey(c.source));
    autoDiscards.set(key, outlets);
  }
  for (const [key, outlets] of autoDiscards)
    if (outlets.size >= LEARNED_NEGATIVE_REPEATS) suppressed.add(key);
  return suppressed;
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
export function recordMention(
  c: Candidate,
  droneId: string,
  d: Pick<PipelineDeps, "drones" | "candidates">,
): Drone | undefined {
  const target = d.drones.get(droneId);
  if (!target) return undefined;
  const now = new Date().toISOString();
  const recorded = {
    ...target,
    evolution: [
      ...target.evolution,
      {
        date: now,
        kind: "mention" as const,
        description: "Mentioned in source: " + (c.source || "unknown source"),
        source: c.source,
      },
    ],
    updatedAt: now,
  };
  d.drones.upsert(recorded);
  d.candidates.update(c.id, { status: "merged", resolvedInto: droneId, resolvedBy: "analyst" });
  return recorded;
}

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
    tier: "tier2",
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
