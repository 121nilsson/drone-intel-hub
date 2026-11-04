import { normalizeExtraction } from "@/entities/normalization/apply";
import { semanticKeyFor } from "@/entities/normalization/semantic";
import { normalizeQuantityLoose } from "@/entities/normalization/units";
import { AUDIT_CONFIDENCE, errorRateUpperBound } from "@/entities/drone/audit";
import type { Drone } from "@/entities/drone/types";
import type { IntelExtractor } from "@/shared/contracts/ai";
import { comparableSpecs, numbersClose, type Norm } from "./evaluation";

/**
 * The heuristic scored against the frozen seed set (plan §9 Phase 2, §1).
 *
 * The seed set is the only reference in the system that is human ground truth, so the evaluation
 * score is reported next to how the same heuristic does against it: for every answered seed claim
 * the archived post is read once more - a "yes" answer means the figure must be found, a "no"
 * means it must not be produced, and "cannot tell" is excluded and reported, exactly as the audit
 * treats it. The disagreement bound is the audit's own Clopper-Pearson bound.
 *
 * PURE and seed-agnostic: this module never touches `verification_audit` and knows nothing about
 * where the rows come from. The server wrapper (`seed-agreement.server.ts`) loads the rows and
 * owns the only copy of the rule that nothing that learns may read the seed set - mining, shadow
 * scoring, fixtures and promotion never import either module.
 */

export interface SeedExpectation {
  semantic: string;
  value: number | string;
  unit?: string;
}

/** The one answered seed row the scorer needs: what was asked, what the human said, and the post. */
export interface SeedAnswerRow {
  specKey: string;
  specLabel: string;
  /** The value as the auditor was shown it ("40 kn (≈ 74.08 km/h)"). */
  value: string;
  postText?: string | undefined;
  answer: "yes" | "no" | "cannot_tell";
  /** The post says it, but it is plainly wrong: a reading the heuristic cannot be blamed for. */
  obviouslyWrong?: boolean | undefined;
}

export interface SeedAgreement {
  /** Answered seed rows the heuristic was scored on. */
  scored: number;
  /** Answered seed rows without a post snapshot to read, or the reader failed on them. */
  skipped: number;
  /** "Cannot tell" answers: neither found nor missed, excluded and reported. */
  cannotTell: number;
  /** The post states it and the heuristic reads it. */
  found: number;
  /** The post states it and the heuristic lost it. */
  missed: number;
  /** The post does not state it and the heuristic does not produce it. */
  avoided: number;
  /** The post does not state it but the heuristic produces it anyway. */
  invented: number;
  /**
   * Seed rows the auditor flagged "the post says it, but it is plainly wrong". Reported so a run
   * is not read as pure extraction quality; the heuristic still has to find what the post states.
   */
  obviouslyWrong: number;
  /** (found + avoided) / scored. */
  agreement: number;
  /** Errors (missed + invented), for the bound. */
  errors: number;
  /**
   * One-sided 95% upper bound on the disagreement rate, the audit's own bound, reported for scale.
   * The 5% budget belongs to verified precision, not to how often the heuristic reads a post the
   * same way a person did, so it is deliberately not applied here.
   */
  upperBound: number;
}

export const emptySeedAgreement = (): SeedAgreement => ({
  scored: 0,
  skipped: 0,
  cannotTell: 0,
  found: 0,
  missed: 0,
  avoided: 0,
  invented: 0,
  obviouslyWrong: 0,
  agreement: 0,
  errors: 0,
  upperBound: 1,
});

/**
 * The expectations one seed row puts on a fresh read, in the terms every fixture is compared in.
 * The source's own reading comes first; "40 kn (≈ 74.08 km/h)" also carries the catalogue's
 * conversion, which the heuristic is not asked to produce. Both readings are accepted: a post that
 * states either figure states the claim.
 */
export function seedExpectations(row: SeedAnswerRow): SeedExpectation[] {
  const semantic = semanticKeyFor(row.specKey, row.specLabel);
  const stated = row.value.split("(≈")[0]!.trim();
  const out: SeedExpectation[] = [];
  for (const v of new Set([stated, row.value])) {
    const q = normalizeQuantityLoose(v);
    if (q?.canonicalValue !== undefined)
      out.push({
        semantic,
        value: q.canonicalValue,
        ...(q.canonicalUnit ? { unit: q.canonicalUnit } : {}),
      });
    else out.push({ semantic, value: v });
  }
  return out;
}

/** The same matching checkFixture applies to every fixture, over the heuristic's comparable specs. */
export function seedFound(got: readonly Norm[], e: SeedExpectation): boolean {
  return got.some((g) => {
    if (g.semantic !== e.semantic) return false;
    if (typeof e.value === "number")
      return (
        g.canonical !== undefined &&
        numbersClose(g.canonical, e.value) &&
        (g.canonicalUnit ?? "") === (e.unit ?? "")
      );
    return String(g.value).toLowerCase() === String(e.value).toLowerCase();
  });
}

/**
 * Score the answers. `read` runs the heuristic over a post and returns its comparable specs, or
 * null when the read failed - a failed read is a skip, never an error: the seed set must not
 * punish a crashed extractor differently from a wrong one.
 */
export async function scoreSeedAnswers(
  rows: readonly SeedAnswerRow[],
  read: (text: string) => Promise<readonly Norm[] | null>,
): Promise<SeedAgreement> {
  const out = emptySeedAgreement();
  // Several seed claims often share one post; the heuristic reads each distinct post once.
  const cache = new Map<string, readonly Norm[] | null>();
  for (const row of rows) {
    if (row.answer === "cannot_tell") {
      out.cannotTell++;
      continue;
    }
    if (!row.postText?.trim()) {
      out.skipped++;
      continue;
    }
    if (row.obviouslyWrong) out.obviouslyWrong++;
    let got = cache.get(row.postText);
    if (got === undefined) {
      got = await read(row.postText);
      cache.set(row.postText, got);
    }
    if (!got) {
      out.skipped++;
      continue;
    }
    const has = seedExpectations(row).some((e) => seedFound(got!, e));
    if (row.answer === "yes") {
      if (has) out.found++;
      else out.missed++;
    } else if (has) out.invented++;
    else out.avoided++;
  }
  out.scored = out.found + out.missed + out.avoided + out.invented;
  out.errors = out.missed + out.invented;
  out.agreement = out.scored ? (out.found + out.avoided) / out.scored : 0;
  out.upperBound = out.scored ? errorRateUpperBound(out.scored, out.errors, AUDIT_CONFIDENCE) : 1;
  return out;
}

/** A post through the heuristic, as the scorer reads it. Failing reads return null. */
export async function readWith(
  heuristic: IntelExtractor,
  catalog: Drone[],
  text: string,
): Promise<readonly Norm[] | null> {
  try {
    return comparableSpecs(normalizeExtraction(await heuristic.extract(text, catalog)).extraction);
  } catch {
    return null;
  }
}
