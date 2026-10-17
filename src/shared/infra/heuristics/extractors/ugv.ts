import { cue, unit } from "@/shared/lexicons";
import { type AddSpec, measureCue } from "./common";

/** Ground robots: load/towing capacity and battery operating time. */
export function extractUgv(raw: string, add: AddSpec) {
  measureCue(raw, add, {
    cue: cue("ugvLoad"),
    units: [[unit("kg"), "kg"]],
    key: "payload",
    label: "Payload capacity",
    gap: 20,
  });
  measureCue(raw, add, {
    cue: cue("ugvOperatingTime"),
    units: [
      [unit("hours"), "h"],
      [unit("minutes"), "min"],
    ],
    key: "endurance",
    label: "Endurance",
  });
}
