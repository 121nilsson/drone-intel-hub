import type { AliasClaim, Drone } from "./types";
import {
  aliasFold,
  cleanAliasList,
  isFamilyAlias,
  isGenericAlias,
  pluralIdentities,
} from "./alias-policy";

/**
 * Analyst-governed alias lifecycle, the identity twin of `claim-review.ts`.
 *
 * A model-suggested alias arrives as a `candidate` and never resolves, stores or displays
 * anything until an analyst approves it: identity errors are the highest blast-radius class in
 * the catalogue (a class phrase once filed Patriot posts under Bars), so aliasing deliberately
 * stays human-only. The flat `drone.aliases` list stays the derived view every existing
 * consumer reads - recomputed here after every mutation, so read sites never change.
 */

/** Claim id of a folded alias: unique per folded shape within one entry. */
const claimIdOf = (fold: string) => `alias-${fold}`;

/**
 * Whether a claim feeds the flat alias view. A verdict, when present, is the truth; without
 * one, legacy counts as verified because the migration sweep approved the lists that had
 * cleaned up under the intake policy.
 */
function feedsView(c: AliasClaim): boolean {
  return c.review ? c.review.verdict === "confirmed" : c.status === "verified";
}

/**
 * The verified aliases of an entry, from its claims: {{em}} verified only, candidates live on
 * the claims alone so capturing a name always requires a decision. Own names never repeat
 * themselves as aliases.
 */
export function claimsToAliases(
  claims: readonly AliasClaim[],
  name: string,
  cyrillic?: string,
): string[] {
  const list = claims.filter(feedsView).map((c) => c.alias);
  return cleanAliasList(cleanAliasList(list, name), cyrillic);
}

/** The flat view an entry answers to: claims when it carries them, its own list otherwise. */
export function aliasView(drone: Drone): string[] {
  return drone.aliasClaims?.length
    ? claimsToAliases(drone.aliasClaims, drone.name, drone.cyrillic)
    : drone.aliases;
}

/** Alias claims for a legacy flat list: verified, `legacy`, one claim per folded shape. */
export function aliasClaimsFromList(
  list: readonly string[],
  name: string,
  cyrillic?: string,
  at = "",
): AliasClaim[] {
  const claims: AliasClaim[] = [];
  const folds = new Set<string>();
  for (const raw of list) {
    const alias = raw.trim();
    if (!alias || isGenericAlias(alias)) continue;
    if ([name, cyrillic].some((n) => n && n.toLowerCase() === alias.toLowerCase())) continue;
    const fold = aliasFold(alias);
    if (!fold || folds.has(fold)) continue;
    folds.add(fold);
    // Declensions and mixed-script lookalikes collapse to the first form seen; the shortest
    // wins ties so the stored claim is the lemma, not a case ending.
    const i = claims.findIndex((c) => claimIdOf(fold) === c.id);
    if (i >= 0 && alias.length >= claims[i]!.alias.length) continue;
    const claim: AliasClaim = {
      id: claimIdOf(fold),
      alias,
      status: "verified",
      kind: "legacy",
      firstSeen: at,
    };
    if (i >= 0) claims[i] = claim;
    else claims.push(claim);
  }
  return claims;
}

/**
 * Backfill an entry's claims from the flat list it carries. Entries written before the claim
 * system behave exactly as before until their first write or panel open: the legacy list
 * becomes verified `legacy` claims and the view is recomputed, i.e. declension forms already
 * stored collapse to one lemma. An entry whose aliases all fall out of the policy - aliases
 * that were only its own name in another spelling, or bare class phrases - joins the claim
 * system with an empty claim list instead of staying flat: leaving it flat would make every
 * migration pass re-convert it forever. Idempotent.
 */
