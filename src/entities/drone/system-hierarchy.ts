import { sameAttribute } from "./spec-engine";
import type {
  Drone,
  RelationDisplayKind,
  RelationKind,
  SpecAttribute,
  SystemRelationClaim,
} from "./types";

/**
 * Typed relations between catalogue entries: which entry is a variant of which family, derived
 * from which origin, a subsystem of which battery, an effector for which launcher, carried by
 * which platform, a counterpart to which. Pure.
 *
 * Every fact is stored once, on the entry that depends on the other (a variant points at its
 * family), and read from the other end through the inverse (the family "has" that variant). This
 * module is the one place that reads them: it takes the typed `relations` and the legacy links
 * (`variantOfId`, `variantIds`, `counterpartIds`) together, so a link the pipeline still writes
 * the old way is never missed while the repair copies them over.
 */

export const RELATION_KINDS: readonly RelationKind[] = [
  "variant_of",
  "derived_from",
  "subsystem_of",
  "effector_for",
  "carried_by",
  "counterpart_to",
];

export const INVERSE_DISPLAY: Record<RelationKind, RelationDisplayKind> = {
  variant_of: "has_variant",
  derived_from: "parent_of",
  subsystem_of: "has_subsystem",
  effector_for: "operates_effector",
  carried_by: "carries",
  counterpart_to: "counterpart_to",
};

export const isRelationKind = (k: string): k is RelationKind =>
  (RELATION_KINDS as readonly string[]).includes(k);

/** Whether a relation is read as true: the analyst's verdict first, else its status. */
export function isRelationActive(r: SystemRelationClaim): boolean {
  return r.review ? r.review.verdict === "confirmed" : r.status === "verified";
}

/** A stored edge, from its owner, whichever way it was written. */
export interface Edge {
  from: string;
  to: string;
  kind: RelationKind;
  /** The typed claim behind it; absent for a link only the legacy fields hold. */
  claim?: SystemRelationClaim;
}

/**
 * Every active edge an entry states, typed relations first, then the legacy links not already
 * stated: `variantOfId` as variant_of, `counterpartIds` as counterpart_to.
 */
export function storedEdges(drone: Drone): Edge[] {
  const out: Edge[] = [];
  const seen = new Set<string>();
  const add = (e: Edge) => {
    const k = `${e.to}|${e.kind}`;
    if (seen.has(k) || e.to === drone.id) return;
    seen.add(k);
    out.push(e);
  };
  for (const r of drone.relations ?? [])
    if (isRelationActive(r)) add({ from: drone.id, to: r.targetSystemId, kind: r.kind, claim: r });
  // A link rejected as a typed claim is not revived from the legacy fields. A pending
  // suggestion is not a rejection: it leaves an existing link standing.
  const rejected = new Set(
    (drone.relations ?? [])
      .filter((r) => (r.review ? r.review.verdict === "rejected" : r.status === "rejected"))
      .map((r) => `${r.targetSystemId}|${r.kind}`),
  );
  const legacy = (to: string, kind: RelationKind) => {
    if (!rejected.has(`${to}|${kind}`)) add({ from: drone.id, to, kind });
  };
  if (drone.variantOfId) legacy(drone.variantOfId, "variant_of");
  for (const id of drone.counterpartIds ?? []) legacy(id, "counterpart_to");
  return out;
}

/** One relation as seen from one entry. */
export interface ResolvedEdge {
  target: Drone;
  kind: RelationKind;
  displayKind: RelationDisplayKind;
  direction: "outgoing" | "incoming" | "symmetric";
  claim?: SystemRelationClaim;
}

/**
 * Every relation of `drone`, from its own point of view: what it states (outgoing), what others
 * state about it (incoming, read through the inverse), and its counterparts once each. An edge
 * to an entry no longer in the catalogue is left out.
 */
