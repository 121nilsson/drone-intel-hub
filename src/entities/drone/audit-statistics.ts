/**
 * Exact design-based upper confidence bound on the number of wrong claims in a finite population,
 * for a stratified simple random sample drawn without replacement.
 *
 * Why exact and not a Clopper-Pearson rate on the pooled sample: a pooled rate ignores how the
 * sample was drawn. Strata are sampled at different fractions, so a pooled count over-weights
 * the thinly sampled strata. The bound here is taken over every way the true wrong claims could
 * be spread across strata, so it cannot be fooled by an unlucky split.
 *
 * Why no finite-population or effective-sample-size approximation: at audit sizes (a few hundred
 * claims) those approximations move the bound by more than the difference between passing and
 * failing the budget. The hypergeometric terms are computed exactly, in log space.
 */

export interface StratumSample {
  name: string;
  population: number;
  sampled: number;
  errors: number;
}

export type UpperBound =
  | { kind: "bound"; wrongMax: number; upper: number; evaluated: number }
  | { kind: "census"; upper: number }
  /** Not computable within the limit, or too close to the threshold to classify safely. Never a pass. */
  | { kind: "incomplete"; evaluated: number }
  /** There are no claims at all: no share to speak of, and nothing a bound could be a bound on. */
  | { kind: "no_population" };

/**
 * The significance level. A total of wrong claims is rejected only when the observed result
 * would have at most this chance under it, so the bound holds with 95 % confidence.
 */
const DEFAULT_ALPHA = 0.05;

/**
 * Allocations the general search may enumerate before it stops. The search is exact, so this is
 * the only thing that limits it. Reaching the limit returns "incomplete" rather than a guessed
 * bound: a bound that quietly used fewer allocations could be too optimistic.
 */
const DEFAULT_CAP = 5_000_000;

/**
 * Outcomes whose weighted total sits within float noise of the observed total count as observed.
 * Without it a total equal to the observed one could be dropped because of rounding.
 */
const TOLERANCE = 1e-9;

/**
 * A probability this close to alpha cannot be called above or below it: the log-space arithmetic is
 * only good to about 1e-12, and a verdict that flips on rounding is not one to pass on. Such a
 * result is "incomplete".
 */
const BORDERLINE = 1e-9;

/** Thrown inside the search when the allocation cap is reached; turned into "incomplete". */
class CapExceeded extends Error {}

function buildLogFactorialTable(max: number): number[] {
  const table = [0];
  for (let i = 1; i <= max; i++) table.push(table[i - 1]! + Math.log(i));
  return table;
}

const LOG_FACTORIAL_TABLE = buildLogFactorialTable(20);

/**
 * ln(n!). Small n come from an exact running sum. Large n use Stirling's series: a running sum
 * of logs over a population of 10^6 accumulates rounding error large enough to shift a bound in
 * its last printed digit, while the series is accurate far beyond the tolerance used above.
 */
function logFactorial(n: number): number {
  if (n <= 20) return LOG_FACTORIAL_TABLE[n]!;
  const inv = 1 / n;
  const inv2 = inv * inv;
  return (
    (n + 0.5) * Math.log(n) -
    n +
    0.5 * Math.log(2 * Math.PI) +
    inv * (1 / 12 - inv2 * (1 / 360 - inv2 * (1 / 1260 - inv2 / 1680)))
  );
}

/** ln(C(n, k)); -Infinity when the coefficient is zero, so that impossible outcomes drop out. */
function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

