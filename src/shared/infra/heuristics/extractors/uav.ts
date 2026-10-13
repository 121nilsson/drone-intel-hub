import { cue, unit } from "../lexicons";
import { type AddSpec, measureCue } from "./common";

/** Counter-drone envelope cues; a vehicle's own range/altitude must not swallow these. */
const ENVELOPE = new RegExp(
  [cue("engagementRange"), cue("detectionRange"), cue("suppressionRadius"), cue("targetAltitude")].join(
    "|",
  ),
  "iu",
);

/** Airframe performance: speed, range, endurance, ceiling, wingspan - every registered language. */
export function extractUav(raw: string, add: AddSpec) {
  measureCue(raw, add, {
    cue: `${cue("speed")}|`,
    units: [[unit("kmh"), "km/h"]],
    key: "speed",
    label: "Cruise speed",
    gap: 16,
    notAfter: new RegExp(cue("targetSpeed"), "iu"),
  });
  measureCue(raw, add, {
    cue: cue("range"),
    units: [[unit("km"), "km"]],
    key: "range",
    label: "Range",
    notAfter: ENVELOPE,
  });
  measureCue(raw, add, {
    cue: cue("endurance"),
    units: [
      [unit("hours"), "h"],
      [unit("minutes"), "min"],
    ],
    key: "endurance",
    label: "Endurance",
  });
  measureCue(raw, add, {
    cue: cue("altitude"),
    units: [[unit("km"), "km"]],
    key: "altitude",
    label: "Maximum altitude",
    notAfter: ENVELOPE,
  });
  measureCue(raw, add, {
    cue: cue("wingspan"),
    units: [[unit("m"), "m"]],
    key: "wingspan",
    label: "Wingspan",
    gap: 16,
  });
}
