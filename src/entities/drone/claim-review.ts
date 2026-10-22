import { normalizeQuantity } from "@/entities/normalization/units";
import { attributeSemantic } from "./spec-engine";
import type { ClaimReview, Drone, SpecClaim } from "./types";

/**
 * Analyst verdicts on individual spec claims. A verdict never deletes or rewrites the claim -
 * the report said what it said - it decides whether the claim still feeds the aggregate.
 */

/** Source line of a value an analyst entered by hand. */
export const ANALYST_SOURCE = "Analyst";

/**
 * A claim's identity by content rather than by object.
 *
 * The same report stating the same figure must produce the same fingerprint, so a verdict
 * survives a re-analysis that re-creates the claim object, and two claims that merely share a
 * value - the same number from two outlets - stay separate.
 */
export function claimFingerprint(c: SpecClaim): string {
  const ev = (c.evidence ?? c.raw ?? "").trim().slice(0, 80);
  return [c.source, c.sourceId ?? "", String(c.value), c.date, ev].join("|");
}

/**
 * Identity of a claim within its spec. New claims carry a stable `id`; older ones fall back to a
 * composite key enriched with an evidence fingerprint so two claims from the same source with the
 * same value and date but different evidence are reviewed independently.
 */
export function claimKey(c: SpecClaim): string {
  if (c.id) return c.id;
  return claimFingerprint(c);
}

/**
 * Give every stored claim a stable identity. Older catalogs and seed entries predate `SpecClaim.id`;
 * backfilling once at attach means two passages that happen to share source, value and evidence
 * still resolve to different claims. Returns the same object when every claim already has one.
 */
export function ensureClaimIds(drone: Drone): Drone {
  let changed = false;
  const specs = drone.specs.map((spec) => {
    let specChanged = false;
    const claims = spec.claims.map((claim) => {
      if (claim.id) return claim;
      specChanged = true;
      changed = true;
      return { ...claim, id: crypto.randomUUID() };
    });
    return specChanged ? { ...spec, claims } : spec;
  });
  return changed ? { ...drone, specs } : drone;
}

/**
 * Whether a claim feeds consensus and the other aggregates. The analyst's verdict wins in
 * both directions: a rejected claim is out even if the check backed it, and a confirmed one is
 * in even if the check called it an outlier. An applied correction comes next: an implausible
 * figure is out, and a unit slip counts at its corrected value even if the check, which saw the
 * slipped figure, called it an outlier.
 */
export function claimCounts(c: SpecClaim): boolean {
  if (c.review) return c.review.verdict === "confirmed";
  if (c.autoCorrection?.applied) return c.autoCorrection.kind === "unit";
  return c.adjudication?.verdict !== "outlier";
}

/**
 * The corrected reading consensus uses in place of the claim's own, when there is one: an applied
 * unit correction on a claim no analyst has ruled on.
 */
export function correctedPoint(c: SpecClaim): { value: number; unit?: string } | undefined {
  const fix = c.autoCorrection;
  if (c.review || !fix?.applied || fix.kind !== "unit" || fix.value === undefined) return undefined;
  return { value: fix.value, ...(fix.unit ? { unit: fix.unit } : {}) };
}

/**
 * Set or clear (`review` null) the verdict on one claim. Undefined when the spec or claim is no
 * longer on the entry, so a page holding a stale copy changes nothing.
 *
 * Clearing the verdict of a move takes the copy that was filed under the other attribute back
 * out again - undoing the verdict undoes what the verdict did.
 */
