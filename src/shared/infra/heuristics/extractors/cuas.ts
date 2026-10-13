import { cue, unit } from "../lexicons";
import { type AddSpec, measureCue } from "./common";

/** Jammers, domes and handheld guns: output power and suppression radius. */
export function extractCuas(raw: string, add: AddSpec) {
  measureCue(raw, add, {
    cue: cue("jammingPower"),
    units: [
      [unit("kilowatt"), "kW"],
      [unit("watt"), "W"],
    ],
    key: "jamming_power",
    label: "Jamming power",
  });
  measureCue(raw, add, {
    cue: cue("suppressionRadius"),
    units: [
      [unit("km"), "km"],
      [unit("m"), "m"],
    ],
    key: "suppression_radius",
    label: "Suppression radius",
  });
}