export function migrateAliasList(drone: Drone, at?: string): Drone {
  if (drone.aliasClaims) return drone;
  if (!drone.aliases.length) return drone;
  const claims = aliasClaimsFromList(
    drone.aliases,
    drone.name,
    drone.cyrillic,
    at ?? drone.createdAt,
  );
  return {
    ...drone,
    aliasClaims: claims,
    aliases: claimsToAliases(claims, drone.name, drone.cyrillic),
  };
}

/** The entry with its claims materialised, for a caller about to mutate aliases. */
function ensureAliasClaims(drone: Drone, at?: string): Drone {
  return drone.aliasClaims ? drone : migrateAliasList(drone, at);
}

/**
 * Fold a stored alias list a writer has just rewritten into the claim system. An entry without
 * claims is migrated exactly as the batch migration would have done - the list is that entry's
 * stored identity record, the same class the seed lists were. One with claims is claims-first:
 * its view is re-derived and nothing is silently claimed, so a list edit cannot assert an
 * identity the analyst has not ruled on - a fold the list holds that no claim holds must be
 * captured through `intakeAliasClaims` instead, which flags conflicts and keeps verdicts.
 */
export function adoptAliasList(drone: Drone, at: string): Drone {
  if (!drone.aliasClaims) return migrateAliasList(drone, at);
  return withView(drone);
}

/** Re-derive the flat view after a claim mutation (keep `updatedAt` from the caller). */
function withView(drone: Drone): Drone {
  return {
    ...drone,
    aliases: claimsToAliases(drone.aliasClaims ?? [], drone.name, drone.cyrillic),
  };
}

/** Placeholder for intake without a catalog snapshot, so the plural fan-out costs nothing. */
const EMPTY_CONFLICTS = new Map<string, { id: string; name: string }[]>();

/** Folds of everything the entry answers to: its canonical names and its verified aliases. */
export function identityFoldSet(drone: Drone): Set<string> {
  const folds = new Set<string>();
  for (const text of [drone.name, drone.cyrillic ?? "", ...aliasView(drone)]) {
    const fold = aliasFold(text);
    if (fold) folds.add(fold);
  }
  return folds;
}

/**
 * Fold-indexed canonical identities of every OTHER entry, for intake conflict flags: a
 * suggestion that is another entry's name or verified alias is not captured here unapproved -
 * it is stored as a candidate carrying the collision for the dossier panel and the queue.
 */
export function buildConflictMap(
  catalog: readonly Drone[],
  excludeDroneId: string,
): Map<string, { id: string; name: string }[]> {
  const map = new Map<string, { id: string; name: string }[]>();
  for (const other of catalog) {
    if (other.id === excludeDroneId) continue;
    for (const fold of identityFoldSet(other)) {
      const owners = map.get(fold) ?? [];
      owners.push({ id: other.id, name: other.name });
      map.set(fold, owners);
    }
  }
  return map;
}

/** An unreviewed claim rests where the migration put it: legacy lists were already approved. */
function restingStatus(c: AliasClaim): AliasClaim["status"] {
  return c.kind === "legacy" ? "verified" : "candidate";
}

/**
 * True when the fold or any of its plural spellings is already a known identity: folds turn
 * "Patriots" into "patrios" ("ts"→"s"), so "Patriot" only meets it through the bridge shared
 * with duplicate detection. Inflections are bridged at dedupe and identity time only - never
 * at match time, where mentionsPhonetic already allows a short case ending.
 */
function holdsIdentity(folds: ReadonlySet<string>, fold: string): boolean {
  return folds.has(fold) || pluralIdentities(fold).some((p) => folds.has(p));
}

function editClaim(
  drone: Drone,
  claimId: string,
  update: (c: AliasClaim) => AliasClaim,
  at: string,
): Drone | undefined {
  const claims = drone.aliasClaims;
  const i = claims?.findIndex((c) => c.id === claimId) ?? -1;
  if (!claims || i < 0) return undefined;
  const claim = claims[i]!;
  const next = update(claim);
  if (next === claim) return drone;
  return {
    ...withView({ ...drone, aliasClaims: [...claims.slice(0, i), next, ...claims.slice(i + 1)] }),
    updatedAt: at,
  };
}

