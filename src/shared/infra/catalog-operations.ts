import type { Drone, SpecAttribute, SpecClaim } from "@/entities/drone/types";
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
  const aliases = [
    ...new Set([...keep.aliases, ...merge.aliases, ...(merge.name !== name ? [merge.name] : [])]),
  ].filter((a) => a.toLowerCase() !== name.toLowerCase());
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

  const result: Drone = {
    id: keepId,
    name,
    ...(cyrillic ? { cyrillic } : {}),
    aliases,
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
    ...(keep.reference || merge.reference ? { reference: keep.reference ?? merge.reference } : {}),
    createdAt,
    updatedAt: new Date().toISOString(),
  };

  return result;
}

/** Rewrite another entry's links from a merged-away id to the entry that remains. */
function relinkAfterMerge(doc: Drone, from: string, to: string, at: string): Drone {
  if (!linksTo(doc, from)) return doc;
  const { variantOfId, ...rest } = doc;
  const counterpartIds = [
    ...new Set(
      doc.counterpartIds.map((id) => (id === from ? to : id)).filter((id) => id !== doc.id),
    ),
  ];
  return {
    ...rest,
    counterpartIds,
    ...(variantOfId ? { variantOfId: variantOfId === from ? to : variantOfId } : {}),
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
    if (
      other.counterpartIds.includes(mergeId) ||
      other.variantOfId === mergeId ||
      other.variantIds?.includes(mergeId)
    ) {
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
    drone.counterpartIds.includes(id) ||
    drone.variantOfId === id ||
    (drone.variantIds?.includes(id) ?? false)
  );
}

/** Drop every link to a removed entry, keeping the rest of the document as it is. */
function unlinkAfterRemove(doc: Drone, id: string, at: string): Drone {
  if (!linksTo(doc, id)) return doc;
  const { variantOfId, ...rest } = doc;
  return {
    ...rest,
    ...(variantOfId && variantOfId !== id ? { variantOfId } : {}),
    counterpartIds: doc.counterpartIds.filter((x) => x !== id),
    ...(doc.variantIds ? { variantIds: doc.variantIds.filter((x) => x !== id) } : {}),
    updatedAt: at,
  };
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
  };
}
