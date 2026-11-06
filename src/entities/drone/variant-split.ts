import type { Drone, SpecClaim } from "./types";

/**
 * Splitting a variant out of an entry that has been carrying it ("PAC-3" answering to "PAC-3 MSE"
 * and holding the MSE's figures). The analyst names the variant by one of the entry's aliases and
 * picks which aliases and claims go with it; the moves themselves are the ordinary cross-system
 * moves, so each one stays on the source as rejected evidence and can be returned one by one.
 *
 * This file only suggests and builds. Nothing here runs unattended: a split is an identity change,
 * and identity changes are the analyst's (AGENTS.md).
 */

export interface SplitClaim {
  specKey: string;
  claim: SpecClaim;
}

const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * The words that set the variant's name apart from the entry's: "mse" in "PAC-3 MSE" under
 * "PAC-3". Empty when the alias says nothing the entry's own name does not, so nothing is
 * suggested on a mere spelling of the parent.
 */
export function distinctiveWords(alias: string, entryName: string): string[] {
  const own = new Set(words(entryName));
  return [...new Set(words(alias).filter((w) => !own.has(w)))];
}

const mentions = (text: string, distinct: readonly string[]) => {
  const ws = new Set(words(text));
  return distinct.every((w) => ws.has(w));
};

/** A claim still counting on this entry: not rejected, not already moved away. */
const movable = (c: SpecClaim) => c.review?.verdict !== "rejected" && !c.review?.movedToDroneId;

/**
 * What a split named by `aliasClaimId` would most likely take along: the other aliases and the
 * claims whose quote uses the variant's distinguishing words. A suggestion for the analyst to
 * edit, never applied as is.
 */
export function splitSuggestion(
  drone: Drone,
  aliasClaimId: string,
): { aliasIds: string[]; claims: SplitClaim[] } {
  const named = drone.aliasClaims?.find((c) => c.id === aliasClaimId);
  if (!named) return { aliasIds: [], claims: [] };
  const distinct = distinctiveWords(named.alias, drone.name);
  if (!distinct.length) return { aliasIds: [aliasClaimId], claims: [] };
  const aliasIds = (drone.aliasClaims ?? [])
    .filter(
      (c) =>
        c.id === aliasClaimId ||
        (c.status !== "rejected" && !c.review?.moveId && mentions(c.alias, distinct)),
    )
    .map((c) => c.id);
  const claims = drone.specs.flatMap((s) =>
    s.claims
      .filter((c) => movable(c) && mentions(`${c.evidence ?? ""} ${c.raw ?? ""}`, distinct))
      .map((claim) => ({ specKey: s.key, claim })),
  );
  return { aliasIds, claims };
}

/**
 * The new entry, before anything moves onto it. It inherits what a variant shares with its
 * parent (domain, origin, maker, propulsion) and an empty attribute for each spec a moved claim
 * will be filed under, since a cross-system move files into an existing attribute only.
 * Operators are not inherited: who fields the parent is not evidence of who fields the variant.
 */
export function variantEntry(
  parent: Drone,
  name: string,
  id: string,
  specKeys: readonly string[],
  at: string,
): Drone {
  const keys = new Set(specKeys);
  return {
    id,
    name,
    aliases: [],
    domain: parent.domain,
    origin: parent.origin,
    ...(parent.manufacturer ? { manufacturer: parent.manufacturer } : {}),
    ...(parent.organizationLinks?.length
      ? { organizationLinks: parent.organizationLinks.map((l) => ({ ...l })) }
      : {}),
    operators: [],
    propulsion: parent.propulsion,
    ...(parent.propulsionId ? { propulsionId: parent.propulsionId } : {}),
    ...(parent.installation ? { installation: parent.installation } : {}),
    ...(parent.installationId ? { installationId: parent.installationId } : {}),
    summary: "",
    specs: parent.specs.filter((s) => keys.has(s.key)).map((s) => ({ ...s, claims: [] })),
    rf: [],
    components: [],
    evolution: [
      {
        date: at,
        kind: "other",
        description: `Split from ${parent.name} by the analyst`,
        source: "analyst",
      },
    ],
    counterpartIds: [],
    createdAt: at,
    updatedAt: at,
  };
}
