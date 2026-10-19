import type { ExtractedSpec, Extraction, SystemExtraction } from "@/entities/drone/types";
import { canonicalUnitForSemantic, semanticKeyFor } from "@/entities/normalization/semantic";
import { normalizeQuantity, rebaseQuantity } from "@/entities/normalization/units";

export interface ExtractionGate {
  needed: boolean;
  reasons: string[];
}

export function needsFastAI(e: Extraction, threshold: number): ExtractionGate {
  const reasons: string[] = [];
  if (!e.name && !e.systems?.length) reasons.push("unknown-system");
  if (!e.matchId && e.systems?.some((s) => !s.matchId)) reasons.push("novel-or-unresolved-system");
  if (e.confidence < threshold) reasons.push("low-heuristic-confidence");
  if (!e.specs.length && !e.components?.length && !e.sensors?.length && !e.payloads?.length)
    reasons.push("no-structured-facts");
  if ((e.systems?.length ?? 0) > 1) reasons.push("multi-system-attribution");
  return { needed: reasons.length > 0, reasons };
}

export function needsDeepAI(e: Extraction, threshold: number): ExtractionGate {
  // An AI pass read the report and found no named system (and no catalog match survived it).
  // Its confidence is 0 by design, which would otherwise escalate every generic "drones attacked
  // overnight" post to the deep tier with nothing to attribute.
  if (e.metadata?.engine !== "heuristic" && !e.name && !e.systems?.length)
    return { needed: false, reasons: [] };
  const reasons: string[] = [];
  if (e.confidence < threshold) reasons.push("low-combined-confidence");
  if ((e.systems?.length ?? 0) > 1) {
    const slices = e.systemExtractions ?? [];
    if (slices.length !== e.systems?.length || slices.some((s) => !s.specs.length))
      reasons.push("unresolved-multi-system-attribution");
  }
  if (e.systems?.some((s) => s.matchId && s.variantOf)) reasons.push("conflicting-identity");
  return { needed: reasons.length > 0, reasons };
}

const specKey = (s: ExtractedSpec) =>
  `${s.semantic ?? s.key}|${String(s.value).toLowerCase()}|${s.unit ?? ""}`;
/**
 * Looser identity for "did the AI restate this?": models rename keys ("max_range" for range) and
 * rewrite units ("120 km" as 120000 m), so compare semantic key + canonical quantity.
 */
function restateKey(s: ExtractedSpec): string {
  const semantic = semanticKeyFor(s.key, s.label);
  const text = typeof s.value === "string" ? s.value : `${s.value} ${s.unit ?? ""}`;
  let q = normalizeQuantity(text);
  const target = canonicalUnitForSemantic(semantic);
  if (q && target) q = rebaseQuantity(q, target);
  const v = q?.canonicalValue;
  return v !== undefined
    ? `${semantic}|${Number(v.toPrecision(6))}|${q?.canonicalUnit ?? ""}`
    : `${semantic}|${String(s.value).trim().toLowerCase()}|${(s.unit ?? "").toLowerCase()}`;
}

/**
 * Union of both sides' specs. When `judged` (the refinement is an AI that was shown `a` as
 * deterministic observations and told to drop what the text does not support), each claim also
 * records the verdict in `provenance` - the only place that verdict survives, since the union
 * itself never removes a deterministic fact.
 */
function mergeSpecs(a: ExtractedSpec[], b: ExtractedSpec[], judged = false): ExtractedSpec[] {
  const restated = new Set(judged ? b.map(restateKey) : []);
  const out = judged
    ? a.map((s): ExtractedSpec => {
        const heuristicSaw = s.provenance !== "ai";
        const aiSaw =
          s.provenance === "ai" || s.provenance === "both" || restated.has(restateKey(s));
        return { ...s, provenance: heuristicSaw ? (aiSaw ? "both" : "heuristic") : "ai" };
      })
    : [...a];
  const seen = new Set(a.map(specKey));
  for (const spec of b) {
    const key = specKey(spec);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(judged ? { ...spec, provenance: "ai" } : spec);
    }
  }
  return out;
}

