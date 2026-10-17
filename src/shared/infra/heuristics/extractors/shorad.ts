import { cue, unit } from "@/shared/lexicons";
import { type AddSpec, NUMBER, END, measureCue, num } from "./common";

/** Mobile air defence and radars: engagement envelope, detection range, target channels. */
export function extractShorad(raw: string, add: AddSpec) {
  const dist: Array<[string, string]> = [
    [unit("km"), "km"],
    [unit("m"), "m"],
  ];
  measureCue(raw, add, {
    cue: cue("engagementRange"),
    units: dist,
    key: "engagement_range",
    label: "Engagement range",
  });
  measureCue(raw, add, {
    cue: cue("detectionRange"),
    units: dist,
    key: "detection_range",
    label: "Detection range",
  });
  measureCue(raw, add, {
    cue: cue("targetAltitude"),
    units: dist,
    key: "target_altitude_max",
    label: "Maximum target altitude",
  });
  measureCue(raw, add, {
    cue: cue("targetSpeed"),
    units: [
      [unit("kmh"), "km/h"],
      ["m\\/s", "m/s"],
    ],
    key: "target_speed_max",
    label: "Target speed",
  });
  // "4 target channels" / "up to 4 simultaneous targets" - number before or after the cue.
  const ch = cue("targetChannels");
  for (const re of [
    new RegExp(`(${NUMBER})\\s*${ch}`, "giu"),
    new RegExp(`${ch}[^\\d\\n]{0,12}(${NUMBER})${END}`, "giu"),
  ]) {
    for (const m of raw.matchAll(re)) {
      const v = num(m[1]!);
      if (Number.isInteger(v) && v > 0 && v < 1000)
        add("target_channels", "Target channels", v, undefined, m[0]);
    }
  }
}
