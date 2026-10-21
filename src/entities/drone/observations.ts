import { attributeSemantic } from "./spec-engine";
import type { Drone, SpecAttribute } from "./types";

/**
 * The payload and sensor facts of an entry, in the place the catalogue keeps most of them.
 *
 * A payload or a sensor reaches the catalogue twice: as an observation (what a report said the
 * system carries) and as a spec (the figure: payload capacity, warhead mass, camera count). The
 * observation lists are thinly filled - most reports are read for their figures, not for a list
 * of equipment - so the specs are where most of this knowledge sits, and a panel that reads only
 * the observations shows an empty page for a system the catalogue knows a lot about.
 *
 * The classification is the canonical semantic, not a keyword match on the label: "Onboard
 * cameras" is a sensor fact because its key and label resolve to `sensor.camera.count`, and
 * "Payload capacity" is a payload fact because they resolve to `payload.capacity`.
 */
export function payloadSpecs(drone: Drone): SpecAttribute[] {
  return drone.specs.filter((s) => attributeSemantic(s).startsWith("payload."));
}

export function sensorSpecs(drone: Drone): SpecAttribute[] {
  return drone.specs.filter((s) => attributeSemantic(s).startsWith("sensor."));
}