export function reviewClaim(
  drone: Drone,
  specKey: string,
  claim: SpecClaim,
  review: ClaimReview | null,
  at = new Date().toISOString(),
): Drone | undefined {
  const spec = drone.specs.find((s) => s.key === specKey);
  const key = claimKey(claim);
  const current = spec?.claims.find((c) => claimKey(c) === key);
  if (!spec || !current) return undefined;
  const claims = spec.claims.map((c) => {
    if (claimKey(c) !== key) return c;
    const next = { ...c };
    delete next.review;
    return review ? { ...next, review } : next;
  });
  const undo =
    !review && current.review?.issue === "attribute" ? current.review.movedTo : undefined;
  const undoMoveId = !review ? current.review?.moveId : undefined;
  return {
    ...drone,
    specs: drone.specs.map((s) => {
      if (s === spec) return { ...s, claims };
      if (undo && s.key === undo)
        return {
          ...s,
          claims: s.claims.filter(
            (c) => c.movedFrom !== key && (!undoMoveId || c.movedFromMoveId !== undoMoveId),
          ),
        };
      return s;
    }),
    updatedAt: review?.at ?? at,
  };
}

/**
 * Add the value an analyst says is right, as a confirmed claim of its own. Parsed when it names
 * a unit ("20 km"), a number when it is one, kept as text otherwise.
 */
export function addAnalystClaim(
  drone: Drone,
  specKey: string,
  input: string,
  at: string,
): Drone | undefined {
  const raw = input.trim();
  const spec = drone.specs.find((s) => s.key === specKey);
  if (!raw || !spec) return undefined;
  const normalized = normalizeQuantity(raw);
  const numeric = Number(raw);
  const claim: SpecClaim = {
    id: crypto.randomUUID(),
    value: normalized?.canonicalValue ?? (Number.isFinite(numeric) ? numeric : raw),
    ...(normalized
      ? { raw, normalized, normalizationConfidence: normalized.confidence }
      : Number.isFinite(numeric)
        ? {}
        : { raw }),
    source: ANALYST_SOURCE,
    date: at,
    extractionEngine: "analyst",
    review: { verdict: "confirmed", at, by: "analyst" },
  };
  return {
    ...drone,
    specs: drone.specs.map((s) => (s === spec ? { ...s, claims: [...s.claims, claim] } : s)),
    updatedAt: at,
  };
}

const attributeMoveId = (sourceKey: string, targetKey: string) =>
  `attribute:${sourceKey}|${targetKey}`;

const systemMoveId = (sourceKey: string, targetDroneId: string, targetSpecKey: string) =>
  `system:${sourceKey}|${targetDroneId}|${targetSpecKey}`;

function filedClaim(
  claim: SpecClaim,
  sourceKey: string,
  figure: string,
  at: string,
  moveId: string,
): SpecClaim {
  const raw = figure.trim();
  const normalized = raw ? normalizeQuantity(raw) : undefined;
  // Number("") is 0, so an empty reading has to be ruled out before it is tried.
  const numeric = raw ? Number(raw) : Number.NaN;
  return {
    id: crypto.randomUUID(),
    value: normalized?.canonicalValue ?? (Number.isFinite(numeric) ? numeric : claim.value),
    ...(normalized
      ? { raw, normalized, normalizationConfidence: normalized.confidence }
      : { raw: claim.raw ?? String(claim.value) }),
    source: claim.source,
    ...(claim.sourceId ? { sourceId: claim.sourceId } : {}),
    ...(claim.evidence ? { evidence: claim.evidence } : {}),
    date: claim.date ?? at,
    movedFrom: sourceKey,
    movedFromMoveId: moveId,
    extractionEngine: "analyst",
    review: { verdict: "confirmed", at, by: "analyst" },
  };
}

/**
 * Move a claim to another attribute of the same system.
 *
 * The claim stays on the record where the post put it - the post did say it - but it stops
 * counting there, and the figure is filed under the attribute it actually describes. A speed
 * read as a height is not a wrong figure but a wrong place: ruling it out would throw the
 * figure away, so it is moved instead.
 *
 * The moved claim carries the analyst's own reading ("600 km/h"), because only the analyst
 * knows that the sentence's "kilometres" was an hour and not a height. Without a reading the
 * claim keeps its number and the target attribute's unit applies.
 */