/** The analyst approves: the alias becomes part of the identity this entry answers to. */
export function approveAlias(
  drone: Drone,
  claimId: string,
  at = new Date().toISOString(),
): Drone | undefined {
  return editClaim(
    drone,
    claimId,
    (c) =>
      c.review
        ? c
        : {
            ...c,
            status: "verified",
            review: { verdict: "confirmed", by: "analyst", at },
            // Approval is the analyst answering the collision question; keep the collision on
            // record so the panel can still show what the claim shares identity with.
          },
    at,
  );
}

/** The analyst rejects: the suggestion stays on the record but stops being suggested. */
export function rejectAlias(
  drone: Drone,
  claimId: string,
  at = new Date().toISOString(),
): Drone | undefined {
  return editClaim(
    drone,
    claimId,
    (c) =>
      c.review
        ? c
        : { ...c, status: "rejected", review: { verdict: "rejected", by: "analyst", at } },
    at,
  );
}

/**
 * Take the verdict back off. The claim returns to where it would rest without any analyst
 * decision: a migrated `legacy` list entry counts as verified again, every other claim back to
 * a candidate. Undoing the verdict undoes what the verdict did.
 */
export function unsetAliasVerdict(
  drone: Drone,
  claimId: string,
  at = new Date().toISOString(),
): Drone | undefined {
  return editClaim(
    drone,
    claimId,
    (c) => {
      if (!c.review) return c;
      const next = { ...c } as AliasClaim;
      delete next.review;
      next.status = restingStatus(c);
      return next;
    },
    at,
  );
}

/**
 * The analyst registers an alias by hand: verified immediately, since the analyst is the
 * reviewer. An existing claim of the same folded shape (a candidate, or one previously
 * rejected) is upgraded in place - the explicit registration outvotes everything earlier.
 */
export function addManualAlias(
  drone: Drone,
  alias: string,
  at = new Date().toISOString(),
): Drone | undefined {
  const text = alias.trim();
  if (!text || isGenericAlias(text) || isFamilyAlias(text, [drone.name, drone.cyrillic]))
    return undefined;
  if ([drone.name, drone.cyrillic].some((n) => n && n.toLowerCase() === text.toLowerCase()))
    return undefined;
  const fold = aliasFold(text);
  if (!fold) return undefined;
  const base = ensureAliasClaims(drone, at);
  const claims = base.aliasClaims ?? [];
  const id = claimIdOf(fold);
  const claim: AliasClaim = {
    id,
    alias: text,
    status: "verified",
    firstSeen: at,
    review: { verdict: "confirmed", by: "analyst", at },
  };
  const existing = claims.findIndex((c) => c.id === id);
  const aliasClaims =
    existing >= 0
      ? claims.map((c) => (c.id === id ? { ...claim, firstSeen: c.firstSeen } : c))
      : [...claims, claim];
  return {
    ...withView({ ...base, aliasClaims }),
    updatedAt: at,
  };
}

const aliasMoveId = (fold: string, targetDroneId: string) => `alias:${fold}|${targetDroneId}`;

/**
 * The analyst files an alias under its real system. The source claim stays on record with a
 * rejected review pointing at the move; the target gains it as a verified claim, either the
 * filed copy or, when the target already suggested the same name, its own claim upgraded -
 * the analyst's one decision made both sides agree.
 */
