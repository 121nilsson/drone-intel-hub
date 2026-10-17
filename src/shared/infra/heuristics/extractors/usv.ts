import { cue, unit } from "@/shared/lexicons";
import { ENVELOPE, type AddSpec, measureCue } from "./common";

/** SHORAD target-speed cue; the same guard the UAV speed matcher uses for km/h. */
const TARGET_SPEED = new RegExp(cue("targetSpeed"), "iu");

/**
 * Surface vessels: the sea figures the airframe extractors cannot read - speed in knots,
 * range in nautical miles, hull draft. Endurance rides the shared uav/ugv matchers; a same
 * figure in km or km/h belongs to the UAV matcher, so the unit split keeps one claim per
 * reading. C-UAS documents state their envelopes in miles too - hence the notAfter guard.
 */
export function extractUsv(raw: string, add: AddSpec) {
  measureCue(raw, add, {
    cue: cue("speed"),
    units: [[unit("knots"), "kn"]],
    key: "speed",
    label: "Speed",
    gap: 16,
    notAfter: TARGET_SPEED,
  });
  measureCue(raw, add, {
    cue: cue("range"),
    units: [[unit("nmi"), "nmi"]],
    key: "range",
    label: "Range",
    notAfter: ENVELOPE,
  });
  measureCue(raw, add, {
    cue: cue("usvDraft"),
    units: [[unit("m"), "m"]],
    key: "draft",
    label: "Draft",
  });
}
