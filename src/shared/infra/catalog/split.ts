import type { Drone } from "@/entities/drone/types";
import { claimKey } from "@/entities/drone/claim-review";
import { systemSlug } from "@/entities/drone/name-key";
import { variantEntry, type SplitClaim } from "@/entities/drone/variant-split";
import { moveAliasToSystem } from "./aliases";
import { moveSpecClaimToSystem } from "./claims";
import { linkSystems } from "./relations";
import type { CatalogDeps } from "./shared";

/** A new id in the promote form, `<slug>-<4 hex>`, free in the catalogue. */
function freshId(name: string, taken: ReadonlySet<string>): string {
  for (;;) {
    const id = `${systemSlug(name)}-${crypto.randomUUID().slice(0, 4)}`;
    if (!taken.has(id)) return id;
  }
}

/** See CatalogMutations.splitVariant. */
export function splitVariant(
  droneId: string,
  aliasClaimIds: readonly string[],
  claims: readonly SplitClaim[],
  d: Pick<CatalogDeps, "drones">,
  at = new Date().toISOString(),
): Drone | undefined {
  const parent = d.drones.get(droneId);
  const named = parent?.aliasClaims?.find((c) => c.id === aliasClaimIds[0]);
  if (!parent || !named) return undefined;
  const id = freshId(named.alias, new Set(d.drones.list().map((x) => x.id)));
  const specKeys = [...new Set(claims.map((c) => c.specKey))];
  d.drones.upsert(variantEntry(parent, named.alias, id, specKeys, at));

  // Each step is the ordinary analyst move, so each is undone the ordinary way ("Return").
  for (const aliasId of aliasClaimIds) moveAliasToSystem(droneId, aliasId, id, d, at);
  for (const { specKey, claim } of claims) {
    const key = claimKey(claim);
    const current = d.drones
      .get(droneId)
      ?.specs.find((s) => s.key === specKey)
      ?.claims.find((c) => claimKey(c) === key);
    if (current) moveSpecClaimToSystem(droneId, specKey, current, id, specKey, "", d, at);
  }
  linkSystems(id, droneId, "variant_of", d, undefined, at);
  return d.drones.get(id);
}
