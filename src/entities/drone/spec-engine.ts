import type { Drone, ExtractedSpec, SpecAttribute, SpecClaim } from "@/entities/drone/types";
import { consensus } from "@/entities/drone/consensus";
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
 * Whether two attributes are one. Sharing a semantic is required but not enough when both got
 * it from their labels alone: a label rule is a guess, and two guesses agreeing once folded
 * "antenna elements (current)", "(planned)" and "(2027)" into one disputed figure. A merge
 * needs the same key, or a key that names the semantic by itself ("max_speed" is speed.max with
 * no label at all), so a row the label explains ("speed", "Maximum speed") still joins it.
 */
export function sameAttribute(
  a: { key: string; label: string; semantic?: string },
  b: { key: string; label: string; semantic?: string },
): boolean {
  const semantic = attributeSemantic(a);
  if (semantic !== attributeSemantic(b)) return false;
  return (
    a.key === b.key || semanticKeyFor(a.key) === semantic || semanticKeyFor(b.key) === semantic
  );
}

/**
 * Attributes that measure the same thing become one, keeping the first row's key, label and
 * unit and every claim from all of them. Heals records that grew a second row before their
 * keys were understood as the same attribute.
 */
export function regroup(specs: SpecAttribute[]): SpecAttribute[] {
  const out: SpecAttribute[] = [];
  for (const s of specs) {
    const semantic = attributeSemantic(s);
    const hit = out.find((o) => sameAttribute(o, s));
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
    const hit = next.find((s) => sameAttribute(s, e));
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

export interface SpecKeySummary {
  key: string;
  label: string;
  count: number;
  discoveredBy: SpecAttribute["discoveredBy"];
  /** Consensus display of the value across every claim on every system carrying this key. */
  value: string;
  /** Distinct sources that stated a value for this attribute. */
  sources: number;
  /** Dominant source (most claims), for grouping/provenance. */
  source: string;
  disputed: boolean;
}

export function allSpecKeys(drones: Drone[]): SpecKeySummary[] {
  // Aggregate claims across all systems so consensus can be computed per attribute, not per drone.
  const m = new Map<
    string,
    {
      label: string;
      count: number;
      discoveredBy: SpecAttribute["discoveredBy"];
      claims: SpecClaim[];
      unit?: string;
      semantic?: string;
    }
  >();
  drones.forEach((d) =>
    d.specs.forEach((s) => {
      const cur = m.get(s.key);
      if (cur) {
        cur.count += 1;
        cur.claims.push(...s.claims);
        if (cur.discoveredBy !== "seed" && s.discoveredBy === "seed") cur.discoveredBy = "seed";
      } else {
        m.set(s.key, {
          label: s.label,
          count: 1,
          discoveredBy: s.discoveredBy,
          claims: [...s.claims],
          ...(s.unit ? { unit: s.unit } : {}),
          ...(s.semantic ? { semantic: s.semantic } : {}),
        });
      }
    }),
  );
  return [...m.entries()].map(([key, v]) => {
    const spec: SpecAttribute = {
      key,
      label: v.label,
      claims: v.claims,
      discoveredBy: v.discoveredBy,
      ...(v.unit ? { unit: v.unit } : {}),
      ...(v.semantic ? { semantic: v.semantic } : {}),
    };
    const c = consensus(spec);
    const srcCounts = new Map<string, number>();
    for (const cl of v.claims) srcCounts.set(cl.source, (srcCounts.get(cl.source) ?? 0) + 1);
    const dominant = [...srcCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
    return {
      key,
      label: v.label,
      count: v.count,
      discoveredBy: v.discoveredBy,
      value: c.display,
      sources: c.sources,
      source: dominant,
      disputed: c.disputed,
    };
  });
}