export function resolveRelations(drone: Drone, catalog: readonly Drone[]): ResolvedEdge[] {
  const byId = new Map(catalog.map((d) => [d.id, d]));
  const out: ResolvedEdge[] = [];
  const seen = new Set<string>();
  const push = (e: ResolvedEdge) => {
    const k = `${e.target.id}|${e.displayKind}`;
    if (seen.has(k) || e.target.id === drone.id) return;
    seen.add(k);
    out.push(e);
  };
  for (const e of storedEdges(drone)) {
    const target = byId.get(e.to);
    if (!target) continue;
    const symmetric = e.kind === "counterpart_to";
    // A counterpart turned down on either side is no counterpart: the pipeline lists both sides.
    if (symmetric && declined(target, drone.id, "counterpart_to")) continue;
    push({
      target,
      kind: e.kind,
      displayKind: e.kind,
      direction: symmetric ? "symmetric" : "outgoing",
      ...(e.claim ? { claim: e.claim } : {}),
    });
  }
  for (const other of catalog) {
    if (other.id === drone.id) continue;
    for (const e of storedEdges(other)) {
      if (e.to !== drone.id) continue;
      const symmetric = e.kind === "counterpart_to";
      if (symmetric && declined(drone, other.id, "counterpart_to")) continue;
      push({
        target: other,
        kind: e.kind,
        displayKind: INVERSE_DISPLAY[e.kind],
        direction: symmetric ? "symmetric" : "incoming",
        ...(e.claim ? { claim: e.claim } : {}),
      });
    }
  }
  // A parent that lists a child in the legacy `variantIds` without the child pointing back -
  // unless that link was turned down on the child.
  for (const id of drone.variantIds ?? []) {
    const child = byId.get(id);
    if (child && !declined(child, drone.id, "variant_of"))
      push({
        target: child,
        kind: "variant_of",
        displayKind: "has_variant",
        direction: "incoming",
      });
  }
  return out;
}

/** The parent an entry descends from: its variant_of first, else its derived_from. */
export function parentOf(drone: Drone, catalog: readonly Drone[]): Drone | undefined {
  const byId = new Map(catalog.map((d) => [d.id, d]));
  const edges = storedEdges(drone);
  const pick = (kind: RelationKind) =>
    edges
      .filter((e) => e.kind === kind)
      .map((e) => byId.get(e.to))
      .find(Boolean);
  return pick("variant_of") ?? parentListing(drone, catalog) ?? pick("derived_from");
}

/** Whether a relation of this kind to `targetId` was turned down on `drone`. */
export function declined(drone: Drone, targetId: string, kind: RelationKind): boolean {
  return (drone.relations ?? []).some(
    (r) =>
      r.targetSystemId === targetId &&
      r.kind === kind &&
      (r.review ? r.review.verdict === "rejected" : r.status === "rejected"),
  );
}

/** A parent that lists the entry in its legacy `variantIds`, unless that was turned down. */
export function parentListing(drone: Drone, catalog: readonly Drone[]): Drone | undefined {
  return catalog.find(
    (d) => d.variantIds?.includes(drone.id) && !declined(drone, d.id, "variant_of"),
  );
}

/**
 * The chain from an entry up to the top of its family or lineage, nearest first. Stops at a
 * cycle: catalogue data can hold one (A variant of B, B of A), and a walk that followed it would
 * never end.
 */
export function lineage(drone: Drone, catalog: readonly Drone[]): Drone[] {
  const chain: Drone[] = [];
  const visited = new Set([drone.id]);
  let at = parentOf(drone, catalog);
  while (at && !visited.has(at.id)) {
    chain.push(at);
    visited.add(at.id);
    at = parentOf(at, catalog);
  }
  return chain;
}

/** The top of an entry's family: itself when it has no parent. */
export const familyRoot = (drone: Drone, catalog: readonly Drone[]): Drone =>
  lineage(drone, catalog).at(-1) ?? drone;

/**
 * Why a relation cannot be stored, or undefined when it can: not to itself, not a duplicate, and
 * no variant or derivation cycle - a family cannot be a variant of its own variant.
 */
export function relationProblem(
  source: Drone,
  target: Drone,
  kind: string,
  catalog: readonly Drone[],
): string | undefined {
  if (!isRelationKind(kind)) return `"${kind}" is not a stored relation kind`;
  if (source.id === target.id) return "an entry cannot be related to itself";
  if (storedEdges(source).some((e) => e.to === target.id && e.kind === kind))
    return "this relation already exists";
  if (
    kind === "counterpart_to" &&
    storedEdges(target).some((e) => e.to === source.id && e.kind === "counterpart_to")
  )
    return "this relation already exists";
  if (
    (kind === "variant_of" || kind === "derived_from") &&
    lineage(target, catalog).some((d) => d.id === source.id)
  )
    return `${target.name} already descends from ${source.name}`;
  // One family per entry: a second parent would quietly replace the first in variantOfId.
  const parent = storedEdges(source).find((e) => e.kind === "variant_of");
  if (kind === "variant_of" && parent && parent.to !== target.id)
    return `${source.name} is already a variant of another entry; unlink that first`;
  return undefined;
}

/** A spec as shown in a family comparison: the entry's own, or its parent's where it has none. */
export interface EffectiveSpec {
  spec: SpecAttribute;
  source: "own" | "inherited";
  inheritedFrom?: { id: string; name: string };
}

