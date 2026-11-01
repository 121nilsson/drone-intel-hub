import type { Drone, SpecClaim } from "@/entities/drone/types";
import type { RawDispatch } from "@/entities/dispatch/types";
import type { ClaimTextResolver } from "@/entities/drone/verification";
import { VERIFIER_VERSION, verifyDrone } from "@/entities/drone/verification";
import type { DispatchRepository, DroneRepository } from "@/shared/contracts/repository";

/**
 * Bring stored verification up to the current verifier version.
 *
 * A claim is only re-checked when it has no verdict or the verdict was written by an older
 * verifier, so:
 * - a claim whose source post has scrolled out of the (bounded) archive is never downgraded by a
 *   later attach that can no longer find its text;
 * - repeated attaches are idempotent and rewrite nothing;
 * - bumping `VERIFIER_VERSION` is the single switch that re-runs the catalogue.
 */

/** Resolve a claim's own source text from the dispatch archive, by the id stored on the claim. */
export function dispatchTextResolver(dispatches: readonly RawDispatch[]): ClaimTextResolver {
  const byId = new Map(dispatches.map((d) => [d.id, d]));
  return (claim) => (claim.sourceId ? byId.get(claim.sourceId)?.text : undefined);
}

/** A claim the run should look at: never checked, or checked by an older verifier. */
export const needsVerification = (claim: SpecClaim) =>
  claim.verification?.verifierVersion !== VERIFIER_VERSION;

/**
 * needsVerification, except that a claim which already has a verdict and whose post has left the
 * archive keeps it: re-checking it without its text could only downgrade it (evidence uncertain),
 * so a verifier upgrade would read as a coverage drop it did not cause. It stays on its older
 * verifier version, visibly, rather than being silently re-judged on less evidence.
 */
export const reverifiable =
  (textFor: ClaimTextResolver) =>
  (claim: SpecClaim): boolean =>
    needsVerification(claim) && (!claim.verification || !claim.sourceId || !!textFor(claim));

export interface BackfillResult {
  /** The catalogue with verification applied, entries unchanged where nothing changed. */
  drones: Drone[];
  /** Entries whose stored copy differs and must be written back. */
  changed: Drone[];
  /** Claims the run attempted (not already at the current version). */
  checked: number;
  /** Claims whose source post is not in the archive (checked without it, or kept as they were). */
  missingText: number;
}

/**
 * Pure: verify every outdated claim of every entry against its own source text. `catalog` is the
 * set the identity check compares against; it defaults to the entries being verified.
 */
export function backfillDrones(
  drones: readonly Drone[],
  textFor: ClaimTextResolver,
  catalog: readonly Drone[] = drones,
  at = new Date().toISOString(),
): BackfillResult {
  let checked = 0;
  let missingText = 0;
  const changed: Drone[] = [];
  const shouldVerify = reverifiable(textFor);
  const next = drones.map((drone) => {
    for (const spec of drone.specs)
      for (const claim of spec.claims) {
        if (!needsVerification(claim)) continue;
        if (claim.sourceId && !textFor(claim)) missingText++;
        if (shouldVerify(claim)) checked++;
      }
    const verified = verifyDrone(drone, textFor, catalog, at, shouldVerify);
    if (verified !== drone) changed.push(verified);
    return verified;
  });
  return { drones: next, changed, checked, missingText };
}

/** Entries verified between yields to the event loop. */
const CHUNK = 20;

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * The application entry point: run the backfill over live repositories and persist what changed.
 *
 * Each write carries a replay function, so a conflict with an analyst's concurrent edit reloads
 * the stored copy and applies verification to that instead of overwriting it.
 *
 * Chunked: a verifier upgrade re-checks every claim against the whole catalogue - seconds of work
 * on a real catalogue - and this runs in the browser at startup, so it yields between chunks and
 * writes each chunk as it goes instead of freezing the page until the end.
 */
export async function backfillCatalogue(deps: {
  drones: Pick<DroneRepository, "list" | "upsert">;
  dispatches: Pick<DispatchRepository, "list">;
}): Promise<BackfillResult> {
  const textFor = dispatchTextResolver(deps.dispatches.list());
  const catalog = deps.drones.list();
  const replay = (fresh: Drone) =>
    verifyDrone(fresh, textFor, catalog, undefined, reverifiable(textFor));
  const at = new Date().toISOString();
  const total: BackfillResult = { drones: [], changed: [], checked: 0, missingText: 0 };
  const ids = catalog.map((d) => d.id);
  for (let i = 0; i < ids.length; i += CHUNK) {
    if (i > 0) await yieldToEventLoop();
    // The live entries, not the snapshot: an edit made while this run yielded must be the copy
    // verification is applied to, or the write below would quietly put the old one back. The
    // snapshot stays the identity catalog, so its passage scans are reused across chunks.
    const live = new Map(deps.drones.list().map((d) => [d.id, d]));
    const chunk = ids.slice(i, i + CHUNK).flatMap((id) => {
      const d = live.get(id);
      return d ? [d] : [];
    });
    const part = backfillDrones(chunk, textFor, catalog, at);
    for (const drone of part.changed) deps.drones.upsert(drone, replay);
    total.drones.push(...part.drones);
    total.changed.push(...part.changed);
    total.checked += part.checked;
    total.missingText += part.missingText;
  }
  return total;
}