function mergeSystems(
  a: SystemExtraction[],
  b: SystemExtraction[],
  judged = false,
): SystemExtraction[] {
  const out = a.map((s) => ({ ...s, specs: [...s.specs] }));
  for (const incoming of b) {
    const hit = out.find(
      (s) =>
        (s.matchId && s.matchId === incoming.matchId) ||
        s.name.toLowerCase() === incoming.name.toLowerCase(),
    );
    if (!hit) {
      out.push(incoming);
      continue;
    }
    Object.assign(hit, {
      ...incoming,
      specs: mergeSpecs(hit.specs, incoming.specs, judged),
      rfBands: [...new Set([...hit.rfBands, ...incoming.rfBands])],
      aliases: [...new Set([...(hit.aliases ?? []), ...(incoming.aliases ?? [])])],
      operators: [...new Set([...(hit.operators ?? []), ...(incoming.operators ?? [])])],
      guidance: [...new Set([...(hit.guidance ?? []), ...(incoming.guidance ?? [])])],
      components: [...(hit.components ?? []), ...(incoming.components ?? [])],
      payloads: [...(hit.payloads ?? []), ...(incoming.payloads ?? [])],
      sensors: [...(hit.sensors ?? []), ...(incoming.sensors ?? [])],
      confidence: Math.max(hit.confidence, incoming.confidence),
    });
  }
  return out;
}

/**
 * AI refines deterministic output. Deterministic FACTS (specs, RF bands, payloads...) are never
 * silently removed, but IDENTITY is the AI's call: the heuristic proposes every capitalised term
 * near a drone keyword ("National", "Ukrinform"), so an unconfirmed heuristic system is dropped
 * unless it is a catalog match - a name the catalog already knows is not noise.
 */
export function combineExtractions(base: Extraction, refinement: Extraction): Extraction {
  const aiJudged = refinement.metadata?.engine === "ai";
  const confirmed = new Set(
    [...(refinement.systems ?? []), ...(refinement.systemExtractions ?? [])].map((s) =>
      s.name.toLowerCase(),
    ),
  );
  const kept = (s: { name: string; matchId?: string }) =>
    !aiJudged || !!s.matchId || confirmed.has(s.name.toLowerCase());
  const baseSystems = (base.systems ?? []).filter(kept);
  const systemExtractions = mergeSystems(
    (base.systemExtractions ?? []).filter(kept),
    refinement.systemExtractions ?? [],
    aiJudged,
  );
  const systems = [
    ...baseSystems,
    ...(refinement.systems ?? []).filter(
      (x) =>
        !baseSystems.some(
          (s) =>
            (s.matchId && s.matchId === x.matchId) || s.name.toLowerCase() === x.name.toLowerCase(),
        ),
    ),
  ];
  // With no name from the AI, the base name stands only if it is itself a catalog match.
  const { name: baseName, ...baseRest } = base;
  const name = refinement.name ?? (!aiJudged || base.matchId ? baseName : undefined);
  // The AI's confidence is the verdict on identity, so the heuristic cannot inflate it - except
  // when the AI found nothing and only catalog matches remain to vouch for the post.
  const confidence =
    aiJudged && (confirmed.size > 0 || !systems.length)
      ? refinement.confidence
      : Math.max(base.confidence, refinement.confidence);
  return {
    ...baseRest,
    ...refinement,
    ...(name ? { name } : {}),
    aliases: [...new Set([...base.aliases, ...refinement.aliases])],
    operators: [...new Set([...base.operators, ...refinement.operators])],
    specs: mergeSpecs(base.specs, refinement.specs, aiJudged),
    rfBands: [...new Set([...base.rfBands, ...refinement.rfBands])],
    systems,
    systemExtractions,
    components: [...(base.components ?? []), ...(refinement.components ?? [])],
    payloads: [...(base.payloads ?? []), ...(refinement.payloads ?? [])],
    sensors: [...(base.sensors ?? []), ...(refinement.sensors ?? [])],
    guidance: [...new Set([...(base.guidance ?? []), ...(refinement.guidance ?? [])])],
    confidence,
    rationale: [base.rationale, refinement.rationale].filter(Boolean).join(" · "),
    metadata: {
      schemaVersion: Math.max(
        base.metadata?.schemaVersion ?? 1,
        refinement.metadata?.schemaVersion ?? 1,
      ),
      engine: "combined",
      ...(refinement.metadata?.model ? { model: refinement.metadata.model } : {}),
      ...(refinement.metadata?.promptVersion
        ? { promptVersion: refinement.metadata.promptVersion }
        : {}),
      escalationReasons: [
        ...(base.metadata?.escalationReasons ?? []),
        ...(refinement.metadata?.escalationReasons ?? []),
      ],
      analyzedAt: new Date().toISOString(),
    },
  };
}