/**
 * An entry's specs next to the parent's, for a comparison view only. Inherited figures are never
 * written back and never feed consensus: a jet variant inheriting its propeller parent's speed
 * would be wrong in exactly the families this is for, so the view labels each one as the
 * parent's. The parent's spec is copied, so nothing the view does reaches the stored record.
 */
export function compileEffectiveSpecs(drone: Drone, parent?: Drone): EffectiveSpec[] {
  const own: EffectiveSpec[] = drone.specs.map((spec) => ({ spec, source: "own" }));
  if (!parent) return own;
  const inherited: EffectiveSpec[] = parent.specs
    .filter((p) => !drone.specs.some((s) => sameAttribute(s, p)))
    .map((p) => ({
      spec: { ...p, claims: [...p.claims] },
      source: "inherited",
      inheritedFrom: { id: parent.id, name: parent.name },
    }));
  return [...own, ...inherited];
}

/**
 * Store a relation on its owner, verified as the analyst's, and keep the legacy links in step
 * for the readers that still use them: variant_of sets `variantOfId`, counterpart_to adds to
 * `counterpartIds`. Returns the entry unchanged when the relation cannot be stored.
 */
export function withRelation(
  source: Drone,
  target: Drone,
  kind: RelationKind,
  catalog: readonly Drone[],
  at: string,
  role?: string,
): Drone {
  if (relationProblem(source, target, kind, catalog)) return source;
  const claim: SystemRelationClaim = {
    id: `rel-${target.id}-${kind}`,
    targetSystemId: target.id,
    kind,
    status: "verified",
    ...(role ? { role } : {}),
    date: at,
    review: { verdict: "confirmed", by: "analyst", at },
  };
  const relations = [
    ...(source.relations ?? []).filter((r) => !(r.targetSystemId === target.id && r.kind === kind)),
    claim,
  ];
  return {
    ...source,
    relations,
    ...(kind === "variant_of" ? { variantOfId: target.id } : {}),
    ...(kind === "counterpart_to"
      ? { counterpartIds: [...new Set([...source.counterpartIds, target.id])] }
      : {}),
    updatedAt: at,
  };
}

/**
 * Every link from `drone` to `otherId`, typed and legacy alike: the typed claims go, and so do
 * `variantOfId`, the `variantIds` and `counterpartIds` entries - left behind, the repair would
 * copy a legacy link back into a typed one.
 */
export function withoutRelationsTo(drone: Drone, otherId: string, at: string): Drone {
  const relations = (drone.relations ?? []).filter((r) => r.targetSystemId !== otherId);
  const touched =
    relations.length !== (drone.relations ?? []).length ||
    drone.variantOfId === otherId ||
    (drone.variantIds ?? []).includes(otherId) ||
    drone.counterpartIds.includes(otherId);
  if (!touched) return drone;
  const { variantOfId, ...rest } = drone;
  return {
    ...rest,
    ...(variantOfId && variantOfId !== otherId ? { variantOfId } : {}),
    ...(drone.variantIds ? { variantIds: drone.variantIds.filter((id) => id !== otherId) } : {}),
    counterpartIds: drone.counterpartIds.filter((id) => id !== otherId),
    ...(drone.relations ? { relations } : {}),
    updatedAt: at,
  };
}

