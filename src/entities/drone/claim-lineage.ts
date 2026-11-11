import type { Drone, SpecClaim } from "./types";

export interface LineageClaim {
  droneId: string;
  specKey: string;
  claim: SpecClaim;
}

/** Every claim a generated rule shaped, so an analyst can see what a rule has touched. */
export function claimsByRule(drones: readonly Drone[], ruleId: string): LineageClaim[] {
  return drones.flatMap((drone) =>
    drone.specs.flatMap((spec) =>
      spec.claims
        .filter((claim) => claim.lineage?.ruleIds?.includes(ruleId))
        .map((claim) => ({ droneId: drone.id, specKey: spec.key, claim })),
    ),
  );
}
