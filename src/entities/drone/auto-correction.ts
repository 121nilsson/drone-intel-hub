import { ANALYST_SOURCE } from "./claim-review";
import { rawPoint } from "./consensus";
import { attributeSemantic } from "./spec-engine";
import type { AutoCorrection, SpecAttribute, SpecClaim } from "./types";

/**
 * Deterministic correction of single claims, without waiting for a dispute and without a model.
 * Two things are recognisably wrong with a figure on its own:
 *
 * - a UNIT SLIP: the reading sits off what the other sources agree on by exactly the factor
 *   between two units (40 "km" against 40 000 m elsewhere is ×1000; 30 "km/h" against 108 is the
 *   ×3.6 of m/s). A coincidental ratio that close to a conversion factor is rare; a slip is not.
 * - an IMPLAUSIBLE figure: outside what any system of this kind can do (a 40 000 km FPV range).
 *   With no other sources to compare against, a figure ×1000 out of bounds whose ÷1000 lands
 *   inside is read as a unit slip as well - the m/km and g/kg slips are the common ones.
 *
 * Detection only proposes. Whether a proposal is applied is decided elsewhere, from how often
 * analysts have agreed with that kind of correction (shared/infra/ingest/auto-correct.ts).
 */

/**
 * Factors a reading slips by, per unit consensus measures in. The first is the most common slip,
 * the only one tried against bounds alone.
 */
export const UNIT_SLIPS: Readonly<Record<string, readonly number[]>> = {
  // m read as km; miles; nautical miles; feet read as metres (altitudes).
  km: [1000, 1.609344, 1.852, 3.28084],
  // m/s read as km/h; mph; knots.
  "km/h": [3.6, 1.609344, 1.852],
  // g read as kg; pounds.
  kg: [1000, 2.20462],
  // hours read as minutes.
  min: [60],
  // mm, cm, feet.
  m: [1000, 100, 3.28084],
  // kW, horsepower.
  W: [1000, 745.7],
};

/** Others within this of their median agree; a claim within it of theirs agrees with them. */
export const AGREEMENT_SPREAD = 0.25;
/** How close the ratio must come to a factor to be read as a slip. */
export const SLIP_TOLERANCE = 0.04;
/** Distinct other sources that must agree before their figure can correct one claim. */
export const MIN_AGREEING_SOURCES = 2;

interface Bounds {
  min: number;
  max: number;
  unit: string;
}

const RANGE: Bounds = { min: 0.1, max: 25_000, unit: "km" };
const SPEED: Bounds = { min: 1, max: 4_000, unit: "km/h" };
const ALTITUDE: Bounds = { min: 0.01, max: 35, unit: "km" };
const WEIGHT: Bounds = { min: 0.02, max: 60_000, unit: "kg" };
const PAYLOAD: Bounds = { min: 0.005, max: 20_000, unit: "kg" };
const ENDURANCE: Bounds = { min: 1, max: 100_000, unit: "min" };

/**
 * What no unmanned system in the catalog's scope does, per measurement. Deliberately generous:
 * a bound only has to catch the absurd, and a class-specific limit would wrongly flag the long
 * tail (a HALE drone's 20 000 km, a solar glider's 60-day endurance). Minimums only on
 * measurements where a tiny figure is a misreading, not a short-range system.
 */
export const PLAUSIBLE: Readonly<Record<string, Bounds>> = {
  "range.max": RANGE,
  "range.operational": RANGE,
  "range.combat": RANGE,
  "range.combat_radius": RANGE,
  "range.ferry": RANGE,
  "speed.max": SPEED,
  "speed.cruise": SPEED,
  "speed.dive": SPEED,
  "altitude.max": ALTITUDE,
  "altitude.service_ceiling": ALTITUDE,
  "weight.mtow": WEIGHT,
  "weight.launch": WEIGHT,
  "weight.empty": WEIGHT,
  "weight.total": WEIGHT,
  "payload.capacity": PAYLOAD,
  "payload.mass": PAYLOAD,
  "payload.warhead": PAYLOAD,
  endurance: ENDURANCE,
  "endurance.flight": ENDURANCE,
};

