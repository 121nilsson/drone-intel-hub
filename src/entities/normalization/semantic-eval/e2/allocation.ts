/**
 * E2 pipeline, step b (2/3): design B allocation, exactly as design document section 3.1.
 *
 * All arithmetic is on integers (no floating point): the raw share r*N_h/T is compared through its
 * integer numerator, so a tie is a real tie and goes to the stratum name that sorts first.
 *
 * Edge cases (decisions):
 * - n and m must be integers >= 1. m = 0 would allow a non-empty stratum with n_h = 0, which has
 *   no weight and is invalid under the step a validator; n = 0 draws nothing. Both are refused.
 * - An all-empty population is refused (there is nothing to draw).
 * - n >= N is a full census (section 3.1 step 2), not an error: every n_h = N_h, and the realised
 *   total `n` is N. `requestedN` keeps what was asked, so a caller can warn.
 * - If the minima exceed n the allocation is refused with an error; nothing is reduced silently.
 *
 * `redistributionRounds` counts the remainder-spreading passes (step 5, repeated by step 6): 0 when
 * the minima already use all of n (or the population is a census), 1 when no cap binds.
 */

import { ROUTING_STRATA, type E2StratumAllocation, type RoutingStratum } from "./types";

export interface E2Allocation {
  /** Realised sample size: the sum of n_h. Equals `requestedN` unless n >= N (full census). */
  readonly n: number;
  readonly requestedN: number;
  readonly m: number;
  /** One entry per routing stratum, in en, ru, uk, unknown order. */
  readonly strata: readonly E2StratumAllocation[];
  readonly redistributionRounds: number;
  /** Strata with N_h = 0: reported, never drawn. */
  readonly emptyStrata: readonly RoutingStratum[];
}

function positiveInt(name: string, v: number): void {
  if (!Number.isSafeInteger(v) || v < 1) throw new RangeError(`${name} must be an integer >= 1`);
}

const ratio = (a: number, b: number): string | null => (a === 0 || b === 0 ? null : `${a}/${b}`);

export function allocateE2(
  populationCounts: Readonly<Record<RoutingStratum, number>>,
  n: number,
  m: number,
): E2Allocation {
  positiveInt("n", n);
  positiveInt("m", m);
  const N = {} as Record<RoutingStratum, number>;
  for (const s of ROUTING_STRATA) {
    const v = populationCounts[s];
    if (!Number.isSafeInteger(v) || v < 0) {
      throw new RangeError(`population count for ${s} must be a non-negative integer`);
    }
    N[s] = v;
  }
  const total = ROUTING_STRATA.reduce((sum, s) => sum + N[s], 0);
  if (total === 0) throw new RangeError("the population is empty: nothing to draw");

  const alloc = {} as Record<RoutingStratum, number>;
  let rounds = 0;
  if (n >= total) {
    for (const s of ROUTING_STRATA) alloc[s] = N[s];
  } else {
    for (const s of ROUTING_STRATA) alloc[s] = Math.min(N[s], m);
    const minima = ROUTING_STRATA.reduce((sum, s) => sum + alloc[s], 0);
    if (minima > n) {
      throw new RangeError(
        `allocation refused: the minima use ${minima} rows but n is ${n}; change n or m in writing before the draw`,
      );
    }
    let r = n - minima;
    const byName = [...ROUTING_STRATA].sort();
    for (;;) {
      const open = byName.filter((s) => alloc[s] < N[s]);
      if (r === 0 || open.length === 0) break;
      rounds++;
      const openTotal = open.reduce((sum, s) => sum + N[s], 0);
      const shares = open.map((s) => {
        const numerator = r * N[s];
        return { s, floor: Math.floor(numerator / openTotal), rem: numerator % openTotal };
      });
      let leftover = r - shares.reduce((sum, x) => sum + x.floor, 0);
      const order = [...shares].sort((a, b) => b.rem - a.rem || (a.s < b.s ? -1 : 1));
      const extra = new Map<RoutingStratum, number>();
      for (const x of order) {
        if (leftover > 0) {
          extra.set(x.s, 1);
          leftover--;
        }
      }
      let returned = 0;
      for (const x of shares) {
        const want = alloc[x.s] + x.floor + (extra.get(x.s) ?? 0);
        const capped = Math.min(N[x.s], want);
        returned += want - capped;
        alloc[x.s] = capped;
      }
      r = returned;
    }
  }

  const strata: E2StratumAllocation[] = ROUTING_STRATA.map((s) => ({
    stratum: s,
    populationCount: N[s],
    sampleCount: alloc[s],
    census: alloc[s] === N[s],
    pi: ratio(alloc[s], N[s]),
    w: ratio(N[s], alloc[s]),
  }));
  return {
    n: strata.reduce((sum, x) => sum + x.sampleCount, 0),
    requestedN: n,
    m,
    strata,
    redistributionRounds: rounds,
    emptyStrata: ROUTING_STRATA.filter((s) => N[s] === 0),
  };
}
