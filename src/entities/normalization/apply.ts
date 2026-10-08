import type { ExtractedSpec, Extraction, RFLink, RFRole } from "@/entities/drone/types";
import { parseMoney } from "./currency";
import { normalizeRF, intersectBands, type NormalizedRFLink, type NormalizedRFRole } from "./rf";
import { canonicalUnitForSemantic, semanticKeyFor } from "./semantic";
import { resolveTerm, SEEDED_TERMS, type TaxonomyTerm } from "./taxonomy";
import { normalizeQuantity, rebaseQuantity } from "./units";

export interface UnknownTerm {
  taxonomy: string;
  rawTerm: string;
}

export interface NormalizedExtraction {
  extraction: Extraction;
  unknowns: UnknownTerm[];
}

const ROLES: readonly NormalizedRFRole[] = [
  "uplink",
  "downlink",
  "video",
  "gnss",
  "antijam",
  "telemetry",
  "tether",
  "unknown",
];

function asRole(role: NormalizedRFRole): RFRole {
  return ROLES.includes(role) ? role : "unknown";
}

export function toRFLink(link: NormalizedRFLink): RFLink {
  return {
    role: asRole(link.role),
    band: link.raw,
    ...(link.freqMHz ? { freqMHz: link.freqMHz } : {}),
    ...(link.ieeeBands.length ? { ieeeBands: link.ieeeBands } : {}),
    ...(link.natoBands.length ? { natoBands: link.natoBands } : {}),
    ...(link.protocols?.length ? { protocols: link.protocols } : {}),
    ...(link.isFiberOptic ? { isFiberOptic: true } : {}),
    confidence: link.confidence,
    ...(link.tacticalTag ? { tacticalTag: link.tacticalTag } : {}),
  };
}

/** Same role and either the same raw band or an overlapping frequency. Different roles stay distinct. */
export function sameRfLink(a: RFLink, b: RFLink): boolean {
  if (a.role !== b.role) return false;
  if (a.band.trim().toLowerCase() === b.band.trim().toLowerCase()) return true;
  return !!(a.freqMHz && b.freqMHz && intersectBands(a.freqMHz, b.freqMHz));
}

export function mergeLinks(existing: RFLink[], incoming: RFLink[]): RFLink[] {
  const rf = existing.map((link) => ({ ...link }));
  for (const link of incoming) {
    const hit = rf.find((r) => sameRfLink(r, link));
    if (!hit) {
      rf.push(link);
      continue;
    }
    if (!hit.freqMHz && link.freqMHz) hit.freqMHz = link.freqMHz;
    if (!hit.ieeeBands?.length && link.ieeeBands?.length) hit.ieeeBands = link.ieeeBands;
    if (!hit.natoBands?.length && link.natoBands?.length) hit.natoBands = link.natoBands;
    if (!hit.protocols?.length && link.protocols?.length) hit.protocols = link.protocols;
    if (link.isFiberOptic) hit.isFiberOptic = true;
  }
  return rf;
}

function normalizeSpec(spec: ExtractedSpec): ExtractedSpec {
  const semantic = semanticKeyFor(spec.key, spec.label);
  const money = semantic === "cost.unit" && typeof spec.value === "string" ? parseMoney(spec.value) : undefined;
  const targetUnit = canonicalUnitForSemantic(semantic);
  let measured =
    typeof spec.value === "string"
      ? normalizeQuantity(spec.value)
      : spec.unit
        ? normalizeQuantity(`${spec.value} ${spec.unit}`)
        : undefined;
  if (measured && targetUnit) measured = rebaseQuantity(measured, targetUnit);
  return {
    ...spec,
    semantic,
    ...(targetUnit ? { canonicalUnit: targetUnit } : {}),
    ...(typeof spec.value === "string" ? { raw: spec.value } : {}),
    ...(measured ? { normalized: measured } : {}),
    ...(money ? { money } : {}),
  };
}

function classify(
  raw: string | undefined,
  taxonomy: string,
  terms: readonly TaxonomyTerm[],
): { id?: string; unknown?: UnknownTerm } {
  const text = raw?.trim() ?? "";
  if (!text || /^unknown$/i.test(text)) return {};
  const hit = resolveTerm(text, taxonomy, terms);
  if (hit.canonicalId) return { id: hit.canonicalId };
  if (taxonomy === "propulsion") return { unknown: { taxonomy, rawTerm: text } };
  if (hit.ambiguous) return { unknown: { taxonomy, rawTerm: text } };
  return {};
}

/**
 * Pure projection of an extraction. A second call deep-equals the first.
 * Unknown propulsion strings are returned to the caller; nothing is persisted here.
 */
export function normalizeExtraction(
  extraction: Extraction,
  terms: readonly TaxonomyTerm[] = SEEDED_TERMS,
): NormalizedExtraction {
  const propulsion = classify(extraction.propulsion, "propulsion", terms);
  const installation = classify(extraction.installation, "installation", terms);
  const unknowns = [propulsion.unknown, installation.unknown].filter((u): u is UnknownTerm => !!u);
  const rf = extraction.rfBands.map((band) => normalizeRF(band));
  return {
    extraction: {
      ...extraction,
      specs: extraction.specs.map(normalizeSpec),
      rf,
      ...(propulsion.id ? { propulsionId: propulsion.id } : {}),
      ...(installation.id ? { installationId: installation.id } : {}),
    },
    unknowns,
  };
}
