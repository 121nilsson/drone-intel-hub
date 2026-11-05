import { countryCode } from "@/entities/normalization/country";
import type { Drone, Extraction, OriginClaim, OriginReview } from "./types";

/**
 * A system's country of origin is set once, when an entry is created, and nothing after that
 * read it again: PAC-2 came out of a 31-system news digest as Russian, and six later reports
 * saying American changed nothing. Each report's reading is kept on the entry (`originClaims`),
 * and this module says what the readings support. Pure: it proposes, the catalogue applies.
 *
 * - An unknown origin ("??") is filled when at least two reports agree and none disagrees: there
 *   is nothing to overrule and the reports are of one mind. The repair does that unattended.
 * - A stored origin most reports contradict is only proposed. Origin decides which side a system
 *   is on, a majority of model readings is not proof (Geran-2 is an Iranian design built in
 *   Russia), so the analyst decides, and a country the analyst turned down is never proposed again.
 */

/** No origin yet: how promotion writes an entry whose report named none. */
export const UNKNOWN_ORIGIN = "??";

const known = (code: string | undefined) => !!code && code !== UNKNOWN_ORIGIN && code !== "-";

const fold = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * The origin an extraction gives for one system. The per-system extraction when the report has
 * them: the top-level origin belongs to whichever system the model called primary, and in a
 * digest of thirty systems it is often another system's country - PAC-2's "RU" was.
 */
export function originFor(
  e: Pick<Extraction, "origin" | "name" | "systemExtractions">,
  system: { id?: string; name: string; aliases?: readonly string[] },
): string | undefined {
  const names = new Set([system.name, ...(system.aliases ?? [])].map(fold));
  const own = (e.systemExtractions ?? []).find(
    (x) => (system.id && x.matchId === system.id) || names.has(fold(x.name)),
  );
  if (e.systemExtractions?.length) {
    const code = own?.origin ? countryCode(own.origin) : undefined;
    return known(code) ? code : undefined;
  }
  if (!e.name || !names.has(fold(e.name))) return undefined;
  const code = e.origin ? countryCode(e.origin) : undefined;
  return known(code) ? code : undefined;
}

/** The entry with one more report's reading; a candidate already counted adds nothing. */
export function withOriginClaim(drone: Drone, claim: OriginClaim): Drone {
  const claims = drone.originClaims ?? [];
  if (claim.candidateId && claims.some((c) => c.candidateId === claim.candidateId)) return drone;
  return { ...drone, originClaims: [...claims, claim] };
}

export interface OriginProposal {
  /** fill: the origin is unknown and the reports agree; change: the reports contradict it. */
  kind: "fill" | "change";
  country: string;
  /** Reports giving that country, and all reports giving any. */
  support: number;
  total: number;
  /** Every country the reports gave, most first. */
  tally: Array<{ country: string; count: number }>;
}

/** At least this many reports must give a country before it is proposed. */
export const ORIGIN_MIN_SUPPORT = 2;

export function originTally(drone: Drone): Array<{ country: string; count: number }> {
  const by = new Map<string, number>();
  for (const c of drone.originClaims ?? []) {
    const code = countryCode(c.country);
    if (known(code)) by.set(code, (by.get(code) ?? 0) + 1);
  }
  return [...by.entries()]
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country));
}

/** What the reports support about the entry's origin, or undefined when nothing is to be done. */
export function originProposal(drone: Drone): OriginProposal | undefined {
  const tally = originTally(drone);
  const top = tally[0];
  if (!top || top.count < ORIGIN_MIN_SUPPORT) return undefined;
  const total = tally.reduce((n, t) => n + t.count, 0);
  const stored = known(drone.origin) ? countryCode(drone.origin) : undefined;
  const turnedDown = new Set(drone.originReview?.turnedDown ?? []);
  if (turnedDown.has(top.country)) return undefined;
  if (!stored)
    // Fill only when nothing disagrees; a split leaves the unknown for the analyst.
    return tally.length === 1
      ? { kind: "fill", country: top.country, support: top.count, total, tally }
      : undefined;
  if (top.country === stored) return undefined;
  // The analyst set this origin: reports outrank nothing an analyst decided.
  if (drone.originReview?.origin === stored) return undefined;
  if (top.count * 2 <= total) return undefined;
  return { kind: "change", country: top.country, support: top.count, total, tally };
}

/**
 * The analyst's decision: the origin is `origin`, and every other country the reports proposed
 * is turned down, so the proposal does not come back with the next report.
 */
export function decideOrigin(drone: Drone, origin: string, at: string): Drone {
  const code = countryCode(origin) || UNKNOWN_ORIGIN;
  const proposed = originTally(drone)
    .map((t) => t.country)
    .filter((c) => c !== code);
  const review: OriginReview = {
    origin: code,
    turnedDown: [...new Set([...(drone.originReview?.turnedDown ?? []), ...proposed])].filter(
      (c) => c !== code,
    ),
    at,
    by: "analyst",
  };
  return { ...drone, origin: code, originReview: review, updatedAt: at };
}
