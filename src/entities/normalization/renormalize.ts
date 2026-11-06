import { ANALYST_SOURCE } from "@/entities/drone/claim-review";
import type { SpecAttribute, SpecClaim } from "@/entities/drone/types";
import { canonicalUnitForSemantic, semanticKeyFor } from "./semantic";
import { normalizeQuantityLoose, rebaseQuantity } from "./units";

/**
 * The quantity a stored claim states, read the way a new extraction is read (`normalizeSpec` in
 * apply.ts), for a claim saved before its value was parsed or by a parser that missed it.
 *
 * `normalized` is what consensus compares, so a claim without it is compared by its bare number.
 * Only a claim that has none and states a measurable value gets one; an analyst's claim is left as
 * the person wrote it, and a claim that already has a reading keeps it, so running this twice
 * changes nothing the second time.
 */
export function renormalizeClaim(
  spec: Pick<SpecAttribute, "key" | "label" | "unit">,
  claim: SpecClaim,
): SpecClaim {
  if (claim.normalized) return claim;
  if (claim.source === ANALYST_SOURCE || claim.extractionEngine === "analyst") return claim;
  const stated = claim.value;
  let measured =
    typeof stated === "string"
      ? (normalizeQuantityLoose(stated) ??
        (spec.unit ? normalizeQuantityLoose(`${stated} ${spec.unit}`) : undefined))
      : spec.unit
        ? normalizeQuantityLoose(`${stated} ${spec.unit}`)
        : undefined;
  if (!measured) return claim;
  const target = canonicalUnitForSemantic(semanticKeyFor(spec.key, spec.label));
  if (target) measured = rebaseQuantity(measured, target);
  return { ...claim, normalized: measured };
}

/** `renormalizeClaim` for every claim of a spec; the spec itself is returned when none changed. */
export function renormalizeSpec<S extends SpecAttribute>(spec: S): S {
  let changed = false;
  const claims = spec.claims.map((c) => {
    const next = renormalizeClaim(spec, c);
    if (next !== c) changed = true;
    return next;
  });
  return changed ? { ...spec, claims } : spec;
}