export function moveAliasTo(
  source: Drone,
  sourceClaimId: string,
  target: Drone,
  at = new Date().toISOString(),
): { source: Drone; target: Drone } | undefined {
  if (source.id === target.id) return undefined;
  const claim = source.aliasClaims?.find((c) => c.id === sourceClaimId);
  if (!claim || claim.review?.moveId) return undefined;
  // Claim ids are `alias-${fold}` (migration, intake and manual add all issue them); the fold
  // is derived from the id, with the alias itself as the fallback for a hand-built claim.
  const fold = claim.id.startsWith("alias-")
    ? claim.id.slice("alias-".length)
    : aliasFold(claim.alias);
  if (!fold) return undefined;
  const moveId = aliasMoveId(fold, target.id);
  if (holdsIdentity(identityFoldSet(target), fold)) {
    // Already the target's identity: the source claim just leaves this entry's view.
    const movedSource = editClaim(
      source,
      sourceClaimId,
      (c) => ({
        ...c,
        status: "rejected",
        review: { verdict: "rejected", by: "analyst", at, movedToDroneId: target.id, moveId },
      }),
      at,
    );
    return movedSource ? { source: movedSource, target } : undefined;
  }
  const targetClaims = target.aliasClaims ?? [];
  const existing = targetClaims.findIndex((c) => c.id === claimIdOf(fold));
  const filed: AliasClaim = {
    id: claimIdOf(fold),
    alias: claim.alias,
    status: "verified",
    ...(claim.source ? { source: claim.source } : {}),
    ...(claim.sourceCandidateId ? { sourceCandidateId: claim.sourceCandidateId } : {}),
    ...(claim.evidence ? { evidence: claim.evidence } : {}),
    firstSeen: claim.firstSeen,
    review: { verdict: "confirmed", by: "analyst", at, movedFromDroneId: source.id, moveId },
  };
  const targetAliasClaims =
    existing >= 0
      ? targetClaims.map((c): AliasClaim =>
          c.id === filed.id
            ? // It is the target's own claim being upgraded: its spelling, provenance and
              // first-seen stay, only the verdict and the move's origin arrive.
              {
                ...c,
                status: "verified",
                review: {
                  verdict: "confirmed",
                  by: "analyst",
                  at,
                  movedFromDroneId: source.id,
                  moveId,
                },
              }
            : c,
        )
      : [...targetClaims, filed];
  const movedTarget: Drone = {
    ...withView({ ...target, aliasClaims: targetAliasClaims }),
    updatedAt: at,
  };
  const movedSource = editClaim(
    source,
    sourceClaimId,
    (c) => ({
      ...c,
      status: "rejected",
      review: { verdict: "rejected", by: "analyst", at, movedToDroneId: target.id, moveId },
    }),
    at,
  );
  return movedSource ? { source: movedSource, target: movedTarget } : undefined;
}

/**
 * Take the move back: the filed copy leaves the target again (back to where it rested there)
 * and the source's verdict is cleared separately, because the two entries are written
 * independently and either side may be stale when undo is pressed.
 */
export function undoAliasMove(
  source: Drone,
  sourceClaimId: string,
  target: Drone,
  at = new Date().toISOString(),
): { source: Drone; target: Drone } | undefined {
  const claim = source.aliasClaims?.find((c) => c.id === sourceClaimId);
  const moveId = claim?.review?.moveId;
  if (!claim || !moveId) return undefined;
  const sourceReset = editClaim(
    source,
    sourceClaimId,
    (c) => {
      const next = { ...c } as AliasClaim;
      delete next.review;
      next.status = restingStatus(c);
      return next;
    },
    at,
  );
  if (!sourceReset) return undefined;
  let removed = false;
  const targetClaims = (target.aliasClaims ?? []).flatMap((c) => {
    if (c.review?.moveId === moveId && c.review.movedFromDroneId === source.id) {
      removed = true;
      const next = { ...c } as AliasClaim;
      delete next.review;
      next.status = restingStatus(c);
      return [next];
    }
    return [c];
  });
  const targetReset = removed
    ? { ...withView({ ...target, aliasClaims: targetClaims }), updatedAt: at }
    : target;
  return { source: sourceReset, target: targetReset };
}

/** Colliding entries for a fold, through its plural spellings as well: the map holds plain folds. */
export function conflictOwners(
  conflicts: ReadonlyMap<string, { id: string; name: string }[]>,
  fold: string,
): { id: string; name: string }[] | undefined {
  for (const key of [fold, ...pluralIdentities(fold)]) {
    const owners = conflicts.get(key);
    if (owners) return owners;
  }
  return undefined;
}

