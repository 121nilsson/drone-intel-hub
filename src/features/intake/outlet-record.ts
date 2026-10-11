import { phoneticKey } from "@/entities/drone/name-key";
import type { RawDispatch } from "@/entities/dispatch/types";

/**
 * What an outlet's past reporting says its word is worth, so corroboration can weigh evidence
 * instead of counting heads. Two reposts of one name are not the same evidence as two outlets
 * that have both historically produced real drone reporting.
 *
 * The key is the phonetic key of the outlet's name, because that is what a candidate's
 * "Outlet · url" source string reduces to when the outlet has to be recognised again.
 */

/** An outlet with no record weighs neutral: a new source is neither trusted nor mistrusted. */
export const NEUTRAL_WEIGHT = 1;
/** Below this many stored posts an outlet has no track record worth weighing. */
export const MIN_RECORD = 5;
/**
 * The weight window. An outlet whose every stored post turned out relevant weighs 1.5; one that
 * has never once produced a drone-related post weighs 0.5. The floor is deliberate: a noise
 * outlet's report still counts for something, but two of them together (1.0) fall below the
 * two-outlet evidence bar, so a name can no longer be promoted by copy-paste alone.
 */
export const MIN_WEIGHT = 0.5;
export const MAX_WEIGHT = 1.5;

/** "Ukrinform (War) · https://..." -> the phonetic key of "ukrinform": the outlet, whatever its feed. */
export function outletKey(source: string): string {
  return phoneticKey(source.split(" · ")[0]!.replace(/\(.*?\)/g, ""));
}

/** The outlet of a dispatch's own record, the same way outletKey reads a candidate's source. */
function outletKeyOfName(sourceName: string): string {
  return phoneticKey(sourceName.replace(/\(.*?\)/g, ""));
}

/**
 * Weight per outlet, from the dispatch archive. Same yield definitions as the Sources page and
 * the collection cadence, so all three read one measure. The archive is capped, so this is the
 * recent record rather than all of history - enough to separate a reporting outlet from a
 * copy-paste one.
 */
export function outletWeights(dispatches: Iterable<RawDispatch>): Map<string, number> {
  const record = new Map<string, { stored: number; relevant: number }>();
  for (const d of dispatches) {
    const r = record.get(d.sourceName) ?? { stored: 0, relevant: 0 };
    r.stored++;
    if (d.status === "processed" || d.outcome === "queued") r.relevant++;
    record.set(d.sourceName, r);
  }
  const weights = new Map<string, number>();
  for (const [name, r] of record) {
    const key = outletKeyOfName(name);
    if (!key) continue;
    if (r.stored < MIN_RECORD) {
      weights.set(key, NEUTRAL_WEIGHT);
      continue;
    }
    const share = Math.min(1, Math.max(0, r.relevant / r.stored));
    weights.set(key, MIN_WEIGHT + share);
  }
  return weights;
}

/**
 * Corroboration evidence: the sum of the distinct outlets' weights. With no weights supplied
 * (a caller without the archive), every outlet weighs neutral, which is plain outlet counting -
 * yesterday's behaviour, unchanged.
 */
export function evidenceFrom(
  outlets: Iterable<string>,
  weights: ReadonlyMap<string, number> | undefined,
): number {
  let sum = 0;
  for (const key of outlets) sum += weights?.get(key) ?? NEUTRAL_WEIGHT;
  return sum;
}
