import { countryCode, countryCodes } from "@/entities/normalization/country";
import { canonicalUnitForSemantic, semanticKeyFor } from "@/entities/normalization/semantic";
import { isDealFigure, isFinancialSpec } from "@/entities/procurement/routing";
import { attributeSemantic, regroup, sameAttribute } from "./spec-engine";
import { canonicalUnitFor } from "@/entities/normalization/units";
import { activityFromStoredSpec, isActivitySpec, withActivity } from "./activity";
import type { Drone, SpecAttribute, SpecClaim } from "./types";
import { cue } from "@/shared/lexicons";
import { originProposal } from "./origin-audit";

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

export type RepairKind =
  "semantic" | "merged" | "financial" | "country" | "activity" | "speed" | "origin";

const CRUISE = new RegExp(cue("cruiseSpeed"), "iu");

/**
 * A plain "speed" attribute labelled "Cruise speed": the seed wrote two that way, and the old
 * heuristic filed every unqualified speed under that label (21 right, 99 wrong). The label made
 * the attribute read as cruise speed, so every plain speed that joined it later was counted as
 * one - "a speed of up to 500 km/h" as a cruise speed of 500.
 */
const mislabelledCruise = (s: SpecAttribute) => s.key === "speed" && /cruis/i.test(s.label);

/**
 * Which claims of such an attribute really are cruise speeds: a claim whose words say cruise, a
 * claim with no words to read (a seed figure, filed as cruise by whoever entered it), and one an
 * analyst ruled on or moved there. The rest are plain speeds and leave under "Speed".
 */
const stillCruise = (c: SpecClaim) =>
  !!c.review ||
  !!c.movedFrom ||
  !(c.evidence?.trim() || c.raw?.trim()) ||
  CRUISE.test(`${c.evidence ?? ""} ${c.raw ?? ""}`);

/** One attribute as a new key and label, its semantic and unit resolved for them. */
function asAttribute(s: SpecAttribute, key: string, label: string, claims: SpecClaim[]) {
  const semantic = semanticKeyFor(key, label);
  const next: SpecAttribute = { ...s, key, label, claims };
  if (semantic === key) delete next.semantic;
  else next.semantic = semantic;
  const unit = canonicalUnitForSemantic(semantic);
  if (unit) next.canonicalUnit = unit;
  return next;
}

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

/**
 * The canonical unit an attribute stores, moved to the one its meaning now uses, within the same
 * dimension only: calibres were stored in metres before they were millimetres. A unit of another
 * dimension, or one normalization set for money ("USD"), is not this rule's to change.
 */
function unitResolved(s: SpecAttribute): SpecAttribute {
  const semantic = attributeSemantic(s);
  const have = s.canonicalUnit;
  // A count stored with the kilogram its "payload." prefix once implied ("Number of missiles",
  // kg). Only that unit is dropped: one the source gave ("engines", hp) says the attribute is
  // something else, which is not this rule's to decide.
  if (semantic.endsWith(".count") && have === "kg") {
    const { canonicalUnit: _dropped, unit, ...rest } = s;
    return unit && canonicalUnitFor(unit) !== "kg" ? { ...rest, unit } : rest;
  }
  const want = canonicalUnitForSemantic(semantic);
  if (!want || !have || have === want) return s;
  const dim = canonicalUnitFor(have);
  if (!dim || dim !== canonicalUnitFor(want)) return s;
  return { ...s, canonicalUnit: want };
}

const hasDuplicates = (specs: readonly SpecAttribute[]) =>
  specs.some((a, i) => specs.slice(i + 1).some((b) => sameAttribute(a, b)));

/**
 * `publishedFor` finds when a claim's post was published, so a repaired activity figure's month
 * without a year is placed by the post and not by when it was read.
 */
export function repairDrone(
  drone: Drone,
  publishedFor?: (claim: SpecClaim) => string | undefined,
): DroneRepair {
  const changes: RepairChange[] = [];
  const financial: SpecAttribute[] = [];

  // An unknown origin the reports agree on is filled; one they contradict is only proposed.
  const fill = originProposal(drone);
  const origin =
    fill?.kind === "fill" ? fill.country : drone.origin ? countryCode(drone.origin) : drone.origin;
  const stated = drone.operators ?? [];
  const operators = countryCodes(stated);
  const operatorsChanged =
    operators.length !== stated.length || operators.some((o, i) => o !== stated[i]);
  if (fill?.kind === "fill")
    changes.push({
      kind: "origin",
      detail: `origin ${drone.origin} → ${origin}: ${fill.support} report(s) agree, none disagree`,
    });
  else if (origin !== drone.origin)
    changes.push({ kind: "country", detail: `origin ${drone.origin} → ${origin}` });
  if (operatorsChanged)
    changes.push({
      kind: "country",
      detail: `operators ${stated.join(", ")} → ${operators.join(", ")}`,
    });

  let specs: SpecAttribute[] = [];
  let activity = drone.activity;
  for (let s of drone.specs) {
    if (isFinancialSpec(s) && !analystOwned(s)) {
      financial.push(s);
      changes.push({ kind: "financial", detail: `${s.label} (${s.key}) → procurement` });
      continue;
    }
    // An activity figure stored before activity existed: it moves out of the specs, every claim
    // becoming a record, so "Launch Volume (June)" stops being an attribute of the system.
    if (isActivitySpec(s) && !analystOwned(s)) {
      activity = withActivity(activity, activityFromStoredSpec(s, publishedFor));
      changes.push({ kind: "activity", detail: `${s.label} (${s.key}) → activity` });
      continue;
    }
    if (mislabelledCruise(s) && s.discoveredBy !== "analyst") {
      const cruise = s.claims.filter(stillCruise);
      const plain = s.claims.filter((c) => !stillCruise(c));
      changes.push({
        kind: "speed",
        detail: `${s.label} (${s.key}): ${plain.length} plain speed(s) → Speed, ${cruise.length} kept as cruise speed`,
      });
      // Both go through the rest of the loop's rules on the next run; the fold below joins each
      // to an attribute of the same meaning already on the entry.
      if (cruise.length) specs.push(asAttribute(s, "cruise_speed", "Cruise speed", cruise));
      if (plain.length) specs.push(asAttribute(s, "speed", "Speed", plain));
      continue;
    }
    // A sale total read as a unit price leaves claim by claim: the attribute keeps real prices.
    const deals = s.claims.filter(
      (c) => !c.review && !c.movedFrom && isDealFigure({ key: s.key, evidence: c.evidence ?? "" }),
    );
    if (deals.length && s.discoveredBy !== "analyst") {
      financial.push({ ...s, claims: deals });
      changes.push({
        kind: "financial",
        detail: `${deals.length} deal figure(s) in ${s.label} (${s.key}) → procurement`,
      });
      const rest = s.claims.filter((c) => !deals.includes(c));
      if (!rest.length) continue;
      s = { ...s, claims: rest };
    }
    const r = resolved(s);
    if (r !== s)
      changes.push({
        kind: "semantic",
        detail: `${s.label} (${s.key}): ${s.semantic} → ${r.semantic ?? "unresolved"}`,
      });
    const u = unitResolved(r);
    if (u !== r)
      changes.push({
        kind: "semantic",
        detail: `${s.label} (${s.key}): canonical unit ${r.canonicalUnit} → ${u.canonicalUnit ?? "none"}`,
      });
    specs.push(u);
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
    drone: { ...drone, origin, operators, specs, ...(activity ? { activity } : {}) },
    financial,
    changes,
  };
}