export function moveClaim(
  drone: Drone,
  specKey: string,
  claim: SpecClaim,
  targetKey: string,
  figure: string,
  at: string,
): Drone | undefined {
  const spec = drone.specs.find((s) => s.key === specKey);
  const target = drone.specs.find((s) => s.key === targetKey);
  if (!spec || !target || spec === target) return undefined;
  const key = claimKey(claim);
  if (!spec.claims.some((c) => claimKey(c) === key)) return undefined;

  const moveId = attributeMoveId(key, targetKey);
  const moved = filedClaim(claim, key, figure, at, moveId);
  const claims = spec.claims.map((c) =>
    claimKey(c) === key
      ? {
          ...c,
          review: {
            verdict: "rejected",
            issue: "attribute",
            movedTo: targetKey,
            moveId,
            at,
            by: "analyst",
          } satisfies ClaimReview,
        }
      : c,
  );
  return {
    ...drone,
    specs: drone.specs.map((s) => {
      if (s === spec) return { ...s, claims };
      if (s === target) return { ...s, claims: [...s.claims, moved] };
      return s;
    }),
    updatedAt: at,
  };
}

/**
 * Mark the source claim as belonging to another system. The claim stays where the post put it,
 * stops counting there, and points at the entry and attribute that now hold the figure.
 */
export function markClaimMovedToSystem(
  source: Drone,
  specKey: string,
  claim: SpecClaim,
  targetDroneId: string,
  targetSpecKey: string,
  at: string,
): Drone | undefined {
  const spec = source.specs.find((s) => s.key === specKey);
  const key = claimKey(claim);
  const current = spec?.claims.find((c) => claimKey(c) === key);
  if (!spec || !current || source.id === targetDroneId) return undefined;
  const moveId = systemMoveId(key, targetDroneId, targetSpecKey);
  if (
    current.review?.issue === "system" &&
    current.review.movedToDroneId === targetDroneId &&
    current.review.movedTo === targetSpecKey &&
    current.review.moveId === moveId
  )
    return source;
  return {
    ...source,
    specs: source.specs.map((s) =>
      s === spec
        ? {
            ...s,
            claims: s.claims.map((c) =>
              claimKey(c) === key
                ? {
                    ...c,
                    review: {
                      verdict: "rejected",
                      issue: "system",
                      movedTo: targetSpecKey,
                      movedToDroneId: targetDroneId,
                      moveId,
                      at,
                      by: "analyst",
                    } satisfies ClaimReview,
                  }
                : c,
            ),
          }
        : s,
    ),
    updatedAt: at,
  };
}

/**
 * File the moved figure under the target system's attribute. Idempotent: a retried write that
 * already landed on the target leaves it unchanged instead of appending a second copy.
 */
export function fileMovedClaim(
  target: Drone,
  targetSpecKey: string,
  claim: SpecClaim,
  sourceDroneId: string,
  sourceKey: string,
  figure: string,
  at: string,
): Drone | undefined {
  const spec = target.specs.find((s) => s.key === targetSpecKey);
  if (!spec || target.id === sourceDroneId) return undefined;
  const moveId = systemMoveId(sourceKey, target.id, targetSpecKey);
  const existing = spec.claims.find(
    (c) =>
      c.movedFromMoveId === moveId ||
      (c.movedFrom === sourceKey && c.movedFromDroneId === sourceDroneId),
  );
  if (existing) {
    if (existing.movedFromMoveId === moveId) return target;
    // A copy filed before move ids existed, or by a retry with the same source claim, takes the
    // move id its source review now carries so a later re-analysis cannot orphan it.
    return {
      ...target,
      specs: target.specs.map((s) =>
        s === spec
          ? {
              ...s,
              claims: s.claims.map((c) => (c === existing ? { ...c, movedFromMoveId: moveId } : c)),
            }
          : s,
      ),
      updatedAt: at,
    };
  }
  const moved = {
    ...filedClaim(claim, sourceKey, figure, at, moveId),
    movedFromDroneId: sourceDroneId,
  };
  return {
    ...target,
    specs: target.specs.map((s) => (s === spec ? { ...s, claims: [...s.claims, moved] } : s)),
    updatedAt: at,
  };
}

