import { cue, unit } from "@/shared/lexicons";
import { ENVELOPE, type AddSpec, measureCue } from "./common";

/** Airframe performance: speed, range, endurance, ceiling, wingspan - every registered language. */
export function extractUav(raw: string, add: AddSpec) {
  // A stated top speed, in whatever unit the report used; normalization converts it.
  measureCue(raw, add, {
    cue: cue("maxSpeed"),
    units: [
      [unit("kmh"), "km/h"],
      [unit("knots"), "kn"],
      [unit("mph"), "mph"],
      [unit("mach"), "Mach"],
    ],
    key: "max_speed",
    label: "Maximum speed",
    gap: 16,
    notAfter: new RegExp(cue("targetSpeed"), "iu"),
  });
  measureCue(raw, add, {
    cue: cue("cruiseSpeed"),
    units: [
      [unit("kmh"), "km/h"],
      [unit("knots"), "kn"],
      [unit("mph"), "mph"],
    ],
    key: "cruise_speed",
    label: "Cruise speed",
    gap: 16,
    notAfter: new RegExp(cue("targetSpeed"), "iu"),
  });
  // A speed the report gives without saying top or cruise is read as just that - with or without
  // a cue, since km/h is a speed whatever precedes it ("reached 600 km/h"). Filing every such
  // figure as cruise made the cruise figure wrong far more often than right (21 correct, 99 not,
  // measured over the stored reports).
  measureCue(raw, add, {
    cue: `${cue("speed")}|`,
    units: [[unit("kmh"), "km/h"]],
    key: "speed",
    label: "Speed",
    gap: 16,
    notAfter: new RegExp(`${cue("targetSpeed")}|${cue("maxSpeed")}|${cue("cruiseSpeed")}`, "iu"),
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
      [unit("days"), "d"],
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
