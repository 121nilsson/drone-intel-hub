import { outletKey } from "@/entities/source/outlet-record";
import { claimCounts, correctedPoint } from "./claim-review";
import { rawPoint } from "./consensus";
import type { SpecAttribute, SpecClaim } from "./types";

/** The outlet behind a source string, so two feeds or reposts of one outlet count once. */
const outletOf = (source: string) => outletKey(source) || source.trim().toLowerCase();

/**
 * Distinct outlets that state the same figure for this attribute. Keyed by outlet, not by source
 * string, so "Ukrinform (War)" and "Ukrinform (Economy)" are one voice. Weighting by an outlet's
 * track record belongs to the cross-source check (plan §4.3 step 6), which has the archive.
 */
export function independentSourceCount(spec: SpecAttribute, claim: SpecClaim): number {
  const mine = correctedPoint(claim) ?? rawPoint(spec, claim);
  const own = outletOf(claim.source);
  const sources = new Set<string>([own]);
  for (const other of spec.claims) {
    if (other === claim) continue;
    const outlet = outletOf(other.source);
    if (outlet === own) continue;
    if (!claimCounts(other)) continue;
    const theirs = correctedPoint(other) ?? rawPoint(spec, other);
    if (mine && theirs) {
      if (mine.unit && theirs.unit && mine.unit !== theirs.unit) continue;
      const scale = Math.max(Math.abs(mine.value), Math.abs(theirs.value), 1e-9);
      if (Math.abs(mine.value - theirs.value) / scale <= 0.05) sources.add(outlet);
      continue;
    }
    const a = String(claim.value).trim().toLowerCase();
    if (a && a === String(other.value).trim().toLowerCase()) sources.add(outlet);
  }
  return sources.size;
}
