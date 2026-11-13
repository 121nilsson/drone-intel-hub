import { claimSourceUnit } from "@/entities/normalization/claim-source-unit";
import { canonicalUnitForSemantic, semanticKeyFor } from "@/entities/normalization/semantic";
import { canonicalUnitFor } from "@/entities/normalization/units";
import { ANALYST_SOURCE } from "./claim-review";
import type { SpecAttribute, SpecClaim } from "./types";

/**
 * Whether a claim's figure may be read as a number in its attribute's unit.
 *
 * A figure with no unit evidenced for it ("105" under a kg attribute) cannot be told from 105 lb,
 * and the difference is a factor of 2.2. It stays on the record with its text, but it is not
 * aggregated and its unit check is "uncertain", not a pass: better a visible "unit unknown" than a
 * number that looks exact and is not.
 *
 *   evidenced   the unit is in the value text or the quote (claimSourceUnit)
 *   declared    a person or a curated source gave the unit with the figure: an analyst's own entry,
 *               the seed catalogue (the unit is set once on its attribute), a structured reference
 *               import. Nobody read it off a post, so there is no text to evidence it against.
 *   not_needed  the attribute has no unit to get wrong, or the value is not a figure
 *   unverified  only the extractor says what the unit is; nothing in the text confirms it
 *   unknown     no unit anywhere
 *   conflict    the extractor's unit and the text's disagree
 */
export type UnitStanding =
  "evidenced" | "declared" | "not_needed" | "unverified" | "unknown" | "conflict";

/** The semantic as spec-engine's attributeSemantic reads it, without importing spec-engine. */
function semanticOf(spec: Pick<SpecAttribute, "key" | "label" | "semantic">): string {
  return spec.semantic && spec.semantic !== spec.key
    ? spec.semantic
    : semanticKeyFor(spec.key, spec.label);
}

/** The unit an attribute is measured in, as the catalogue normalizes it. */
export function expectedUnit(spec: SpecAttribute): string | undefined {
  const semantic = semanticOf(spec);
  // A semantic the catalogue knows ("cost.unit", "launcher.count") decides for itself: when it has
  // no unit, a canonicalUnit stored on the spec is a leftover (a price once stored as "km"), not
  // the attribute's unit. Only a raw, unresolved key falls back to what the spec says.
  if (semantic.includes(".")) return canonicalUnitForSemantic(semantic);
  return (
    canonicalUnitForSemantic(semantic) ??
    spec.canonicalUnit ??
    (spec.unit ? canonicalUnitFor(spec.unit) : undefined)
  );
}

const isFigure = (claim: SpecClaim) =>
  typeof claim.value === "number" || /\d/.test(String(claim.value));

const declaredByPerson = (claim: SpecClaim) =>
  claim.source === ANALYST_SOURCE ||
  claim.extractionEngine === "analyst" ||
  claim.extractionEngine === "reference" ||
  (claim.id?.startsWith("seed:") ?? false);

export function unitStanding(spec: SpecAttribute, claim: SpecClaim): UnitStanding {
  if (!expectedUnit(spec) || !isFigure(claim)) return "not_needed";
  const source = claimSourceUnit(claim);
  // A conflict is a conflict whoever entered the figure.
  if (source.basis === "conflict") return "conflict";
  if (source.basis === "value_text" || source.basis === "quote") return "evidenced";
  if (declaredByPerson(claim)) return "declared";
  return source.basis === "extractor_unverified" ? "unverified" : "unknown";
}

/** Whether the figure may be aggregated and compared as a number. */
export const feedsNumbers = (standing: UnitStanding): boolean =>
  standing === "evidenced" || standing === "declared" || standing === "not_needed";
