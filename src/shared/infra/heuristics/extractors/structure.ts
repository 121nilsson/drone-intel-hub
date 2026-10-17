import { cue, unit } from "@/shared/lexicons";
import type { Lexicon } from "@/shared/lexicons";
import { measureCue, type AddSpec } from "./common";

/**
 * Airframe / hull structure common to every system class: weights, payload, warhead and
 * dimensions. Cue→number by default; warhead and dimensions also accept number→cue
 * ("50 kg warhead", "12 m long"), which stops at sentence boundaries (see measureCue).
 */
const WEIGHTS: Array<[keyof Lexicon["cues"], string, string]> = [
  ["weightMtow", "weight_mtow", "Maximum takeoff weight"],
  ["weightEmpty", "weight_empty", "Empty weight"],
  ["weightLaunch", "weight_launch", "Launch weight"],
  ["payload", "payload", "Payload capacity"],
];

const DIMENSIONS: Array<[keyof Lexicon["cues"], string, string]> = [
  ["length", "length", "Length"],
  ["height", "height", "Height"],
  ["width", "width", "Width"],
  ["diameter", "diameter", "Diameter"],
];

export function extractStructure(raw: string, add: AddSpec) {
  const kg: Array<[string, string]> = [[unit("kg"), "kg"]];
  for (const [cueKey, key, label] of WEIGHTS)
    measureCue(raw, add, { cue: cue(cueKey), units: kg, key, label, gap: 20 });

  // "має запас пального 15 л" / "fuel capacity of 15 L" - tank volume, not a mass.
  const liters: Array<[string, string]> = [[unit("liters"), "l"]];
  measureCue(raw, add, {
    cue: cue("fuelCapacity"),
    units: liters,
    key: "fuel_capacity",
    label: "Fuel capacity",
  });

  for (const order of ["before", "after"] as const)
    measureCue(raw, add, {
      cue: cue("warhead"),
      units: kg,
      key: "warhead",
      label: "Warhead weight",
      gap: 20,
      order,
    });

  const m: Array<[string, string]> = [[unit("m"), "m"]];
  for (const [cueKey, key, label] of DIMENSIONS)
    for (const order of ["before", "after"] as const)
      measureCue(raw, add, { cue: cue(cueKey), units: m, key, label, gap: 16, order });
}
