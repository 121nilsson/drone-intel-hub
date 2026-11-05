import type { AliasClaim, Drone, SpecAttribute, SystemRelationClaim } from "@/entities/drone/types";
import {
  cleanRelations,
  isRelationActive,
  retargetRelations,
} from "@/entities/drone/system-hierarchy";
import { withActivity } from "@/entities/drone/activity";
import { attributeSemantic } from "@/entities/drone/spec-engine";
import { mergeLinks } from "@/entities/normalization/apply";
import { aliasClaimsFromList, claimsToAliases } from "@/entities/drone/alias-claims";
import { aliasFold } from "@/entities/drone/alias-policy";
import type { CatalogDeps } from "./shared";
import { linksTo } from "./shared";

/**
 * The pure half of a merge: take two catalog entries and return the one that should remain.
 * Kept separate so a conflicting write can reapply the merge to the freshest stored copy.
 */
function mergeDronePair(keep: Drone, merge: Drone, reason?: string): Drone {
  const keepId = keep.id;
  const mergeId = merge.id;

  // 1. Merge metadata & descriptive fields
  const name =
    keep.name.startsWith("Uncataloged") && !merge.name.startsWith("Uncataloged")
      ? merge.name
      : keep.name;
  const cyrillic = keep.cyrillic || merge.cyrillic;
  const aliasClaims = pairAliasClaims(keep, merge, name, cyrillic);
  const aliases = claimsToAliases(aliasClaims, name, cyrillic);
  const domain = keep.domain && keep.domain !== "Multi" ? keep.domain : merge.domain || "Multi";
  const origin = keep.origin && keep.origin !== "??" ? keep.origin : merge.origin || "??";
  const manufacturer = keep.manufacturer || merge.manufacturer;
  const operators = [...new Set([...keep.operators, ...merge.operators])];
  const propulsion =
    keep.propulsion && keep.propulsion !== "Unknown"
      ? keep.propulsion
      : merge.propulsion || "Unknown";
  const summary =
    (keep.summary?.length ?? 0) >= (merge.summary?.length ?? 0) ? keep.summary : merge.summary;

  // 2. Merge specs preserving all claims and provenance
  const specsMap = new Map<string, SpecAttribute>();
  for (const s of keep.specs) {
    specsMap.set(attributeSemantic(s), { ...s, claims: [...s.claims] });
  }
  for (const s of merge.specs) {
    const existing = specsMap.get(attributeSemantic(s));
    if (existing) {
      for (const claim of s.claims) {
        const isDuplicate = existing.claims.some(
          (c) => String(c.value) === String(claim.value) && c.source === claim.source,
        );
        if (!isDuplicate) {
          existing.claims.push(claim);
        }
      }
    } else {
      specsMap.set(attributeSemantic(s), {
        ...s,
        semantic: attributeSemantic(s),
        claims: [...s.claims],
      });
    }
  }

  // 3. Merge RF links
  const rf = mergeLinks(keep.rf, merge.rf);

  // 4. Merge supply components
  const components = [...keep.components];
  for (const comp of merge.components) {
    const exists = components.some(
      (c) =>
        c.part.toLowerCase() === comp.part.toLowerCase() &&
        c.manufacturer.toLowerCase() === comp.manufacturer.toLowerCase(),
    );
    if (!exists) components.push(comp);
  }

  // 5. Merge evolution history (sorted by date)
  const mergeEvolution = merge.evolution.map((e) => ({
    ...e,
    description: e.description.includes(merge.name)
      ? e.description
      : `[${merge.name}] ${e.description}`,
  }));
  const evolution = [
    ...keep.evolution,
    {
      date: new Date().toISOString(),
      kind: "other" as const,
      description:
        reason || `Merged duplicate system '${merge.name}' (${mergeId}) into '${name}' (${keepId})`,
      source: "catalog-merge",
    },
    ...mergeEvolution,
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // 6. Merge counterpart IDs (cleaning up references to self and merged id)
  const counterpartIds = [...new Set([...keep.counterpartIds, ...merge.counterpartIds])].filter(
    (id) => id !== keepId && id !== mergeId,
  );

  const createdAt =
    keep.createdAt && merge.createdAt
      ? new Date(keep.createdAt) < new Date(merge.createdAt)
        ? keep.createdAt
        : merge.createdAt
      : keep.createdAt || merge.createdAt || new Date().toISOString();

  // Both entries' activity, each figure once: a merge must not lose what either one reported.
  const activity = withActivity(keep.activity, merge.activity ?? []);
  const result: Drone = {
    id: keepId,
    name,
    ...(cyrillic ? { cyrillic } : {}),
    aliases,
    aliasClaims,
    ...(activity.length ? { activity } : {}),
    domain,
    origin,
    ...(manufacturer ? { manufacturer } : {}),
    operators,
    propulsion,
    ...(keep.propulsionId || merge.propulsionId
      ? { propulsionId: keep.propulsionId ?? merge.propulsionId }
      : {}),
    ...(keep.installation || merge.installation
      ? { installation: keep.installation ?? merge.installation }
      : {}),
    ...(keep.installationId || merge.installationId
      ? { installationId: keep.installationId ?? merge.installationId }
      : {}),
    summary,
    specs: Array.from(specsMap.values()),
    rf,
    components,
    payloads: [
      ...(keep.payloads ?? []),
      ...(merge.payloads ?? []).filter(
        (p) => !(keep.payloads ?? []).some((x) => x.name === p.name && x.weightKg === p.weightKg),
      ),
    ],
    sensors: [
      ...(keep.sensors ?? []),
      ...(merge.sensors ?? []).filter(
        (s) => !(keep.sensors ?? []).some((x) => x.name === s.name && x.model === s.model),
      ),
    ],
    evolution,
    counterpartIds,
    ...(keep.variantOfId || merge.variantOfId
      ? { variantOfId: keep.variantOfId ?? merge.variantOfId }
      : {}),
    variantIds: [...new Set([...(keep.variantIds ?? []), ...(merge.variantIds ?? [])])].filter(
      (id) => id !== keepId && id !== mergeId,
    ),
    // Both entries' typed relations, the merged-away id pointing at the one that remains.
    ...(keep.relations || merge.relations
      ? {
          relations: oneFamily(
            keep,
            cleanRelations(
              keepId,
              [...(keep.relations ?? []), ...(merge.relations ?? [])].map((r) =>
                r.targetSystemId === mergeId ? { ...r, targetSystemId: keepId } : r,
              ),
            ),
          ),
        }
      : {}),
    ...(keep.systemClass || merge.systemClass
      ? { systemClass: keep.systemClass ?? merge.systemClass }
      : {}),
    // "Different systems" from either side still holds for the entry that remains.
    ...(keep.distinctFrom || merge.distinctFrom
      ? {
          distinctFrom: [
            ...new Set([...(keep.distinctFrom ?? []), ...(merge.distinctFrom ?? [])]),
          ].filter((id) => id !== keepId && id !== mergeId),
        }
      : {}),
    ...(keep.reference || merge.reference ? { reference: keep.reference ?? merge.reference } : {}),
    createdAt,
    updatedAt: new Date().toISOString(),
  };

  return result;
}

/**
 * The alias claims the entry that remains answers to: its own claims (materialised from the
 * flat lists of pre-claim entries), the merged-away entry's claims added on, and its canonical
 * name as a legacy claim - what the flat union produced before, now carried per claim.
 */
function pairAliasClaims(keep: Drone, merge: Drone, name: string, cyrillic?: string): AliasClaim[] {
  const claims = [
    ...(keep.aliasClaims ?? aliasClaimsFromList(keep.aliases, keep.name, keep.cyrillic)),
  ];
  const held = new Set(claims.map((c) => c.id));
  for (const c of merge.aliasClaims ?? aliasClaimsFromList(merge.aliases, name, cyrillic)) {
    if (held.has(c.id)) continue;
    held.add(c.id);
    claims.push(c);
  }
  if (merge.name && merge.name.toLowerCase() !== name.toLowerCase()) {
    const fold = aliasFold(merge.name);
    if (fold && !held.has(`alias-${fold}`)) {
      claims.push({
        id: `alias-${fold}`,
        alias: merge.name,
        status: "verified",
        kind: "legacy",
        firstSeen: merge.createdAt,
      });
    }
  }
  return claims;
}

/**
 * The merged entry keeps one family - the kept entry's - as every other path does: a second
 * active variant_of from the entry merged away is dropped.
 */
function oneFamily(keep: Drone, relations: SystemRelationClaim[]): SystemRelationClaim[] {
  const family =
    (keep.relations ?? []).find((r) => r.kind === "variant_of" && isRelationActive(r))
      ?.targetSystemId ?? keep.variantOfId;
  if (!family) return relations;
  return relations.filter(
    (r) => !(r.kind === "variant_of" && isRelationActive(r) && r.targetSystemId !== family),
  );
}

/** Rewrite another entry's links from a merged-away id to the entry that remains. */
function relinkAfterMerge(doc: Drone, from: string, to: string, at: string): Drone {
  if (!linksTo(doc, from)) return doc;
  const { variantOfId, distinctFrom, ...rest } = retargetRelations(doc, from, to);
  const counterpartIds = [
    ...new Set(
      doc.counterpartIds.map((id) => (id === from ? to : id)).filter((id) => id !== doc.id),
    ),
  ];
  return {
    ...rest,
    counterpartIds,
    ...(variantOfId ? { variantOfId: variantOfId === from ? to : variantOfId } : {}),
    ...(distinctFrom
      ? {
          distinctFrom: [...new Set(distinctFrom.map((id) => (id === from ? to : id)))].filter(
            (id) => id !== doc.id,
          ),
        }
      : {}),
    ...(doc.variantIds
      ? { variantIds: [...new Set(doc.variantIds.map((id) => (id === from ? to : id)))] }
      : {}),
    updatedAt: at,
  };
}

export function mergeDrones(
  keepId: string,
  mergeId: string,
  d: Pick<CatalogDeps, "drones" | "candidates">,
  reason?: string,
): Drone | undefined {
  if (keepId === mergeId) return undefined;
  const keep = d.drones.get(keepId);
  const merge = d.drones.get(mergeId);
  if (!keep || !merge) return undefined;

  const result = mergeDronePair(keep, merge, reason);
  // A conflicting write reapplies the merge to the freshest keep copy. The other side is
  // re-read too: another writer may have enriched the entry being merged away in the meantime.
  d.drones.upsert(result, (fresh) => {
    const current = d.drones.get(mergeId);
    return current && current.id !== fresh.id ? mergeDronePair(fresh, current, reason) : fresh;
  });

  const at = new Date().toISOString();
  // 7. Update counterpart links on other drones pointing to mergeId
  for (const other of d.drones.list()) {
    if (other.id === keepId || other.id === mergeId) continue;
    // linksTo, so a typed relation is moved with the legacy links rather than left dangling.
    if (linksTo(other, mergeId)) {
      d.drones.upsert(relinkAfterMerge(other, mergeId, keepId, at), (fresh) =>
        relinkAfterMerge(fresh, mergeId, keepId, at),
      );
    }
  }

  // 8. Update candidates resolved into mergeId
  if (d.candidates) {
    for (const c of d.candidates.list()) {
      if (c.resolvedInto === mergeId) {
        d.candidates.update(c.id, { resolvedInto: keepId });
      }
    }
  }

  // 9. Remove merged drone
  d.drones.remove?.(mergeId);

  return result;
}
