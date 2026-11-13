import { isNearDuplicate } from "@/entities/dispatch/simhash";
import { outletKey } from "@/entities/source/outlet-record";
import { claimCounts, correctedPoint } from "./claim-review";
import { rawPoint } from "./consensus";
import type { SpecAttribute, SpecClaim } from "./types";

/** The outlet behind a source string, so two feeds or reposts of one outlet count once. */
const outletOf = (source: string) => outletKey(source) || source.trim().toLowerCase();

/** One claim that speaks for the figure: the outlet it came from and its post's content hash. */
export interface Voice {
  outlet: string;
  contentHash: string | undefined;
}

const voiceOf = (claim: SpecClaim): Voice => ({
  outlet: outletOf(claim.source),
  contentHash: claim.lineage?.contentHash,
});

/**
 * Groups voices that are one source. Two voices are one source when they name the same outlet, or
 * when both carry a content hash and the hashes are near-duplicates: an outlet that republished
 * another's wire text is not a second witness. A voice without a hash is grouped by outlet only,
 * which is what counted before hashes existed.
 *
 * Union-find, so the grouping is transitive: A~B and B~C put A, B and C in one group even when A
 * and C are not near-duplicates themselves. Groups come back in first-seen order, as indexes.
 */
export function groupVoices(voices: readonly Voice[]): number[][] {
  const parent = voices.map((_, i) => i);
  const root = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r]!;
    return r;
  };
  for (let i = 0; i < voices.length; i++) {
    for (let j = i + 1; j < voices.length; j++) {
      const a = voices[i]!;
      const b = voices[j]!;
      const sameOutlet = a.outlet === b.outlet;
      const repost = isNearDuplicate(a.contentHash ?? "", b.contentHash ?? "");
      if (sameOutlet || repost) parent[root(i)] = root(j);
    }
  }
  const groups = new Map<number, number[]>();
  voices.forEach((_, i) => {
    const r = root(i);
    const group = groups.get(r);
    if (group) group.push(i);
    else groups.set(r, [i]);
  });
  return [...groups.values()];
}

/**
 * The claims of one attribute, grouped into observations: claims from one outlet, and claims whose
 * posts are near-duplicates, are one observation each. Unlike independentSourceCount this looks at
 * every claim whatever figure it states, so a dispute can see two sources that disagree. Each
 * group keeps the claims' own order.
 */
export function clusterObservations(claims: readonly SpecClaim[]): SpecClaim[][] {
  return groupVoices(claims.map(voiceOf)).map((group) => group.map((i) => claims[i]!));
}

/**
 * Distinct sources that state the same figure for this attribute. Keyed by outlet, not by source
 * string, so "Ukrinform (War)" and "Ukrinform (Economy)" are one voice; and a repost of one text
 * by two outlets is one voice too, when both claims carry a near-duplicate content hash. Weighting
 * by an outlet's track record belongs to the cross-source check (plan §4.3 step 6), which has the
 * archive.
 */
export function independentSourceCount(spec: SpecAttribute, claim: SpecClaim): number {
  const mine = correctedPoint(claim) ?? rawPoint(spec, claim);
  const own = outletOf(claim.source);
  const voices: Voice[] = [{ outlet: own, contentHash: claim.lineage?.contentHash }];
  for (const other of spec.claims) {
    if (other === claim) continue;
    const outlet = outletOf(other.source);
    if (outlet === own) continue;
    if (!claimCounts(other)) continue;
    const theirs = correctedPoint(other) ?? rawPoint(spec, other);
    const voice: Voice = { outlet, contentHash: other.lineage?.contentHash };
    if (mine && theirs) {
      if (mine.unit && theirs.unit && mine.unit !== theirs.unit) continue;
      const scale = Math.max(Math.abs(mine.value), Math.abs(theirs.value), 1e-9);
      if (Math.abs(mine.value - theirs.value) / scale <= 0.05) voices.push(voice);
      continue;
    }
    const a = String(claim.value).trim().toLowerCase();
    if (a && a === String(other.value).trim().toLowerCase()) voices.push(voice);
  }
  return groupVoices(voices).length;
}
