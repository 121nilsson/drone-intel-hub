import type { Drone, SpecAttribute, SpecClaim } from "@/entities/drone/types";
import { attributeSemantic } from "@/entities/drone/spec-engine";
import { mergeLinks } from "@/entities/normalization/apply";
import type {
  CandidateRepository,
  DispatchRepository,
  DroneRepository,
} from "@/shared/contracts/repository";
import type { CatalogMutations, ClaimVerdict, RemoveDroneReport } from "@/shared/contracts/catalog";
import { addAnalystClaim, reviewClaim } from "@/entities/drone/claim-review";

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

  // Upsert merged target
  d.drones.upsert(result);

  // 7. Update counterpart links on other drones pointing to mergeId
  for (const other of d.drones.list()) {
    if (other.id === keepId || other.id === mergeId) continue;
    if (
      other.counterpartIds.includes(mergeId) ||
      other.variantOfId === mergeId ||
      other.variantIds?.includes(mergeId)
    ) {
      const updated = [
        ...new Set(
          other.counterpartIds
            .map((cId) => (cId === mergeId ? keepId : cId))
            .filter((cId) => cId !== other.id),
        ),
      ];
      d.drones.upsert({
        ...other,
        counterpartIds: updated,
        ...(other.variantOfId === mergeId ? { variantOfId: keepId } : {}),
        ...(other.variantIds
          ? {
              variantIds: [
                ...new Set(other.variantIds.map((id) => (id === mergeId ? keepId : id))),
              ],
            }
          : {}),
        updatedAt: new Date().toISOString(),
      });
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
    const { variantOfId, ...rest } = other;
    d.drones.upsert({
      ...rest,
      ...(variantOfId && variantOfId !== id ? { variantOfId } : {}),
      counterpartIds: other.counterpartIds.filter((x) => x !== id),
      ...(other.variantIds ? { variantIds: other.variantIds.filter((x) => x !== id) } : {}),
      updatedAt: now,
    });
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
  let next = reviewClaim(
    drone,
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
  if (next) d.drones.upsert(next);
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
  };
}
