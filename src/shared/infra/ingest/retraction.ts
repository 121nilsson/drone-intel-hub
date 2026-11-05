import type { ActivityRecord, Drone, SpecClaim } from "@/entities/drone/types";
import { withActivity } from "@/entities/drone/activity";
import { keepsItsPlace } from "@/entities/drone/candidate-repeats";
import {
  claimKey,
  heldReviews,
  restoreReviews,
  type HeldReview,
} from "@/entities/drone/claim-review";
import type { RawDispatch } from "@/entities/dispatch/types";
import type { PipelineDeps } from "@/shared/infra/ingest/pipeline";

/**
 * Remove the spec claims a post contributed, from every catalog entry. A claim is the post's when
 * it carries the post's id (the merge paths) or its source line (promotion, which predates ids).
 * Returns `restore`, which puts the entries back for when the re-run fails, and
 * `restoreReviews`, which puts analyst verdicts back on the claims a successful re-run produced.
 */
export function retractContribution(
  d: RawDispatch,
  deps: PipelineDeps,
): { restore: () => void; restoreReviews: () => void } {
  const source = `${d.sourceName} · ${d.url}`;
  const at = new Date().toISOString();
  // A claim the analyst filed (a moved figure, a hand-entered one) is not the post's
  // contribution: the post is re-read, the analyst's own reading stands.
  const mine = (c: SpecClaim) =>
    c.extractionEngine !== "analyst" && (c.sourceId === d.id || c.source === source);
  /** Remove this post's claims from a fresh copy, so a concurrent review survives the retry. */
  // Its activity records go with its claims: the re-read files them again.
  const mineActivity = (r: ActivityRecord) => r.sourceId === d.id || r.source === source;
  const withoutMine = (drone: Drone): Drone => ({
    ...drone,
    specs: drone.specs
      .map((s) => ({ ...s, claims: s.claims.filter((c) => !mine(c)) }))
      .filter((s) => s.claims.length > 0),
    ...(drone.activity ? { activity: drone.activity.filter((r) => !mineActivity(r)) } : {}),
    updatedAt: at,
  });
  const before: Drone[] = [];
  const held: HeldReview[] = [];
  for (const drone of deps.drones.list()) {
    if (!drone.specs.some((s) => s.claims.some(mine)) && !drone.activity?.some(mineActivity))
      continue;
    before.push(drone);
    held.push(...heldReviews(drone, mine));
    deps.drones.upsert(withoutMine(drone), withoutMine);
  }
  return {
    restore: () => {
      for (const drone of before) {
        // Put back only the claims this retraction removed, never the whole old document: the
        // re-run may have reviewed, merged or otherwise edited the drone while it was failing.
        const removed = drone.specs.flatMap((s) =>
          s.claims.filter(mine).map((claim) => ({ spec: s, claim })),
        );
        const restoreRemoved = (fresh: Drone): Drone => {
          const specs = fresh.specs.map((s) => ({ ...s, claims: [...s.claims] }));
          const byKey = new Map(specs.map((s) => [s.key, s]));
          let changed = false;
          for (const { spec, claim } of removed) {
            let target = byKey.get(spec.key);
            if (!target) {
              target = { ...spec, claims: [] };
              byKey.set(spec.key, target);
              specs.push(target);
            }
            if (!target.claims.some((c) => claimKey(c) === claimKey(claim))) {
              target.claims.push(claim);
              changed = true;
            }
          }
          // And the activity records this retraction took, back in the same way.
          const lostActivity = (drone.activity ?? []).filter(mineActivity);
          const activity = lostActivity.length
            ? withActivity(fresh.activity, lostActivity)
            : fresh.activity;
          if (activity !== fresh.activity && activity?.length !== fresh.activity?.length)
            changed = true;
          return changed
            ? { ...fresh, specs, ...(activity ? { activity } : {}), updatedAt: at }
            : fresh;
        };
        const fresh = deps.drones.get(drone.id);
        if (fresh) deps.drones.upsert(restoreRemoved(fresh), restoreRemoved);
      }
    },
    restoreReviews: () => {
      for (const id of new Set(held.map((h) => h.droneId))) {
        const drone = deps.drones.get(id);
        if (!drone) continue;
        const apply = (fresh: Drone) => restoreReviews(fresh, held, mine);
        const next = apply(drone);
        if (next !== drone) deps.drones.upsert(next, apply);
      }
    },
  };
}

/**
 * The earlier run's candidates are replaced by the new run's. Only marking the pending ones as
 * superseded left every merged and discarded candidate of every earlier run in place - 5,665 of
 * 12,947 stored candidates repeated a later reading of the same post and system. The earlier
 * run's contribution was retracted before the post was read again, so its candidates go too,
 * except the ones that keep their place (candidate-repeats.ts): an analyst's decision, or a
 * candidate that created a catalog entry.
 */
export function supersedeCandidates(
  d: RawDispatch,
  replacements: readonly string[],
  deps: PipelineDeps,
) {
  const current = new Set(replacements);
  const byId = new Map(deps.candidates.list().map((c) => [c.id, c]));
  for (const id of d.candidateIds ?? []) {
    const c = byId.get(id);
    if (c && !keepsItsPlace(c, current)) deps.candidates.remove(id);
  }
}
