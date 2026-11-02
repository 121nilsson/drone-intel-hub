import type {
  Drone,
  RelationKind,
  SpecAttribute,
  SpecClaim,
  SystemClass,
  SystemRelationClaim,
} from "@/entities/drone/types";
import {
  isRelationActive,
  withUnlink,
  withDeclinedRelation,
  withDistinct,
  cleanRelations,
  relationProblem,
  retargetRelations,
  withRelation,
  withRelationReview,
  withoutRelationsTo,
} from "@/entities/drone/system-hierarchy";
import { withActivity } from "@/entities/drone/activity";
import { attributeSemantic } from "@/entities/drone/spec-engine";
import { mergeLinks } from "@/entities/normalization/apply";
import type {
  CandidateRepository,
  DispatchRepository,
  DroneRepository,
} from "@/shared/contracts/repository";
import type { CatalogMutations, ClaimVerdict, RemoveDroneReport } from "@/shared/contracts/catalog";
import {
  addAnalystClaim,
  claimKey,
  fileMovedClaim,
  markClaimMovedToSystem,
  moveClaim,
  removeMovedClaim,
  reviewClaim,
} from "@/entities/drone/claim-review";
import {
  addManualAlias,
  aliasClaimsFromList,
  approveAlias,
  claimsToAliases,
  moveAliasTo,
  removeFiledAlias,
  rejectAlias,
  unsetAliasVerdict,
} from "@/entities/drone/alias-claims";
import { aliasFold } from "@/entities/drone/alias-policy";
import type { AliasClaim } from "@/entities/drone/types";

/**
 * The repositories the catalog operations work on.
 *
 * The dispatch repository is optional: only the removal operations count feed posts, so a
 * caller without one still gets a correct (if smaller) report.
 */
export interface CatalogDeps {
  drones: DroneRepository;
  candidates: CandidateRepository;
  dispatches?: DispatchRepository;
}

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

/**
 * What removing an entry would touch, without changing anything. The dossier shows this before
 * the analyst confirms.
 */
export function removalImpact(id: string, d: CatalogDeps): RemoveDroneReport {
  return {
    unlinked: d.drones.list().filter((x) => x.id !== id && linksTo(x, id)).length,
    discarded: d.candidates.list().filter((c) => c.resolvedInto === id).length,
    dispatches: (d.dispatches?.list() ?? []).filter((x) => x.droneIds?.includes(id)).length,
  };
}

function linksTo(drone: Drone, id: string): boolean {
  return (
    (drone.relations ?? []).some((r) => r.targetSystemId === id) ||
    (drone.distinctFrom ?? []).includes(id) ||
    drone.counterpartIds.includes(id) ||
    drone.variantOfId === id ||
    (drone.variantIds?.includes(id) ?? false)
  );
}

/** Drop every link to a removed entry, keeping the rest of the document as it is. */
function unlinkAfterRemove(doc: Drone, id: string, at: string): Drone {
  if (!linksTo(doc, id)) return doc;
  const unlinked = withoutRelationsTo(doc, id, at);
  return unlinked.distinctFrom?.includes(id)
    ? { ...unlinked, distinctFrom: unlinked.distinctFrom.filter((x) => x !== id), updatedAt: at }
    : unlinked;
}

/** See CatalogMutations.linkSystems. */
export function linkSystems(
  sourceId: string,
  targetId: string,
  kind: RelationKind,
  d: Pick<CatalogDeps, "drones">,
  role?: string,
  at = new Date().toISOString(),
): Drone | undefined {
  const source = d.drones.get(sourceId);
  const target = d.drones.get(targetId);
  if (!source || !target) return undefined;
  const catalog = d.drones.list();
  if (relationProblem(source, target, kind, catalog)) return undefined;
  const apply = (fresh: Drone) => withRelation(fresh, target, kind, d.drones.list(), at, role);
  const next = apply(source);
  d.drones.upsert(next, apply);
  return next;
}

/** See CatalogMutations.unlinkSystems. */
export function unlinkSystems(
  sourceId: string,
  targetId: string,
  d: Pick<CatalogDeps, "drones">,
  at = new Date().toISOString(),
): Drone | undefined {
  const source = d.drones.get(sourceId);
  const target = d.drones.get(targetId);
  if (!source || !target) return undefined;
  // Both sides, each recording the unlink: a counterpart is listed on each, a parent may list its
  // variant, and a report naming both would otherwise bring the link back.
  const unlinkSource = (fresh: Drone) => withUnlink(fresh, d.drones.get(targetId) ?? target, at);
  const unlinkTarget = (fresh: Drone) => withUnlink(fresh, d.drones.get(sourceId) ?? source, at);
  const next = unlinkSource(source);
  const t = unlinkTarget(target);
  if (next !== source) d.drones.upsert(next, unlinkSource);
  if (t !== target) d.drones.upsert(t, unlinkTarget);
  return next;
}