function assertCount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer, got ${value}`);
  }
}

/**
 * Keeps the strata that contain claims and checks the sample against them. An empty stratum
 * contributes nothing and cannot be sampled, so it is dropped rather than rejected. A non-empty
 * stratum with no draws is rejected: its wrong claims would be unobservable, and a bound that
 * silently ignored them would be too low.
 */
function activeStrata(strata: readonly StratumSample[]): StratumSample[] {
  const active: StratumSample[] = [];
  for (const s of strata) {
    assertCount(s.population, `${s.name}: population`);
    assertCount(s.sampled, `${s.name}: sampled`);
    assertCount(s.errors, `${s.name}: errors`);
    if (s.population === 0) continue;
    if (s.sampled === 0) throw new RangeError(`${s.name}: a stratum with claims must be sampled`);
    if (s.sampled > s.population || s.errors > s.sampled) {
      throw new RangeError(`${s.name}: sample is larger than its population or errors exceed it`);
    }
    active.push(s);
  }
  return active;
}

/**
 * Proportional allocation by largest remainder. A stratum with claims always gets at least one
 * draw, so no stratum goes unseen; the strata that fall below one draw are fixed at one and the
 * rest are re-split, because fixing them lowers the budget left for everyone else. When the whole
 * population fits in `size`, every claim is inspected.
 */
export function allocateProportional(
  populations: Readonly<Record<string, number>>,
  size: number,
): Record<string, number> {
  assertCount(size, "size");
  const names: string[] = [];
  for (const name of Object.keys(populations)) {
    const population = populations[name] ?? 0;
    assertCount(population, `${name}: population`);
    if (population > 0) names.push(name);
  }
  const pop = (name: string): number => populations[name] ?? 0;
  const total = names.reduce((sum, name) => sum + pop(name), 0);
  const result: Record<string, number> = {};

  if (total <= size) {
    for (const name of names) result[name] = pop(name);
    return result;
  }
  if (names.length > size) {
    throw new RangeError(`size ${size} cannot give each of ${names.length} strata one draw`);
  }

  const fixed = new Set<string>();
  for (;;) {
    const budget = size - fixed.size;
    let restPopulation = total;
    for (const name of fixed) restPopulation -= pop(name);
    const small = names.filter(
      (name) => !fixed.has(name) && (budget * pop(name)) / restPopulation < 1,
    );
    if (small.length === 0) break;
    for (const name of small) fixed.add(name);
  }

  const budget = size - fixed.size;
  let restPopulation = total;
  for (const name of fixed) restPopulation -= pop(name);
  const rest = names.filter((name) => !fixed.has(name));
  const floors = new Map<string, number>();
  const remainders: { name: string; remainder: number }[] = [];
  for (const name of rest) {
    const raw = (budget * pop(name)) / restPopulation;
    const floor = Math.floor(raw);
    floors.set(name, floor);
    remainders.push({ name, remainder: raw - floor });
  }
  let leftover = budget - [...floors.values()].reduce((sum, n) => sum + n, 0);
  remainders.sort((a, b) => b.remainder - a.remainder || a.name.localeCompare(b.name));
  for (const { name } of remainders) {
    if (leftover <= 0) break;
    floors.set(name, floors.get(name)! + 1);
    leftover -= 1;
  }

  for (const name of names) {
    result[name] = fixed.has(name) ? 1 : floors.get(name)!;
  }
  return result;
}

/** The chance a claim was drawn: sampled / population. */
export function inclusionProbability(population: number, sampled: number): number {
  if (population <= 0) throw new RangeError(`population must be positive, got ${population}`);
  if (sampled < 0 || sampled > population) {
    throw new RangeError(`sampled ${sampled} must lie between 0 and population ${population}`);
  }
  return sampled / population;
}

/**
 * The stratified estimate of the error share: each stratum's error rate, weighted by its share
 * of the claims. This is the point estimate the bound is built around; it is not a bound itself.
 */
export function errorPointEstimate(strata: readonly StratumSample[]): number {
  const active = activeStrata(strata);
  const total = active.reduce((sum, s) => sum + s.population, 0);
  if (total === 0) throw new RangeError("errorPointEstimate: no claims in any stratum");
  let estimate = 0;
  for (const s of active) estimate += (s.population / total) * (s.errors / s.sampled);
  return estimate;
}

/**
 * P(X = k) for X ~ Hypergeometric(population, successes, draws): the chance that a sample of
 * `draws` claims, taken without replacement from `population` claims of which `successes` are
 * wrong, contains exactly k wrong ones. Computed in log space so large populations cannot
 * underflow or overflow.
 */
export function hypergeometricPmf(
  population: number,
  successes: number,
  draws: number,
  k: number,
): number {
  assertCount(population, "population");
  assertCount(successes, "successes");
  assertCount(draws, "draws");
  if (successes > population || draws > population) {
    throw new RangeError("successes and draws cannot exceed the population");
  }
  const lo = Math.max(0, draws - (population - successes));
  const hi = Math.min(draws, successes);
  if (!Number.isInteger(k) || k < lo || k > hi) return 0;
  return Math.exp(
    logChoose(successes, k) +
      logChoose(population - successes, draws - k) -
      logChoose(population, draws),
  );
}

/**
 * The exact upper confidence bound on the number of wrong claims, and the share it implies.
 *
 * For a candidate total d of wrong claims, p_sup(d) is the largest chance, over every way those d
 * could be spread across strata, of seeing an estimate at most the observed one. If p_sup(d) is
 * at most alpha, d is rejected. Rejection gets harder as d grows, so the largest unrejected d is
 * found by binary search; the upper bound is that d over the population size.
 */
export function stratifiedUpperBound(
  strata: readonly StratumSample[],
  options: { alpha?: number; cap?: number } = {},
): UpperBound {
  const alpha = options.alpha ?? DEFAULT_ALPHA;
  const cap = options.cap ?? DEFAULT_CAP;
  if (!(alpha > 0 && alpha < 1)) throw new RangeError(`alpha must lie in (0, 1), got ${alpha}`);
  assertCount(cap, "cap");

  const active = activeStrata(strata);
  if (active.length === 0) return { kind: "no_population" };

  // Every claim was inspected: the population is known, so there is nothing to bound.
  if (active.every((s) => s.sampled === s.population)) {
    return { kind: "census", upper: errorPointEstimate(strata) };
  }

  const total = active.reduce((sum, s) => sum + s.population, 0);
  // Horvitz-Thompson weight: each draw from a stratum stands for population / sampled claims.
  const weights = active.map((s) => s.population / s.sampled);
  const observed = active.reduce((sum, s, h) => sum + weights[h]! * s.errors, 0);
  const work = { evaluated: 0, borderline: false };

  // With no errors observed, the only outcome at or below the observed total is "no errors in
  // any stratum", whose probability factors over strata. That lets the sup be found exactly by
  // dynamic programming instead of enumeration, which is what makes realistic sizes tractable.
  const notRejected = active.every((s) => s.errors === 0)
    ? zeroErrorTester(active, alpha, work)
    : generalTester(active, weights, observed + TOLERANCE, alpha, cap, work);

  try {
    const wrongMax = largestNotRejected(total, notRejected);
    if (work.borderline) return { kind: "incomplete", evaluated: work.evaluated };
    return { kind: "bound", wrongMax, upper: wrongMax / total, evaluated: work.evaluated };
  } catch (error) {
    if (error instanceof CapExceeded) return { kind: "incomplete", evaluated: work.evaluated };
    throw error;
  }
}

/**
 * The largest d for which `notRejected` holds. It holds at 0 and fails at `total` or beyond.
 *
 * Invariant the search rests on: p_sup(d) never increases with d. Take any spread of d + 1 wrong
 * claims over the strata and remove one wrong claim from some stratum: that is a spread of d. A
 * stratum with fewer wrong claims has a hypergeometric count that is stochastically smaller, so
 * the chance of seeing at most the observed weighted total can only be as large or larger. Hence
 * every spread of d + 1 is matched by a spread of d with at least its probability, and the
 * supremum cannot rise. (A brute-force comparison over every outcome of small designs checks this
 * in the tests.)
 *
 * The search gallops up from 0 before it bisects. Testing a rejected d costs one pass over every
 * way to spread d wrong claims over the strata, which grows with the cube of d; bisecting from
 * the whole population would start by testing d = N / 2, a cost that no audit could pay, when the
 * answer is a small fraction of N.
 */
function largestNotRejected(total: number, notRejected: (d: number) => boolean): number {
  let lo = 0;
  let hi = 1;
  while (hi < total && notRejected(hi)) {
    lo = hi;
    hi = Math.min(total, hi * 2);
  }
  if (hi >= total && notRejected(total)) return total;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (notRejected(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Zero-error case. P(no errors | D) = product over strata of C(N_h - D_h, n_h) / C(N_h, n_h), so
 * the sup over allocations is a max-plus convolution of per-stratum log terms. Work is counted in
 * the same ledger as enumeration, but it is not capped: it is bounded by the strata sizes.
 */
function zeroErrorTester(
  active: readonly StratumSample[],
  alpha: number,
  work: { evaluated: number; borderline: boolean },
): (d: number) => boolean {
  const logNone = active.map((s) => {
    const row = new Float64Array(s.population + 1);
    const base = logChoose(s.population, s.sampled);
    for (let D = 0; D <= s.population; D++) {
      row[D] = logChoose(s.population - D, s.sampled) - base;
    }
    return row;
  });
  return (d) => {
    const p = Math.exp(zeroErrorLogSup(logNone, d, work));
    if (Math.abs(p - alpha) <= BORDERLINE) work.borderline = true;
    return p > alpha;
  };
}

/** The largest sum of per-stratum log terms over allocations whose draws total exactly d. */
function zeroErrorLogSup(
  logNone: readonly Float64Array[],
  d: number,
  work: { evaluated: number; borderline: boolean },
): number {
  let prev = new Float64Array(d + 1).fill(-Infinity);
  prev[0] = 0;
  let reach = 0;
  for (let h = 0; h < logNone.length; h++) {
    const row = logNone[h]!;
    const top = row.length - 1;
    if (h === logNone.length - 1) {
      // Only the total d is needed from the last stratum.
      let best = -Infinity;
      const lo = Math.max(0, d - reach);
      const hi = Math.min(top, d);
      for (let D = lo; D <= hi; D++) {
        work.evaluated += 1;
        const value = prev[d - D]! + row[D]!;
        if (value > best) best = value;
      }
      return best;
    }
    const next = new Float64Array(d + 1).fill(-Infinity);
    for (let s0 = 0; s0 <= Math.min(reach, d); s0++) {
      const base = prev[s0]!;
      if (base === -Infinity) continue;
      const hi = Math.min(top, d - s0);
      for (let D = 0; D <= hi; D++) {
        work.evaluated += 1;
        const value = base + row[D]!;
        if (value > next[s0 + D]!) next[s0 + D] = value;
      }
    }
    reach = Math.min(d, reach + top);
    prev = next;
  }
  return -Infinity;
}

/**
 * General case, with at least one error observed. Enumerates every allocation of d across the
 * strata and stops at the first one whose probability of an estimate at most the observed one
 * exceeds alpha: that is exactly the condition for p_sup(d) > alpha, so the answer does not need
 * the maximum itself.
 */
function generalTester(
  active: readonly StratumSample[],
  weights: readonly number[],
  bound: number,
  alpha: number,
  cap: number,
  work: { evaluated: number; borderline: boolean },
): (d: number) => boolean {
  const H = active.length;
  const suffixCap = new Array<number>(H + 1).fill(0);
  for (let h = H - 1; h >= 0; h--) suffixCap[h] = suffixCap[h + 1]! + active[h]!.population;

  // Outcomes whose weighted total exceeds the bound can never count, so a stratum's table stops at
  // the most errors it could show while staying under it.
  const maxErrors = weights.map((w) => Math.floor(bound / w));
  const rows = active.map((s) => new Array<PmfRow | undefined>(s.population + 1));
  const rowOf = (h: number, D: number): PmfRow => {
    let row = rows[h]![D];
    if (row === undefined) {
      row = pmfRow(active[h]!, D, maxErrors[h]!);
      rows[h]![D] = row;
    }
    return row;
  };
  const current = new Array<PmfRow | undefined>(H);

  return (d) => {
    const allocation = new Array<number>(H).fill(0);
    let found = false;
    const visit = (h: number, remaining: number): void => {
      if (h === H) {
        work.evaluated += 1;
        if (work.evaluated > cap) throw new CapExceeded("allocation cap reached");
        for (let g = 0; g < H; g++) current[g] = rowOf(g, allocation[g]!);
        const p = allocationProbability(current as readonly PmfRow[], weights, bound);
        if (Math.abs(p - alpha) <= BORDERLINE) work.borderline = true;
        if (p > alpha) found = true;
        return;
      }
      const lo = Math.max(0, remaining - suffixCap[h + 1]!);
      const hi = Math.min(active[h]!.population, remaining);
      for (let D = lo; D <= hi && !found; D++) {
        allocation[h] = D;
        visit(h + 1, remaining - D);
      }
    };
    visit(0, d);
    return found;
  };
}

interface PmfRow {
  lo: number;
  probs: Float64Array;
}

/**
 * Hypergeometric probabilities of the outcomes a stratum can show with D wrong claims, from the
 * fewest it must show up to `maxErrors`: more than that exceeds the bound whatever the others do.
 */
function pmfRow(s: StratumSample, D: number, maxErrors: number): PmfRow {
  const lo = Math.max(0, s.sampled - (s.population - D));
  const hi = Math.min(s.sampled, D, maxErrors);
  if (hi < lo) return { lo, probs: new Float64Array(0) };
  const probs = new Float64Array(hi - lo + 1);
  for (let x = lo; x <= hi; x++) {
    probs[x - lo] = hypergeometricPmf(s.population, D, s.sampled, x);
  }
  return { lo, probs };
}

/**
 * P(weighted total of errors <= bound | allocation). Outcomes are combined stratum by stratum;
 * because the weights are positive, a partial total already above the bound can never come back
 * under it, so those branches are dropped early. Plain recursion over the strata's small tables:
 * this runs once per allocation, millions of times, so it allocates nothing.
 */
function allocationProbability(
  rows: readonly PmfRow[],
  weights: readonly number[],
  bound: number,
): number {
  const walk = (h: number, used: number): number => {
    if (h === rows.length) return 1;
    const row = rows[h]!;
    const weight = weights[h]!;
    let sum = 0;
    for (let k = 0; k < row.probs.length; k++) {
      const total = used + weight * (row.lo + k);
      if (total > bound) break;
      const p = row.probs[k]!;
      if (p > 0) sum += p * walk(h + 1, total);
    }
    return sum;
  };
  return walk(0, 0);
}
