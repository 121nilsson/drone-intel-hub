import type { Candidate, ClaimIssue, Drone, VerificationState } from "@/entities/drone/types";
import { attributeSemantic } from "@/entities/drone/spec-engine";
import { comparableSpecs, numbersClose, type Norm } from "./compare";

/**
 * The catalogue's verdict on each claim a report became: the verifier's conclusion and any
 * analyst verdict, keyed by the report's source line. This is the reference the scores use.
 */

/**
 * What the catalogue knows about one claim that came from a report: what the verifier concluded,
 * and what an analyst said about it if they looked. Keyed by the report's source line.
 */
export interface ReferenceVerdict {
  droneId: string;
  semantic: string;
  value: string;
  canonical?: number | undefined;
  canonicalUnit?: string | undefined;
  /** The verifier's conclusion, absent when it has not run on this claim. */
  verification?: VerificationState | undefined;
  /** The analyst's verdict, which outranks the verifier in both directions. */
  verdict?: "confirmed" | "rejected" | undefined;
  issue?: ClaimIssue | undefined;
}

export type ReferenceVerdicts = ReadonlyMap<string, readonly ReferenceVerdict[]>;

/** Only the claims an analyst has ruled on. */
export type AnalystVerdict = ReferenceVerdict & { verdict: "confirmed" | "rejected" };
export type AnalystVerdicts = ReadonlyMap<string, readonly AnalystVerdict[]>;

/** Every analyst verdict on a claim that came from a report. Hand-entered values have no report. */
export function analystVerdicts(catalog: readonly Drone[]): AnalystVerdicts {
  const out = new Map<string, AnalystVerdict[]>();
  for (const d of catalog)
    for (const s of d.specs)
      for (const c of s.claims) {
        if (!c.review || c.extractionEngine === "analyst") continue;
        const list = out.get(c.source) ?? [];
        list.push({
          droneId: d.id,
          semantic: attributeSemantic(s),
          value: String(c.value),
          canonical: c.normalized?.canonicalValue,
          canonicalUnit: c.normalized?.canonicalUnit,
          verdict: c.review.verdict,
          issue: c.review.issue,
        });
        out.set(c.source, list);
      }
  return out;
}

/**
 * Every claim a verifier or an analyst has judged, keyed by the report it came from. This is the
 * reference `verifiedReference` builds on: an unverified claim is still scored, but the report
 * says how much of the reference that score rests on.
 */
export function verifiedVerdicts(catalog: readonly Drone[]): ReferenceVerdicts {
  const out = new Map<string, ReferenceVerdict[]>();
  for (const d of catalog)
    for (const s of d.specs)
      for (const c of s.claims) {
        if (c.extractionEngine === "analyst") continue;
        if (!c.verification && !c.review) continue;
        const list = out.get(c.source) ?? [];
        list.push({
          droneId: d.id,
          semantic: attributeSemantic(s),
          value: String(c.value),
          canonical: c.normalized?.canonicalValue,
          canonicalUnit: c.normalized?.canonicalUnit,
          ...(c.verification ? { verification: c.verification.state } : {}),
          ...(c.review ? { verdict: c.review.verdict, issue: c.review.issue } : {}),
        });
        out.set(c.source, list);
      }
  return out;
}

/**
 * A verdict belongs to the candidate that fed that entry. A report naming two systems has one
 * candidate per system, and a figure rejected as "about another system" on one of them may still
 * be right for the other.
 */
function feeds(c: Candidate, droneId: string): boolean {
  return (
    c.resolvedInto === droneId ||
    c.extraction.matchId === droneId ||
    (c.extraction.systems ?? []).some((s) => s.matchId === droneId)
  );
}

export function verdictMatches(v: ReferenceVerdict, n: Norm): boolean {
  if (v.semantic !== n.semantic) return false;
  if (String(n.value) === v.value) return true;
  return (
    v.canonical !== undefined &&
    n.canonical !== undefined &&
    numbersClose(v.canonical, n.canonical) &&
    (v.canonicalUnit ?? "") === (n.canonicalUnit ?? "")
  );
}

/** The verdicts on claims this candidate fed into the catalogue. */
export function verdictsFor(
  c: Candidate,
  verdicts: ReferenceVerdicts,
): readonly ReferenceVerdict[] {
  return (verdicts.get(c.source) ?? []).filter((v) => feeds(c, v.droneId));
}

/**
 * Prefer a definite verdict when the same figure is filed under two systems. An analyst outranks
 * a machine verdict, and a definite machine verdict beats one that could not decide.
 */
function chooseVerdict(mine: readonly ReferenceVerdict[], n: Norm): ReferenceVerdict | undefined {
  const matches = mine.filter((v) => verdictMatches(v, n));
  return (
    matches.find((v) => v.verdict) ??
    matches.find((v) => v.verification === "verified") ??
    matches.find((v) => v.verification === "rejected") ??
    matches[0]
  );
}

/**
 * What a heuristic run on this candidate is scored against: the stored extraction, with the
 * catalogue's verdict on each claim it became.
 *
 * A verified claim counts even when the AI dropped it, a rejected one counts as an expected
 * negative, and an uncertain one is left out rather than scored as a miss (plan §4.4). An analyst
 * verdict still overrides the verifier in both directions. A claim nobody has judged keeps the
 * stored reading as a fallback, so an unverified catalogue behaves exactly as it did before.
 */
export function verifiedReference(c: Candidate, verdicts: ReferenceVerdicts): Norm[] {
  const ref = comparableSpecs(c.extraction);
  const mine = verdictsFor(c, verdicts);
  if (!mine.length) return ref;
  return ref.map((n) => {
    const v = chooseVerdict(mine, n);
    if (!v) return n;
    return {
      ...n,
      ...(v.verdict ? { verdict: v.verdict } : {}),
      ...(v.verification ? { verification: v.verification } : {}),
    };
  });
}