/** See CatalogMutations.reviewRelation. */
export function reviewRelation(
  droneId: string,
  claimId: string,
  verdict: "confirmed" | "rejected" | null,
  d: Pick<CatalogDeps, "drones">,
  notes?: string,
  at = new Date().toISOString(),
): Drone | undefined {
  const drone = d.drones.get(droneId);
  if (!drone) return undefined;
  const next = withRelationReview(drone, claimId, verdict, at, notes);
  if (!next) return undefined;
  d.drones.upsert(next, (fresh) => withRelationReview(fresh, claimId, verdict, at, notes) ?? fresh);
  const claim = drone.relations?.find((r) => r.id === claimId);
  if (verdict === "rejected" && claim?.kind === "variant_of")
    dropFromVariantList(claim.targetSystemId, droneId, d, at);
  if (verdict === "rejected" && claim?.kind === "counterpart_to")
    dropFromCounterparts(claim.targetSystemId, droneId, d, at);
  return next;
}

/** See CatalogMutations.declineRelation. */
export function declineRelation(
  sourceId: string,
  targetId: string,
  kind: RelationKind,
  d: Pick<CatalogDeps, "drones">,
  at = new Date().toISOString(),
): Drone | undefined {
  const source = d.drones.get(sourceId);
  if (!source) return undefined;
  const apply = (fresh: Drone) => withDeclinedRelation(fresh, targetId, kind, at);
  const next = apply(source);
  if (next !== source) d.drones.upsert(next, apply);
  if (kind === "variant_of") dropFromVariantList(targetId, sourceId, d, at);
  if (kind === "counterpart_to") dropFromCounterparts(targetId, sourceId, d, at);
  return next;
}

/** A turned-down counterpart leaves the other side's legacy list too: the pipeline lists both. */
function dropFromCounterparts(
  otherId: string,
  droneId: string,
  d: Pick<CatalogDeps, "drones">,
  at: string,
) {
  const other = d.drones.get(otherId);
  if (!other?.counterpartIds.includes(droneId)) return;
  const apply = (fresh: Drone): Drone =>
    fresh.counterpartIds.includes(droneId)
      ? {
          ...fresh,
          counterpartIds: fresh.counterpartIds.filter((id) => id !== droneId),
          updatedAt: at,
        }
      : fresh;
  d.drones.upsert(apply(other), apply);
}

/** A turned-down variant leaves its parent's legacy list too, for the readers that use it. */
function dropFromVariantList(
  parentId: string,
  childId: string,
  d: Pick<CatalogDeps, "drones">,
  at: string,
) {
  const parent = d.drones.get(parentId);
  if (!parent?.variantIds?.includes(childId)) return;
  const apply = (fresh: Drone): Drone =>
    fresh.variantIds?.includes(childId)
      ? { ...fresh, variantIds: fresh.variantIds.filter((id) => id !== childId), updatedAt: at }
      : fresh;
  d.drones.upsert(apply(parent), apply);
}

/** See CatalogMutations.markDistinct. */
export function markDistinct(
  aId: string,
  bId: string,
  d: Pick<CatalogDeps, "drones">,
  at = new Date().toISOString(),
): Drone | undefined {
  const a = d.drones.get(aId);
  const b = d.drones.get(bId);
  if (!a || !b || a.id === b.id) return undefined;
  for (const [x, other] of [
    [b, aId],
    [a, bId],
  ] as const) {
    const apply = (fresh: Drone) => withDistinct(fresh, other, at);
    const next = apply(x);
    if (next !== x) d.drones.upsert(next, apply);
  }
  return d.drones.get(aId);
}

/** See CatalogMutations.setSystemClass. */
export function setSystemClass(
  droneId: string,
  systemClass: SystemClass | null,
  d: Pick<CatalogDeps, "drones">,
  at = new Date().toISOString(),
): Drone | undefined {
  const drone = d.drones.get(droneId);
  if (!drone) return undefined;
  const apply = (fresh: Drone): Drone => {
    const { systemClass: _old, ...rest } = fresh;
    void _old;
    return { ...rest, ...(systemClass ? { systemClass } : {}), updatedAt: at };
  };
  const next = apply(drone);
  d.drones.upsert(next, apply);
  return next;
}