/** One claim per target and kind, none pointing at the entry itself. */
export function cleanRelations(
  selfId: string,
  relations: readonly SystemRelationClaim[],
): SystemRelationClaim[] {
  const seen = new Set<string>();
  return relations.filter((r) => {
    const k = `${r.targetSystemId}|${r.kind}`;
    if (r.targetSystemId === selfId || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Point every typed relation at `from` to `to` instead, dropping one that would point at itself. */
export function retargetRelations(drone: Drone, from: string, to: string): Drone {
  if (!drone.relations?.some((r) => r.targetSystemId === from)) return drone;
  const seen = new Set<string>();
  const relations = drone.relations
    .map((r) => (r.targetSystemId === from ? { ...r, targetSystemId: to } : r))
    .filter((r) => {
      const k = `${r.targetSystemId}|${r.kind}`;
      if (r.targetSystemId === drone.id || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  return { ...drone, relations };
}

/** The analyst's verdict on one relation claim, or null to clear an earlier one. */
export function withRelationReview(
  drone: Drone,
  claimId: string,
  verdict: "confirmed" | "rejected" | null,
  at: string,
  notes?: string,
): Drone | undefined {
  const claim = drone.relations?.find((r) => r.id === claimId);
  if (!claim) return undefined;
  // Confirming a second family is refused, as linking one is: unlink the first.
  if (
    verdict === "confirmed" &&
    claim.kind === "variant_of" &&
    storedEdges(drone).some((e) => e.kind === "variant_of" && e.to !== claim.targetSystemId)
  )
    return undefined;
  const reviewed: SystemRelationClaim = { ...claim };
  if (verdict) reviewed.review = { verdict, by: "analyst", at, ...(notes ? { notes } : {}) };
  else delete reviewed.review;
  const next: Drone = {
    ...drone,
    relations: drone.relations!.map((r) => (r.id === claimId ? reviewed : r)),
    updatedAt: at,
  };
  // The legacy mirror follows a verdict, so a reader not yet on this module agrees with it.
  // Clearing a verdict leaves the legacy links as they were: the link may predate the claim.
  const to = claim.targetSystemId;
  if (!verdict) {
    // Only a link this claim's confirmation wrote goes with the verdict.
    if (claim.kind === "variant_of" && claim.wroteLegacy && next.variantOfId === to) {
      const { variantOfId: _made, ...rest } = next;
      void _made;
      return {
        ...rest,
        relations: rest.relations!.map((r) =>
          r.id === claimId ? { ...r, wroteLegacy: false } : r,
        ),
      };
    }
    // And a link the rejection removed comes back with the undo.
    if (claim.kind === "variant_of" && claim.clearedLegacy && !next.variantOfId)
      return {
        ...next,
        variantOfId: to,
        relations: next.relations!.map((r) =>
          r.id === claimId ? { ...r, clearedLegacy: false } : r,
        ),
      };
    return next;
  }
  const active = isRelationActive(reviewed);
  if (claim.kind === "variant_of") {
    if (active) {
      const wrote = next.variantOfId !== to;
      return {
        ...next,
        variantOfId: to,
        relations: next.relations!.map((r) =>
          r.id === claimId ? { ...r, wroteLegacy: wrote || !!claim.wroteLegacy } : r,
        ),
      };
    }
    if (next.variantOfId === to) {
      const { variantOfId: _gone, ...rest } = next;
      void _gone;
      // Remembered, so taking the rejection back restores the link rather than losing it.
      return {
        ...rest,
        relations: rest.relations!.map((r) =>
          r.id === claimId ? { ...r, clearedLegacy: true } : r,
        ),
      };
    }
  }
  if (claim.kind === "counterpart_to")
    return {
      ...next,
      counterpartIds: active
        ? [...new Set([...next.counterpartIds, to])]
        : next.counterpartIds.filter((id) => id !== to),
    };
  return next;
}

/**
 * Record that a suggested relation is wrong, so it is not suggested again: a rejected claim, which
 * storedEdges never reads as a link and which also keeps a legacy link of that kind from being
 * read. Returns the entry unchanged when it already carries a verdict on that relation.
 */
export function withDeclinedRelation(
  source: Drone,
  targetId: string,
  kind: RelationKind,
  at: string,
  /** Replace an earlier verdict: an unlink overrides the confirmation the link was made with. */
  override = false,
): Drone {
  const existing = (source.relations ?? []).find(
    (r) => r.targetSystemId === targetId && r.kind === kind,
  );
  if (existing?.review && !override) return source;
  if (existing?.review?.verdict === "rejected") return source;
  const claim: SystemRelationClaim = {
    id: existing?.id ?? `rel-${targetId}-${kind}`,
    targetSystemId: targetId,
    kind,
    status: "rejected",
    date: existing?.date ?? at,
    review: { verdict: "rejected", by: "analyst", at },
  };
  return {
    ...source,
    relations: [...(source.relations ?? []).filter((r) => r !== existing), claim],
    updatedAt: at,
  };
}

/** The analyst's "these are different systems", recorded on both entries. */
export function withDistinct(drone: Drone, otherId: string, at: string): Drone {
  if (drone.distinctFrom?.includes(otherId) || drone.id === otherId) return drone;
  return { ...drone, distinctFrom: [...(drone.distinctFrom ?? []), otherId], updatedAt: at };
}

/**
 * The typed relations the legacy links stand for, by the entry each belongs on, for the repair to
 * write: a child's `variantOfId` or its listing in a parent's `variantIds` as the child's
 * variant_of, and a counterpart pair - listed on either side - once, on the entry whose id sorts
 * first. Nothing already stated in a typed claim (whatever its verdict) is stated again, and an
 * entry never gets a second family. Carried over as verified: the catalogue already held them.
 */
export function legacyRelationsToMigrate(
  catalog: readonly Drone[],
  at: string,
): Map<string, SystemRelationClaim[]> {
  const byId = new Map(catalog.map((d) => [d.id, d]));
  const out = new Map<string, SystemRelationClaim[]>();
  const typed = (d: Drone, to: string, kind: RelationKind) =>
    (d.relations ?? []).some((r) => r.targetSystemId === to && r.kind === kind) ||
    (out.get(d.id) ?? []).some((r) => r.targetSystemId === to && r.kind === kind);
  const add = (d: Drone, to: string, kind: RelationKind) => {
    if (to === d.id || !byId.has(to) || typed(d, to, kind)) return;
    if (
      kind === "variant_of" &&
      [...(d.relations ?? []), ...(out.get(d.id) ?? [])].some(
        (r) => r.kind === "variant_of" && r.targetSystemId !== to,
      )
    )
      return;
    const list = out.get(d.id) ?? [];
    list.push({
      id: `rel-${to}-${kind}`,
      targetSystemId: to,
      kind,
      status: "verified",
      notes: "carried over from the catalogue's earlier links",
      date: at,
    });
    out.set(d.id, list);
  };
  // An entry's own pointer first, for all entries, then parents' lists: a parent's stale listing
  // must not become the family and shut the entry's own pointer out as a second one.
  for (const d of catalog) if (d.variantOfId) add(d, d.variantOfId, "variant_of");
  for (const d of catalog)
    for (const childId of d.variantIds ?? []) {
      const child = byId.get(childId);
      if (child) add(child, d.id, "variant_of");
    }
  for (const d of catalog) {
    for (const otherId of d.counterpartIds ?? []) {
      const other = byId.get(otherId);
      if (!other) continue;
      const [owner, target] = d.id < otherId ? [d, otherId] : [other, d.id];
      if (!typed(byId.get(target)!, owner.id, "counterpart_to"))
        add(owner, target, "counterpart_to");
    }
  }
  return out;
}

/**
 * The analyst's unlink: every link from `drone` to `other` is cleared - typed and legacy, including
 * `other` listing `drone` as its variant - and each kind that was linked is recorded as turned down.
 * Recorded, not just deleted: the pipeline writes legacy links again whenever a report names both
 * systems, and the repair would copy that back into a typed link, undoing the analyst's decision.
 */
export function withUnlink(drone: Drone, other: Drone, at: string): Drone {
  const kinds = new Set<RelationKind>(
    (drone.relations ?? [])
      .filter((r) => r.targetSystemId === other.id && isRelationActive(r))
      .map((r) => r.kind),
  );
  if (drone.variantOfId === other.id || other.variantIds?.includes(drone.id))
    kinds.add("variant_of");
  if (drone.counterpartIds.includes(other.id) || other.counterpartIds.includes(drone.id))
    kinds.add("counterpart_to");
  let next = withoutLegacyLinks(drone, other.id, at);
  for (const kind of kinds) next = withDeclinedRelation(next, other.id, kind, at, true);
  return next;
}

/** The legacy links from `drone` to `otherId`, cleared; typed claims untouched. */
function withoutLegacyLinks(drone: Drone, otherId: string, at: string): Drone {
  const touched =
    drone.variantOfId === otherId ||
    (drone.variantIds ?? []).includes(otherId) ||
    drone.counterpartIds.includes(otherId);
  if (!touched) return drone;
  const { variantOfId, ...rest } = drone;
  return {
    ...rest,
    ...(variantOfId && variantOfId !== otherId ? { variantOfId } : {}),
    ...(drone.variantIds ? { variantIds: drone.variantIds.filter((id) => id !== otherId) } : {}),
    counterpartIds: drone.counterpartIds.filter((id) => id !== otherId),
    updatedAt: at,
  };
}

/**
 * The first counterpart of every entry, from one pass over the catalogue: what a list of cards
 * needs, without resolving every entry against every other on each render.
 */
export function firstCounterparts(catalog: readonly Drone[]): Map<string, Drone> {
  const byId = new Map(catalog.map((d) => [d.id, d]));
  const out = new Map<string, Drone>();
  for (const d of catalog)
    for (const e of storedEdges(d)) {
      if (e.kind !== "counterpart_to") continue;
      const other = byId.get(e.to);
      if (!other || declined(other, d.id, "counterpart_to")) continue;
      if (!out.has(d.id)) out.set(d.id, other);
      if (!out.has(other.id)) out.set(other.id, d);
    }
  return out;
}
