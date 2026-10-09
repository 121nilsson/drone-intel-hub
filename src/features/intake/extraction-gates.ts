import type { ExtractedSpec, Extraction, SystemExtraction } from "@/entities/drone/types";

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

function mergeSpecs(a: ExtractedSpec[], b: ExtractedSpec[]): ExtractedSpec[] {
  const out = [...a];
  const seen = new Set(a.map(specKey));
  for (const spec of b) {
    const key = specKey(spec);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(spec);
    }
  }
  return out;
}

function mergeSystems(a: SystemExtraction[], b: SystemExtraction[]): SystemExtraction[] {
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
      specs: mergeSpecs(hit.specs, incoming.specs),
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

/** AI refines deterministic output; it never silently removes a deterministic observation. */
export function combineExtractions(base: Extraction, refinement: Extraction): Extraction {
  const systemExtractions = mergeSystems(
    base.systemExtractions ?? [],
    refinement.systemExtractions ?? [],
  );
  return {
    ...base,
    ...refinement,
    aliases: [...new Set([...base.aliases, ...refinement.aliases])],
    operators: [...new Set([...base.operators, ...refinement.operators])],
    specs: mergeSpecs(base.specs, refinement.specs),
    rfBands: [...new Set([...base.rfBands, ...refinement.rfBands])],
    systems: [
      ...(base.systems ?? []),
      ...(refinement.systems ?? []).filter(
        (x) =>
          !(base.systems ?? []).some(
            (s) => s.matchId === x.matchId && s.name.toLowerCase() === x.name.toLowerCase(),
          ),
      ),
    ],
    systemExtractions,
    components: [...(base.components ?? []), ...(refinement.components ?? [])],
    payloads: [...(base.payloads ?? []), ...(refinement.payloads ?? [])],
    sensors: [...(base.sensors ?? []), ...(refinement.sensors ?? [])],
    guidance: [...new Set([...(base.guidance ?? []), ...(refinement.guidance ?? [])])],
    confidence: Math.max(base.confidence, refinement.confidence),
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