/**
 * Remove a catalog entry an analyst has judged wrong (a unit or an outlet promoted as a system).
 *
 * Nothing is left pointing at it: other entries lose their links to it, feed posts drop it from
 * their provenance, and the candidates that created or fed it become "discarded by the analyst".
 * That last part is also what keeps it out: auto-promotion refuses a name an analyst has rejected
 * (see rejectedByAnalyst), so the next post naming it goes to the Queue instead of straight back
 * into the catalog. The candidates keep `resolvedInto` as history; the Queue shows it as deleted.
 */
export function removeDrone(id: string, d: CatalogDeps): RemoveDroneReport | undefined {
  if (!d.drones.get(id)) return undefined;
  const report: RemoveDroneReport = { unlinked: 0, discarded: 0, dispatches: 0 };
  const now = new Date().toISOString();

  for (const other of d.drones.list()) {
    if (other.id === id || !linksTo(other, id)) continue;
    d.drones.upsert(unlinkAfterRemove(other, id, now), (fresh) =>
      unlinkAfterRemove(fresh, id, now),
    );
    report.unlinked++;
  }

  for (const c of d.candidates.list()) {
    if (c.resolvedInto !== id) continue;
    d.candidates.update(c.id, { status: "discarded", resolvedBy: "analyst" });
    report.discarded++;
  }

  for (const post of d.dispatches?.list() ?? []) {
    if (!post.droneIds?.includes(id)) continue;
    d.dispatches!.update(post.id, { droneIds: post.droneIds.filter((x) => x !== id) });
    report.dispatches++;
  }

  d.drones.remove?.(id);
  return report;
}

/** See CatalogMutations.reviewClaim. */
export function reviewSpecClaim(
  droneId: string,
  specKey: string,
  claim: SpecClaim,
  verdict: ClaimVerdict | null,
  d: Pick<CatalogDeps, "drones">,
  at = new Date().toISOString(),
): Drone | undefined {
  const drone = d.drones.get(droneId);
  if (!drone) return undefined;
  const apply = (base: Drone): Drone | undefined => {
    let next = reviewClaim(
      base,
      specKey,
      claim,
      verdict
        ? {
            verdict: verdict.verdict,
            ...(verdict.verdict === "rejected" ? { issue: verdict.issue } : {}),
            at,
            by: "analyst",
          }
        : null,
    );
    if (next && verdict?.verdict === "rejected" && verdict.correctValue?.trim()) {
      next = addAnalystClaim(next, specKey, verdict.correctValue, at) ?? next;
    }
    return next;
  };
  const next = apply(drone);
  if (next) d.drones.upsert(next, (fresh) => apply(fresh) ?? fresh);
  return next;
}

/** See CatalogMutations.reviewCorrection. */
export function verdictForCorrection(claim: SpecClaim, accept: boolean): ClaimVerdict | null {
  const fix = claim.autoCorrection;
  if (!fix) return null;
  if (!accept) return { verdict: "confirmed" };
  if (fix.kind === "implausible" || fix.value === undefined)
    return { verdict: "rejected", issue: "value" };
  return {
    verdict: "rejected",
    issue: "unit",
    correctValue: fix.unit ? `${fix.value} ${fix.unit}` : String(fix.value),
  };
}

/** See CatalogMutations.moveClaim. */
export function moveSpecClaim(
  droneId: string,
  specKey: string,
  claim: SpecClaim,
  targetSpecKey: string,
  figure: string,
  d: Pick<CatalogDeps, "drones">,
  at = new Date().toISOString(),
): Drone | undefined {
  const drone = d.drones.get(droneId);
  if (!drone) return undefined;
  const key = claimKey(claim);
  // A retry must not file the same moved claim twice if the target already received it.
  const hasCopy = (base: Drone) =>
    base.specs.find((s) => s.key === targetSpecKey)?.claims.some((c) => c.movedFrom === key) ??
    false;
  if (hasCopy(drone)) return drone;
  const apply = (base: Drone) =>
    hasCopy(base) ? base : (moveClaim(base, specKey, claim, targetSpecKey, figure, at) ?? base);
  const next = moveClaim(drone, specKey, claim, targetSpecKey, figure, at);
  if (next) d.drones.upsert(next, apply);
  return next;
}

