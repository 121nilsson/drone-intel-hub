import type { Candidate, Drone } from "@/entities/drone/types";
import type { IntelExtractor } from "@/shared/contracts/ai";
import { MIN_RAW, type EvalFixture } from "./evaluation-types";
import { comparableSpecs, isDropped, isExcluded } from "./compare";
import {
  analystVerdicts,
  verdictMatches,
  verdictsFor,
  verifiedReference,
  type AnalystVerdicts,
  type ReferenceVerdicts,
} from "./reference";
import { checkFixture } from "./fixture-check";

/**
 * Regression fixtures derived from the catalogue's verdicts and from queue decisions. Derived on
 * every load rather than stored, so an undone verdict takes its expectation with it.
 */

/**
 * Regression fixtures from the catalogue's verdicts: per candidate, a positive one (verified or
 * confirmed figures must keep being found) and a negative one (rejected figures must not come
 * back), the same split as the two git corpora. Uncertain claims are left out: the verifier could
 * not decide, so a rule is neither required to find nor forbidden to produce them. Derived from
 * the catalogue on every load rather than stored, so an undone verdict takes its expectation with
 * it.
 *
 * "About another system" is left out: a fixture checks the whole text's output, and the figure
 * may well be right for another system the same report names.
 */
function fixturesFrom(
  candidates: readonly Candidate[],
  verdicts: ReferenceVerdicts,
): EvalFixture[] {
  const out: EvalFixture[] = [];
  for (const c of candidates) {
    if (!c.raw?.trim()) continue;
    const ref = comparableSpecs(c.extraction);
    const expect: EvalFixture["expect"] = [];
    const forbid: NonNullable<EvalFixture["forbid"]> = [];
    const seen = new Set<string>();
    let reviewed = false;
    for (const v of verdictsFor(c, verdicts)) {
      if (v.issue === "system") continue;
      const state = v.verdict ?? v.verification;
      // No verdict, or an uncertain one, is not an expectation either way.
      if (!v.verdict && v.verification !== "verified" && v.verification !== "rejected") continue;
      // An analyst verdict keeps the candidate's fixture under the id eval_corpus already keys,
      // even when a machine-verified duplicate expectation would have carried it first.
      if (v.verdict) reviewed = true;
      // In the same canonical terms checkFixture compares a fresh run in.
      const n = ref.find((x) => verdictMatches(v, x));
      const value = n?.canonical ?? v.canonical ?? n?.value ?? v.value;
      const unit = n?.canonical !== undefined ? n.canonicalUnit : v.canonicalUnit;
      const key = `${v.semantic}|${value}|${unit ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      (state === "confirmed" || state === "verified" ? expect : forbid).push({
        semantic: v.semantic,
        value,
        ...(unit ? { unit } : {}),
      });
    }
    // "review-", not "analyst-": eval_corpus still holds retired Queue fixtures under
    // "analyst-<candidate id>" (migration 015), and loadFixtures keys every source by id. A
    // machine-verified fixture gets its own id so it can retire with the verification that
    // produced it.
    const prefix = reviewed ? "review" : "verified";
    const base = { source: c.source, text: c.raw, status: "approved" as const };
    if (expect.length) out.push({ ...base, id: `${prefix}-${c.id}`, expect });
    if (forbid.length) out.push({ ...base, id: `${prefix}-neg-${c.id}`, expect: [], forbid });
  }
  return out;
}

/** Fixtures from analyst verdicts only: the pre-verifier behaviour, kept for its call sites. */
export function analystFixtures(
  candidates: readonly Candidate[],
  verdicts: AnalystVerdicts,
): EvalFixture[] {
  return fixturesFrom(candidates, verdicts);
}

/** Fixtures from both machine verification and analyst verdicts (plan §4.4). */
export function verifiedFixtures(
  candidates: readonly Candidate[],
  verdicts: ReferenceVerdicts,
): EvalFixture[] {
  return fixturesFrom(candidates, verdicts);
}

/**
 * Analyst fixtures for the git corpora, which replay without a baseline: a positive one joins
 * only while today's heuristic passes it, and a negative one the heuristic still fails is marked
 * pending_fix, which the mismatch suite skips until a rule fixes it.
 */
export async function analystCorpus(
  candidates: readonly Candidate[],
  catalog: Drone[],
  heuristic: IntelExtractor,
): Promise<{ positive: EvalFixture[]; negative: EvalFixture[] }> {
  const positive: EvalFixture[] = [];
  const negative: EvalFixture[] = [];
  for (const fx of analystFixtures(candidates, analystVerdicts(catalog))) {
    const r = await checkFixture(fx, heuristic, catalog);
    if (fx.forbid?.length)
      negative.push(r.forbidden.length ? { ...fx, status: "pending_fix" } : fx);
    else if (!r.missing.length) positive.push(fx);
  }
  return { positive, negative };
}

/**
 * Regression fixtures from Queue decisions: a candidate an analyst promoted or merged is a report
 * whose figures they accepted, so the heuristic should keep finding them. Only the figures that
 * survive the reference (none the AI dropped, an analyst rejected or the verifier could not
 * decide), in canonical terms. A discarded candidate yields nothing: the analyst rejected the
 * report, and its figures may be right or wrong. Derived from the candidates' current state like
 * verifiedFixtures, so an undone decision takes its fixture with it.
 */
export function queueFixtures(
  candidates: readonly Candidate[],
  verdicts: ReferenceVerdicts,
): EvalFixture[] {
  const out: EvalFixture[] = [];
  for (const c of candidates) {
    if (c.resolvedBy !== "analyst" || (c.status !== "promoted" && c.status !== "merged")) continue;
    if ((c.raw?.trim().length ?? 0) < MIN_RAW) continue;
    const expect = verifiedReference(c, verdicts)
      .filter((n) => !isDropped(n) && !isExcluded(n))
      .map((n) => {
        const unit = n.canonical !== undefined ? n.canonicalUnit : n.unit;
        return { semantic: n.semantic, value: n.canonical ?? n.value, ...(unit ? { unit } : {}) };
      });
    if (expect.length)
      out.push({ id: `queue-${c.id}`, source: c.source, text: c.raw, expect, status: "approved" });
  }
  return out;
}
