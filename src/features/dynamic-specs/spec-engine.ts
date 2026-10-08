import type { Drone, ExtractedSpec, SpecAttribute, SpecClaim } from "@/entities/drone/types";
import { canonicalUnitForSemantic, semanticKeyFor } from "@/entities/normalization/semantic";

export interface SpecSourceRef {
  sourceId?: string;
  extractionConfidence?: number;
  evidence?: string;
}

export function attributeSemantic(spec: { key: string; label: string; semantic?: string }): string {
  return spec.semantic ?? semanticKeyFor(spec.key, spec.label);
}

function claimFor(spec: ExtractedSpec, source: string, date: string, ref?: SpecSourceRef): SpecClaim {
  return {
    value: spec.value,
    source,
    date,
    ...(spec.raw ? { raw: spec.raw } : {}),
    ...(spec.normalized ? { normalized: spec.normalized, normalizationConfidence: spec.normalized.confidence } : {}),
    ...(ref?.sourceId ? { sourceId: ref.sourceId } : {}),
    ...(ref?.evidence ? { evidence: ref.evidence } : {}),
    ...(ref?.extractionConfidence !== undefined ? { extractionConfidence: ref.extractionConfidence } : {}),
  };
}

/** Merge extracted key-values. Attributes that measure the same thing share a semantic id; the first key and label stay. */
export function mergeSpecs(drone: Drone, specs: ExtractedSpec[], source: string, ref?: SpecSourceRef): Drone {
  const date = new Date().toISOString();
  const next: SpecAttribute[] = drone.specs.map((s) => ({ ...s, claims: [...s.claims] }));
  for (const e of specs) {
    const semantic = attributeSemantic(e);
    const hit = next.find((s) => attributeSemantic(s) === semantic);
    const claim = claimFor(e, source, date, ref);
    if (hit) {
      if (!hit.semantic) hit.semantic = semantic;
      if (!hit.canonicalUnit && e.normalized?.canonicalUnit) hit.canonicalUnit = e.normalized.canonicalUnit;
      hit.claims.push(claim);
    } else {
      const canonicalUnit = e.normalized?.canonicalUnit ?? canonicalUnitForSemantic(semantic);
      next.push({
        key: e.key,
        label: e.label,
        semantic,
        ...(e.unit ? { unit: e.unit } : canonicalUnit ? { unit: canonicalUnit } : {}),
        ...(canonicalUnit ? { canonicalUnit } : {}),
        discoveredBy: "ai",
        claims: [claim],
      });
    }
  }
  return { ...drone, specs: next, updatedAt: date };
}

export function allSpecKeys(drones: Drone[]) {
  const m = new Map<string, { label: string; count: number; discoveredBy: SpecAttribute["discoveredBy"] }>();
  drones.forEach((d) => d.specs.forEach((s) => {
    const cur = m.get(s.key);
    m.set(s.key, { label: s.label, count: (cur?.count ?? 0) + 1, discoveredBy: cur?.discoveredBy === "seed" ? "seed" : s.discoveredBy });
  }));
  return [...m.entries()].map(([key, v]) => ({ key, ...v }));
}
