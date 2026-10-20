/**
 * How automation earns the right to act on its own from analyst verdicts - the same bar the
 * generated rules clear (EVALUATION_FULL_AUTOMATION §4), applied to the contradiction check and
 * the deterministic corrector. Earned per category, recomputed on every run, so a category whose
 * agreement falls loses it again at once.
 */

export const TRUST_MIN_REVIEWS = 20;
export const TRUST_AGREEMENT = 0.95;
export const DISTRUST_MIN_REVIEWS = 10;
export const DISTRUST_AGREEMENT = 0.7;

export type TrustState = "earned" | "default" | "distrusted";

export interface TrustTally {
  /** Reviewed cases where the analyst reached the automation's verdict. */
  agreed: number;
  disagreed: number;
}

export function trustState({ agreed, disagreed }: TrustTally): TrustState {
  const n = agreed + disagreed;
  const share = n ? agreed / n : 0;
  if (n >= TRUST_MIN_REVIEWS && share >= TRUST_AGREEMENT) return "earned";
  if (n >= DISTRUST_MIN_REVIEWS && share < DISTRUST_AGREEMENT) return "distrusted";
  return "default";
}

/** Count agreement per category. `judge` returns the category and whether they agreed, or null. */
export function tallyBy<T>(
  items: Iterable<T>,
  judge: (item: T) => { category: string; agreed: boolean } | null,
): Map<string, TrustTally> {
  const out = new Map<string, TrustTally>();
  for (const item of items) {
    const j = judge(item);
    if (!j) continue;
    const t = out.get(j.category) ?? { agreed: 0, disagreed: 0 };
    if (j.agreed) t.agreed++;
    else t.disagreed++;
    out.set(j.category, t);
  }
  return out;
}
