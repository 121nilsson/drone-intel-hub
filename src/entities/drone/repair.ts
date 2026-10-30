import { countryCode, countryCodes } from "@/entities/normalization/country";
import { canonicalUnitForSemantic, semanticKeyFor } from "@/entities/normalization/semantic";
import { isFinancialSpec } from "@/entities/procurement/routing";
import { regroup, sameAttribute } from "./spec-engine";
import type { Drone, SpecAttribute } from "./types";

/**
 * Brings a stored entry up to the rules new reporting is read with. The ingest boundary only
 * sees new posts, so a rule fixed there leaves every older record as it was: a semantic
 * resolved by a rule since narrowed, a contract value filed before routing existed, "UK" next to
 * GB. This applies the current rules to what is stored, and is a no-op on an entry they already
 * describe - so it can run on every sync and each later rule fix heals old data too.
 *
 * Nothing an analyst decided is touched: an attribute an analyst added or ruled on stays a spec
 * even when its key now reads as a deal figure, because their call outranks the router's.
 */

export type RepairKind = "semantic" | "merged" | "financial" | "country";

export interface RepairChange {
  kind: RepairKind;
  detail: string;
}

export interface DroneRepair {
  drone: Drone;
  /** Deal figures taken out of the specs, for the caller to file as procurement records. */
  financial: SpecAttribute[];
  changes: RepairChange[];
}

const analystOwned = (s: SpecAttribute) =>
  s.discoveredBy === "analyst" || s.claims.some((c) => c.review || c.movedFrom);

/** The stored semantic re-read with today's rules, carrying the canonical unit along with it. */
function resolved(s: SpecAttribute): SpecAttribute {
  // A semantic never stored is resolved on every read already (attributeSemantic).
  if (!s.semantic || s.semantic === s.key) return s;
  const fresh = semanticKeyFor(s.key, s.label);
  if (fresh === s.semantic) return s;
  const next: SpecAttribute = { ...s };
  if (fresh === s.key) delete next.semantic;
  else next.semantic = fresh;
  // Only a unit the old semantic implied moves with it; one normalization set ("USD") stays.
  if (s.canonicalUnit && s.canonicalUnit === canonicalUnitForSemantic(s.semantic)) {
    const unit = canonicalUnitForSemantic(fresh);
    if (unit) next.canonicalUnit = unit;
    else delete next.canonicalUnit;
  }
  return next;
}

const hasDuplicates = (specs: readonly SpecAttribute[]) =>
  specs.some((a, i) => specs.slice(i + 1).some((b) => sameAttribute(a, b)));

export function repairDrone(drone: Drone): DroneRepair {
  const changes: RepairChange[] = [];
  const financial: SpecAttribute[] = [];

  const origin = drone.origin ? countryCode(drone.origin) : drone.origin;
  const stated = drone.operators ?? [];
  const operators = countryCodes(stated);
  const operatorsChanged =
    operators.length !== stated.length || operators.some((o, i) => o !== stated[i]);
  if (origin !== drone.origin)
    changes.push({ kind: "country", detail: `origin ${drone.origin} → ${origin}` });
  if (operatorsChanged)
    changes.push({
      kind: "country",
      detail: `operators ${stated.join(", ")} → ${operators.join(", ")}`,
    });

  let specs: SpecAttribute[] = [];
  for (const s of drone.specs) {
    if (isFinancialSpec(s) && !analystOwned(s)) {
      financial.push(s);
      changes.push({ kind: "financial", detail: `${s.label} (${s.key}) → procurement` });
      continue;
    }
    const r = resolved(s);
    if (r !== s)
      changes.push({
        kind: "semantic",
        detail: `${s.label} (${s.key}): ${s.semantic} → ${r.semantic ?? "unresolved"}`,
      });
    specs.push(r);
  }

  if (hasDuplicates(specs)) {
    // The rows regroup folds: each joins the first earlier row that is the same attribute.
    const folded = specs.filter((s, i) => specs.slice(0, i).some((o) => sameAttribute(o, s)));
    for (const s of folded)
      changes.push({ kind: "merged", detail: `${s.label} (${s.key}) folded into its attribute` });
    specs = regroup(specs);
  }

  if (!changes.length) return { drone, financial, changes };
  return {
    drone: { ...drone, origin, operators, specs },
    financial,
    changes,
  };
}