/** See CatalogMutations.moveClaimToSystem. */
export function moveSpecClaimToSystem(
  droneId: string,
  specKey: string,
  claim: SpecClaim,
  targetDroneId: string,
  targetSpecKey: string,
  figure: string,
  d: Pick<CatalogDeps, "drones">,
  at = new Date().toISOString(),
): Drone | undefined {
  const source = d.drones.get(droneId);
  const target = d.drones.get(targetDroneId);
  if (!source || !target || source.id === target.id) return undefined;
  const key = claimKey(claim);
  const sourceNext = markClaimMovedToSystem(
    source,
    specKey,
    claim,
    targetDroneId,
    targetSpecKey,
    at,
  );
  const targetNext = fileMovedClaim(target, targetSpecKey, claim, droneId, key, figure, at);
  if (!sourceNext || !targetNext) return undefined;
  if (sourceNext === source && targetNext === target) return source;

  // Two documents cannot be written atomically. File the target first: if the source write then
  // fails, the figure is briefly counted twice, which a retry/undo repairs - the other order
  // would reject the source claim and lose the figure entirely.
  if (targetNext !== target) {
    d.drones.upsert(targetNext, (fresh) => {
      const filed = fileMovedClaim(fresh, targetSpecKey, claim, droneId, key, figure, at);
      return filed ?? fresh;
    });
  }
  d.drones.upsert(sourceNext, (fresh) => {
    const moved = markClaimMovedToSystem(fresh, specKey, claim, targetDroneId, targetSpecKey, at);
    return moved ?? fresh;
  });
  return sourceNext;
}

/** See CatalogMutations.undoMoveClaimToSystem. */
export function undoSpecClaimToSystem(
  droneId: string,
  specKey: string,
  claim: SpecClaim,
  d: Pick<CatalogDeps, "drones">,
  at = new Date().toISOString(),
): Drone | undefined {
  const source = d.drones.get(droneId);
  if (!source) return undefined;
  const spec = source.specs.find((s) => s.key === specKey);
  const key = claimKey(claim);
  const current = spec?.claims.find((c) => claimKey(c) === key);
  const review = current?.review;
  if (!spec || !current || !review?.movedToDroneId) return undefined;

  const targetDroneId = review.movedToDroneId;
  const targetSpecKey = review.movedTo;
  const moveId = review.moveId;
  const next = reviewClaim(source, specKey, claim, null, at);
  if (!next) return undefined;
  // Clear the source verdict first: a failed target write leaves a visible duplicate, never a
  // silently discarded figure.
  d.drones.upsert(next, (fresh) => reviewClaim(fresh, specKey, claim, null, at) ?? fresh);
  const target = d.drones.get(targetDroneId);
  if (target) {
    const removed = removeMovedClaim(target, droneId, key, targetSpecKey, at, moveId);
    if (removed !== target) {
      d.drones.upsert(removed, (fresh) =>
        removeMovedClaim(fresh, droneId, key, targetSpecKey, at, moveId),
      );
    }
  }
  return next;
}

/** See CatalogMutations.reviewAlias. */
export function reviewAliasClaim(
  droneId: string,
  claimId: string,
  verdict: "confirmed" | "rejected" | null,
  d: Pick<CatalogDeps, "drones">,
  at = new Date().toISOString(),
): Drone | undefined {
  const drone = d.drones.get(droneId);
  if (!drone) return undefined;
  const apply = (base: Drone): Drone | undefined =>
    verdict === "confirmed"
      ? approveAlias(base, claimId, at)
      : verdict === "rejected"
        ? rejectAlias(base, claimId, at)
        : unsetAliasVerdict(base, claimId, at);
  const next = apply(drone);
  if (next) d.drones.upsert(next, (fresh) => apply(fresh) ?? fresh);
  return next;
}

/** See CatalogMutations.addAlias. */
export function addAnalystAlias(
  droneId: string,
  alias: string,
  d: Pick<CatalogDeps, "drones">,
  at = new Date().toISOString(),
): Drone | undefined {
  const drone = d.drones.get(droneId);
  if (!drone) return undefined;
  const next = addManualAlias(drone, alias, at);
  if (next) d.drones.upsert(next, (fresh) => addManualAlias(fresh, alias, at) ?? fresh);
  return next;
}

