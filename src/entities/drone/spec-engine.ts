import type { Drone, ExtractedSpec, SpecAttribute, SpecClaim } from "@/entities/drone/types";
import { canonicalUnitForSemantic, semanticKeyFor } from "@/entities/normalization/semantic";

export interface SpecSourceRef {
  sourceId?: string;
  extractionConfidence?: number;
  evidence?: string;
  extractionEngine?: string;
  model?: string;
}

export function attributeSemantic(spec: { key: string; label: string; semantic?: string }): string {
  // A stored semantic equal to the raw key was never resolved (written before the key had a
  // rule), so it is read again: otherwise "maxSpeed" stays apart from "max_speed" for good.
  return spec.semantic && spec.semantic !== spec.key
    ? spec.semantic
    : semanticKeyFor(spec.key, spec.label);
}

/**
 * Attributes that measure the same thing become one, keeping the first row's key, label and
 * unit and every claim from all of them. Heals records that grew a second row before their
 * keys were understood as the same attribute.
 */
function regroup(specs: SpecAttribute[]): SpecAttribute[] {
  const out: SpecAttribute[] = [];
  for (const s of specs) {
    const semantic = attributeSemantic(s);
    const hit = out.find((o) => attributeSemantic(o) === semantic);
    if (hit) {
      hit.claims.push(...s.claims);
      continue;
    }
    const canonicalUnit = s.canonicalUnit ?? canonicalUnitForSemantic(semantic);
    out.push({
      ...s,
      semantic,
      ...(canonicalUnit ? { canonicalUnit } : {}),
      claims: [...s.claims],
    });
  }
  return out;
}

function claimFor(
  spec: ExtractedSpec,
  source: string,
  date: string,
  ref?: SpecSourceRef,
): SpecClaim {
  const evidence = spec.evidence ?? ref?.evidence;
  return {
    id: crypto.randomUUID(),
    value: spec.value,
    source,
    date,
    ...(spec.raw ? { raw: spec.raw } : {}),
    ...(spec.normalized
      ? { normalized: spec.normalized, normalizationConfidence: spec.normalized.confidence }
      : {}),
    ...(ref?.sourceId ? { sourceId: ref.sourceId } : {}),
    ...(evidence ? { evidence } : {}),
    ...(ref?.extractionConfidence !== undefined
      ? { extractionConfidence: ref.extractionConfidence }
      : {}),
    ...(ref?.extractionEngine ? { extractionEngine: ref.extractionEngine } : {}),
    ...(ref?.model ? { model: ref.model } : {}),
  };
}

/** Merge extracted key-values. Attributes that measure the same thing share a semantic id; the first key and label stay. */
export function mergeSpecs(
  drone: Drone,
  specs: ExtractedSpec[],
  source: string,
  ref?: SpecSourceRef,
): Drone {
  const date = new Date().toISOString();
  const next = regroup(drone.specs);
  // Signatures of claims added in this batch, so two specs from the same extraction that
  // restate the same figure in the same words are recorded once. Claims already on the drone
  // from earlier sources are intentionally not part of the key - different sources stating the
  // same figure are separate evidence.
  const added = new Set<string>();
  for (const e of specs) {
    const semantic = attributeSemantic(e);
    const hit = next.find((s) => attributeSemantic(s) === semantic);
    const claim = claimFor(e, source, date, ref);
    const sig = `${semantic}|${String(claim.value)}|${claim.evidence ?? ""}`;
    if (added.has(sig)) continue;
    added.add(sig);
    if (hit) {
      if (!hit.semantic) hit.semantic = semantic;
      if (!hit.canonicalUnit && e.normalized?.canonicalUnit)
        hit.canonicalUnit = e.normalized.canonicalUnit;
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
  const m = new Map<
    string,
    { label: string; count: number; discoveredBy: SpecAttribute["discoveredBy"] }
  >();
  drones.forEach((d) =>
    d.specs.forEach((s) => {
      const cur = m.get(s.key);
      m.set(s.key, {
        label: s.label,
        count: (cur?.count ?? 0) + 1,
        discoveredBy: cur?.discoveredBy === "seed" ? "seed" : s.discoveredBy,
      });
    }),
  );
  return [...m.entries()].map(([key, v]) => ({ key, ...v }));
}
