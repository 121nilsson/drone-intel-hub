import type { Extraction } from "@/entities/drone/types";
import { phoneticKey } from "@/entities/drone/name-key";

/**
 * Identity scoring: a post's system names and match ids as sets, compared the same way for the
 * heuristic and the reference.
 */

export const namesOf = (e: Extraction) => [
  ...new Set(
    [e.name, ...(e.systems ?? []).map((s) => s.name)]
      .filter((n): n is string => !!n?.trim())
      .map(phoneticKey),
  ),
];
export const matchIdsOf = (e: Extraction) => [
  ...new Set(
    [e.matchId, ...(e.systems ?? []).map((s) => s.matchId)].filter((x): x is string => !!x),
  ),
];

export function setCounts(h: string[], r: string[]) {
  const rs = new Set(r);
  const tp = h.filter((x) => rs.has(x)).length;
  return { tp, fp: h.length - tp, fn: r.length - tp };
}
