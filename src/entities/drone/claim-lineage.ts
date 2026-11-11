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

const norm = (s: string) => s.trim().toLowerCase();

/**
 * The claims on one drone that an alias rule put there: matched through a rule alias (not the
 * catalogue's own name or alias), with the alias string the rule added. A claim the catalogue's
 * stored alias matched is not the rule's, even when the string is the same.
 */
export function claimsByRuleAlias(
  drones: readonly Drone[],
  droneId: string,
  aliases: readonly string[],
): LineageClaim[] {
  const wanted = new Set(aliases.map(norm).filter(Boolean));
  const drone = drones.find((d) => d.id === droneId);
  if (!drone || !wanted.size) return [];
  return drone.specs.flatMap((spec) =>
    spec.claims
      .filter(
        (claim) =>
          claim.lineage?.matchedVia === "rule_alias" &&
          wanted.has(norm(claim.lineage.matchedName ?? "")),
      )
      .map((claim) => ({ droneId: drone.id, specKey: spec.key, claim })),
  );
}

/** What a generated rule shaped. An alias rule is passed its drone and alias terms, read by the server. */
export interface ReplayRule {
  ruleId: string;
  alias?: { droneId: string; aliases: string[] };
}

export interface ReplayTargets {
  /** Ids of the claims to re-analyse. A claim without an id or a sourceId is left out. */
  claimIds: string[];
  /** Distinct posts those claims came from: the dispatches to re-analyse. */
  dispatchIds: string[];
}

/**
 * Which posts to re-analyse once a rule is quarantined. A claim can only be re-read from its own
 * post, so a claim without a sourceId is skipped; the rest contribute their post once each.
 */
export function replayTargets(drones: readonly Drone[], rule: ReplayRule): ReplayTargets {
  const found = [
    ...claimsByRule(drones, rule.ruleId),
    ...(rule.alias ? claimsByRuleAlias(drones, rule.alias.droneId, rule.alias.aliases) : []),
  ];
  const seen = new Set<SpecClaim>();
  const replayable = found.flatMap(({ claim }) => {
    if (seen.has(claim) || !claim.sourceId) return [];
    seen.add(claim);
    return [claim];
  });
  return {
    claimIds: replayable.flatMap((c) => (c.id ? [c.id] : [])),
    dispatchIds: [...new Set(replayable.map((c) => c.sourceId as string))],
  };
}