const clean = (n: number) => Number(n.toPrecision(6));

/**
 * A claim another claim can be measured against: one nobody has ruled out, and not itself a
 * correction, so one corrected figure cannot vouch for the next.
 */
function independent(c: SpecClaim): boolean {
  if (c.review) return c.review.verdict === "confirmed";
  if (c.autoCorrection?.applied) return false;
  return c.adjudication?.verdict !== "outlier";
}

/** The figure the other sources agree on, when at least two of them do. */
function agreedFigure(spec: SpecAttribute, i: number, unit: string | undefined) {
  const target = spec.claims[i]!;
  const others = spec.claims.flatMap((c, j) => {
    if (j === i || c.source === target.source || !independent(c)) return [];
    const p = rawPoint(spec, c);
    return p && p.unit === unit && p.value > 0 ? [{ value: p.value, source: c.source }] : [];
  });
  if (new Set(others.map((o) => o.source)).size < MIN_AGREEING_SOURCES) return undefined;
  const values = others.map((o) => o.value).sort((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)]!;
  return (values[values.length - 1]! - values[0]!) / median <= AGREEMENT_SPREAD
    ? median
    : undefined;
}

/** The factor (or its inverse) the ratio matches most closely, within SLIP_TOLERANCE. */
function slipFactor(ratio: number, unit: string): number | undefined {
  let best: { g: number; err: number } | undefined;
  for (const f of UNIT_SLIPS[unit] ?? [])
    for (const g of [f, 1 / f]) {
      const err = Math.abs(ratio * g - 1);
      if (err <= SLIP_TOLERANCE && (!best || err < best.err)) best = { g, err };
    }
  return best?.g;
}

const within = (v: number, b: Bounds) => v >= b.min && v <= b.max;

/**
 * What is wrong with claim `i` of `spec`, if anything. Never flags a hand-entered analyst value,
 * text, or a range. A figure the other sources disagree with by no conversion factor is left
 * alone: that is a dispute, and the contradiction check's question.
 */
export function detectCorrection(
  spec: SpecAttribute,
  i: number,
  at: string,
): AutoCorrection | undefined {
  const c = spec.claims[i];
  if (!c || c.source === ANALYST_SOURCE || c.extractionEngine === "analyst") return undefined;
  const p = rawPoint(spec, c);
  if (!p || !(p.value > 0) || !p.unit) return undefined;

  const agreed = agreedFigure(spec, i, p.unit);
  if (agreed !== undefined) {
    const ratio = p.value / agreed;
    if (Math.abs(ratio - 1) <= AGREEMENT_SPREAD) return undefined;
    const g = slipFactor(ratio, p.unit);
    if (g !== undefined)
      return {
        kind: "unit",
        basis: "consensus",
        value: clean(p.value * g),
        unit: p.unit,
        factor: clean(g),
        applied: false,
        at,
      };
  }

  const bounds = PLAUSIBLE[attributeSemantic(spec)];
  if (!bounds || bounds.unit !== p.unit || within(p.value, bounds)) return undefined;
  const primary = UNIT_SLIPS[p.unit]?.[0];
  if (agreed === undefined && primary !== undefined) {
    for (const g of [primary, 1 / primary])
      if (within(p.value * g, bounds))
        return {
          kind: "unit",
          basis: "bounds",
          value: clean(p.value * g),
          unit: p.unit,
          factor: clean(g),
          applied: false,
          at,
        };
  }
  return { kind: "implausible", basis: "bounds", applied: false, at };
}

/** The trust record a correction is counted under: kind and basis carry different evidence. */
export const correctionKey = (fix: Pick<AutoCorrection, "kind" | "basis">) =>
  `${fix.kind}:${fix.basis}`;

/** Same finding, ignoring when it was made and whether it is applied. */
export function sameFinding(a: AutoCorrection | undefined, b: AutoCorrection | undefined) {
  if (!a || !b) return a === b;
  return (
    a.kind === b.kind &&
    a.basis === b.basis &&
    a.value === b.value &&
    a.unit === b.unit &&
    a.factor === b.factor
  );
}