/** See CatalogMutations.moveAlias. */
export function moveAliasToSystem(
  sourceDroneId: string,
  claimId: string,
  targetDroneId: string,
  d: Pick<CatalogDeps, "drones">,
  at = new Date().toISOString(),
): Drone | undefined {
  const source = d.drones.get(sourceDroneId);
  const target = d.drones.get(targetDroneId);
  if (!source || !target) return undefined;
  const first = moveAliasTo(source, claimId, target, at);
  if (!first) return undefined;
  // Two documents cannot be written atomically. The copy lands first: if the source write then
  // fails, the alias is briefly answered to twice, which a retry or undo repairs - the other
  // order would reject the source claim and lose the alias entirely.
  if (first.target !== target) {
    d.drones.upsert(first.target, (fresh) => {
      const result = moveAliasTo(d.drones.get(sourceDroneId) ?? source, claimId, fresh, at);
      return result?.target ?? fresh;
    });
  }
  if (first.source !== source) {
    d.drones.upsert(
      first.source,
      (fresh) => moveAliasTo(fresh, claimId, target, at)?.source ?? fresh,
    );
  }
  return first.source;
}

/** See CatalogMutations.undoMoveAlias. */
export function undoAliasMoveFromSystem(
  sourceDroneId: string,
  claimId: string,
  d: Pick<CatalogDeps, "drones">,
  at = new Date().toISOString(),
): Drone | undefined {
  const source = d.drones.get(sourceDroneId);
  if (!source) return undefined;
  const claim = source.aliasClaims?.find((c) => c.id === claimId);
  const moveId = claim?.review?.moveId;
  if (!claim || !moveId) return undefined;
  const targetDroneId = claim.review?.movedToDroneId;
  const next = unsetAliasVerdict(source, claimId, at);
  if (!next) return undefined;
  // Clear the source verdict first: a failed target write leaves the filed copy in place -
  // visible - rather than discarding the alias silently.
  d.drones.upsert(next, (fresh) => unsetAliasVerdict(fresh, claimId, at) ?? fresh);
  if (!targetDroneId) return next;
  const target = d.drones.get(targetDroneId);
  if (target) {
    const removed = removeFiledAlias(target, sourceDroneId, moveId, at);
    if (removed !== target) {
      d.drones.upsert(removed, (fresh) => removeFiledAlias(fresh, sourceDroneId, moveId, at));
    }
  }
  return next;
}

/**
 * Binds the catalog operations to a set of repositories, so a page asks for "merge these two
 * entries" instead of assembling the repositories the operation happens to need.
 */
export function createCatalogMutations(d: CatalogDeps): CatalogMutations {
  return {
    merge: (keepId, mergeId, reason) => mergeDrones(keepId, mergeId, d, reason),
    removalImpact: (id) => removalImpact(id, d),
    remove: (id) => removeDrone(id, d),
    reviewClaim: (droneId, specKey, claim, verdict) =>
      reviewSpecClaim(droneId, specKey, claim, verdict, d),
    reviewCorrection: (droneId, specKey, claim, accept) => {
      const verdict = verdictForCorrection(claim, accept);
      return verdict ? reviewSpecClaim(droneId, specKey, claim, verdict, d) : undefined;
    },
    moveClaim: (droneId, specKey, claim, targetSpecKey, figure) =>
      moveSpecClaim(droneId, specKey, claim, targetSpecKey, figure ?? "", d),
    moveClaimToSystem: (droneId, specKey, claim, targetDroneId, targetSpecKey, figure) =>
      moveSpecClaimToSystem(droneId, specKey, claim, targetDroneId, targetSpecKey, figure ?? "", d),
    undoMoveClaimToSystem: (droneId, specKey, claim) =>
      undoSpecClaimToSystem(droneId, specKey, claim, d),
    reviewAlias: (droneId, claimId, verdict) => reviewAliasClaim(droneId, claimId, verdict, d),
    addAlias: (droneId, alias) => addAnalystAlias(droneId, alias, d),
    moveAlias: (sourceDroneId, claimId, targetDroneId) =>
      moveAliasToSystem(sourceDroneId, claimId, targetDroneId, d),
    undoMoveAlias: (sourceDroneId, claimId) => undoAliasMoveFromSystem(sourceDroneId, claimId, d),
    linkSystems: (sourceId, targetId, kind, role) => linkSystems(sourceId, targetId, kind, d, role),
    unlinkSystems: (sourceId, targetId) => unlinkSystems(sourceId, targetId, d),
    reviewRelation: (droneId, claimId, verdict, notes) =>
      reviewRelation(droneId, claimId, verdict, d, notes),
    setSystemClass: (droneId, systemClass) => setSystemClass(droneId, systemClass, d),
    declineRelation: (sourceId, targetId, kind) => declineRelation(sourceId, targetId, kind, d),
    markDistinct: (aId, bId) => markDistinct(aId, bId, d),
  };
}