/**
 * Pure target half of an undo: the filed copy leaves the view again and rests where it would
 * have without the move, so a failed source write never silently discards the alias.
 */
export function removeFiledAlias(
  target: Drone,
  sourceDroneId: string,
  moveId: string,
  at = new Date().toISOString(),
): Drone {
  let changed = false;
  const claims = (target.aliasClaims ?? []).flatMap((c) => {
    if (c.review?.moveId === moveId && c.review?.movedFromDroneId === sourceDroneId) {
      changed = true;
      const next = { ...c } as AliasClaim;
      delete next.review;
      next.status = restingStatus(c);
      return [next];
    }
    return [c];
  });
  if (!changed) return target;
  return { ...withView({ ...target, aliasClaims: claims }), updatedAt: at };
}

export interface AliasIntakeContext {
  at: string;
  /** Provenance of the suggestion, "Outlet · URL" for candidates from ingestion. */
  source?: string;
  sourceId?: string;
  sourceCandidateId?: string;
  evidence?: string;
  /** Collisions of other entries' identities, from `buildConflictMap`. */
  conflicts?: ReadonlyMap<string, { id: string; name: string }[]>;
}

/**
 * Capture incoming alias suggestions as candidates. A suggestion that is this entry's own
 * identity or is already claimed here (candidate, verdicted, any shape) is a no-op - the claim
 * is unique per folded shape, so a verdict survives re-ingestion of every declension of the
 * same name. Everything else lands as a candidate, carrying the conflict when it names another
 * entry. The flat view is untouched: approval is what makes an alias resolvable.
 */
export function intakeAliasClaims(
  drone: Drone,
  aliases: readonly string[],
  ctx: AliasIntakeContext,
): Drone {
  const base = ensureAliasClaims(drone, ctx.at);
  if (!aliases.length) {
    // No suggestions still materialises the claims (migration recomputes the view, scrubbing
    // generic phrases and own-name repeats that slipped in before the policy).
    return base !== drone ? { ...base, updatedAt: ctx.at } : drone;
  }
  const claims = base.aliasClaims ?? [];
  const own = new Set<string>();
  for (const text of [drone.name, drone.cyrillic]) {
    if (!text) continue;
    const fold = aliasFold(text);
    if (fold) own.add(fold);
  }
  const claimed = new Set(claims.map((c) => c.id.slice("alias-".length)));
  const next = [...claims];
  let changed = false;
  for (const raw of aliases) {
    const alias = raw.trim();
    const fold = alias ? aliasFold(alias) : "";
    if (
      !alias ||
      !fold ||
      isGenericAlias(alias) ||
      isFamilyAlias(alias, [drone.name, drone.cyrillic]) ||
      holdsIdentity(own, fold) ||
      holdsIdentity(claimed, fold)
    )
      continue;
    claimed.add(fold);
    const owners = conflictOwners(ctx.conflicts ?? EMPTY_CONFLICTS, fold);
    next.push({
      id: claimIdOf(fold),
      alias,
      status: "candidate",
      ...(ctx.source ? { source: ctx.source } : {}),
      ...(ctx.sourceId ? { sourceId: ctx.sourceId } : {}),
      ...(ctx.sourceCandidateId ? { sourceCandidateId: ctx.sourceCandidateId } : {}),
      ...(ctx.evidence ? { evidence: ctx.evidence } : {}),
      firstSeen: ctx.at,
      ...(owners?.length ? { conflictWithDroneIds: owners.map((o) => o.id) } : {}),
    });
    changed = true;
  }
  if (!changed)
    return base.aliasClaims !== drone.aliasClaims ? { ...base, updatedAt: ctx.at } : drone;
  return { ...withView({ ...base, aliasClaims: next }), updatedAt: ctx.at };
}
