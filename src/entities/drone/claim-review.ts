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
 */
export function reviewClaim(
  drone: Drone,
  specKey: string,
  claim: SpecClaim,
  review: ClaimReview | null,
): Drone | undefined {
  const spec = drone.specs.find((s) => s.key === specKey);
  const key = claimKey(claim);
  if (!spec?.claims.some((c) => claimKey(c) === key)) return undefined;
  const claims = spec.claims.map((c) => {
    if (claimKey(c) !== key) return c;
    const next = { ...c };
    delete next.review;
    return review ? { ...next, review } : next;
  });
  return {
    ...drone,
    specs: drone.specs.map((s) => (s === spec ? { ...s, claims } : s)),
    updatedAt: review?.at ?? new Date().toISOString(),
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