/** Pure cross-system move, used by tests and any caller holding both entries. */
export function moveClaimToSystem(
  source: Drone,
  target: Drone,
  specKey: string,
  claim: SpecClaim,
  targetSpecKey: string,
  figure: string,
  at: string,
): { source: Drone; target: Drone } | undefined {
  if (source.id === target.id) return undefined;
  const sourceKey = claimKey(claim);
  const movedSource = markClaimMovedToSystem(source, specKey, claim, target.id, targetSpecKey, at);
  const movedTarget = fileMovedClaim(
    target,
    targetSpecKey,
    claim,
    source.id,
    sourceKey,
    figure,
    at,
  );
  return movedSource && movedTarget ? { source: movedSource, target: movedTarget } : undefined;
}

/**
 * Take the filed copy back out when the analyst undoes a cross-system move. The source verdict is
 * cleared separately, because the two entries are written independently and either may be stale.
 */
export function removeMovedClaim(
  target: Drone,
  sourceDroneId: string,
  sourceKey: string,
  targetSpecKey?: string,
  at = new Date().toISOString(),
  moveId?: string,
): Drone {
  const matches = (c: SpecClaim) =>
    (Boolean(moveId) && c.movedFromMoveId === moveId) ||
    (c.movedFrom === sourceKey && c.movedFromDroneId === sourceDroneId);
  let changed = false;
  const specs = target.specs.map((s) => {
    if (targetSpecKey && s.key !== targetSpecKey) return s;
    const claims = s.claims.filter((c) => !matches(c));
    if (claims.length === s.claims.length) return s;
    changed = true;
    return { ...s, claims };
  });
  return changed ? { ...target, specs, updatedAt: at } : target;
}

/** A verdict given on a post's claim, kept so a re-analysis of the post can restore it. */
export interface HeldReview {
  droneId: string;
  semantic: string;
  value: string;
  /** The outlet the claim came from, so a verdict never crosses to another outlet's figure. */
  source: string;
  /**
   * The claim's content fingerprint, so the verdict goes back to the same claim and not to
   * another one that happens to carry the same number.
   */
  fingerprint: string;
  review: ClaimReview;
}

/** The verdicts on the claims `mine` selects, before they are retracted. */
export function heldReviews(drone: Drone, mine: (c: SpecClaim) => boolean): HeldReview[] {
  return drone.specs.flatMap((s) =>
    s.claims.flatMap((c) =>
      c.review && mine(c)
        ? [
            {
              droneId: drone.id,
              semantic: attributeSemantic(s),
              value: String(c.value),
              source: c.source,
              fingerprint: claimFingerprint(c),
              review: c.review,
            },
          ]
        : [],
    ),
  );
}

/**
 * Put held verdicts back on the claims a re-analysis produced: same entry, same measurement,
 * same value, from the same post. Without this a re-run would bring a rejected figure back as
 * fresh, unreviewed evidence. A verdict whose claim the re-run did not reproduce is dropped
 * with it. Returns the entry unchanged (same object) when nothing matched.
 */
export function restoreReviews(
  drone: Drone,
  held: readonly HeldReview[],
  mine: (c: SpecClaim) => boolean,
): Drone {
  const mineHere = held.filter((h) => h.droneId === drone.id);
  if (!mineHere.length) return drone;
  let changed = false;
  const specs = drone.specs.map((s) => {
    const semantic = attributeSemantic(s);
    const claims = s.claims.map((c) => {
      if (c.review || !mine(c)) return c;
      // The claim itself, by content: a re-analysis re-creates the claim object, so the id moves
      // but the fingerprint does not. Two claims that only share a number do not match.
      const fingerprint = claimFingerprint(c);
      const h =
        mineHere.find((x) => x.fingerprint === fingerprint) ??
        // A claim whose evidence was re-read differently keeps its source and value, so it still
        // matches the verdict - but only that source's.
        mineHere.find(
          (x) => x.semantic === semantic && x.value === String(c.value) && x.source === c.source,
        );
      if (!h) return c;
      changed = true;
      return { ...c, review: h.review };
    });
    return { ...s, claims };
  });
  return changed ? { ...drone, specs } : drone;
}
