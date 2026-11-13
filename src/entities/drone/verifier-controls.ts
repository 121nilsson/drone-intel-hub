/**
 * The verifier controls (migrations/025): what the second reader's "supported" is measured
 * against when the answer is known by construction. Pure. The server asks the reader about a
 * claim whose figure was changed to one its post does not contain; any "supported" on it is a
 * false support. Nothing here reads or writes the catalogue, and nothing here reads the audit.
 */
import {
  alteredReading,
  AUDIT_BUDGET,
  attributeFamily,
  errorRateUpperBound,
  textLanguage,
  type AuditLanguage,
} from "./audit";
import { cleanReading } from "./claim-reading";
import { ANALYST_SOURCE } from "./claim-review";
import { readerOpposes } from "./entailment-verdict";
import { attributeSemantic } from "./spec-engine";
import type { Drone, SpecAttribute, SpecClaim, StoredEntailmentVerdict } from "./types";
import { figuresIn } from "./value-in-quote";

/**
 * The altered value a control shows: the claim's clean reading (the value a real question carries)
 * with every figure scaled to one the post does not contain. Undefined when no factor works.
 */
export function alteredControlValue(
  spec: SpecAttribute,
  claim: SpecClaim,
  postText: string,
): string | undefined {
  return alteredReading(cleanReading(spec, claim), figuresIn(postText));
}

/** Fewer decided answers than this and a stratum's bound says nothing a person should act on. */
export const STRATUM_MIN = 20;

/** A verified claim the controls may draw, with what the server needs to ask about it. */
export interface ControlCandidate {
  drone: Drone;
  spec: SpecAttribute;
  claim: SpecClaim & { id: string; sourceId: string };
  family: string;
  language: AuditLanguage;
}

/**
 * Machine-verified claims a control may be built from: a stable id and a source post, verified
 * with a passing unit check (the same test the audit uses to draw its altered controls), not an
 * analyst's entry, and not already asked at the current entailment version.
 *
 * Family and language are derived as the audit sampler derives them. The language reads the post
 * when `postTexts` has it, as the audit does; without it, the claim's own quote stands in.
 */
export function controlCandidates(
  drones: readonly Drone[],
  alreadyAsked: ReadonlySet<string>,
  postTexts: ReadonlyMap<string, string> = new Map(),
): ControlCandidate[] {
  return drones.flatMap((drone) =>
    drone.specs.flatMap((spec) =>
      spec.claims.flatMap((claim): ControlCandidate[] => {
        if (!claim.id || !claim.sourceId) return [];
        if (claim.source === ANALYST_SOURCE || claim.extractionEngine === "analyst") return [];
        if (alreadyAsked.has(claim.id)) return [];
        const verification = claim.verification;
        if (verification?.state !== "verified") return [];
        if (!verification.checks.some((c) => c.kind === "unit_dimension" && c.verdict === "pass"))
          return [];
        const postText = postTexts.get(claim.sourceId);
        return [
          {
            drone,
            spec,
            claim: claim as SpecClaim & { id: string; sourceId: string },
            family: attributeFamily(attributeSemantic(spec)),
            language: textLanguage(postText ?? claim.evidence ?? claim.raw ?? String(claim.value)),
          },
        ];
      }),
    ),
  );
}

/** One answer of the second reader to a control, as stored. */
export interface ControlAnswer {
  verdict: StoredEntailmentVerdict;
  family?: string | null;
  language?: string | null;
}

export interface ControlSummary {
  asked: number;
  supported: number;
  /**
   * The reader opposed the altered figure: contradicted, not found, or the legacy "unsupported". A
   * control is wrong by construction, so either of the first two is a catch; they are not told apart.
   */
  unsupported: number;
  uncertain: number;
  /** One-sided 95 % upper bound on how often the reader's "supported" is a false support. */
  falseSupportBound: number;
}

export interface ControlStratum extends ControlSummary {
  family: string;
  language: string;
  status: "within" | "over" | "too_few";
}

/**
 * The reader's record on the controls as a whole. Uncertain answers are not decided, so the bound
 * is over supported + unsupported, with the supported ones as the errors.
 */
export function summarizeControls(rows: readonly ControlAnswer[]): ControlSummary {
  const supported = rows.filter((r) => r.verdict === "supported").length;
  const unsupported = rows.filter((r) => readerOpposes(r.verdict)).length;
  return {
    asked: rows.length,
    supported,
    unsupported,
    uncertain: rows.length - supported - unsupported,
    falseSupportBound: errorRateUpperBound(supported + unsupported, supported),
  };
}

/**
 * The same record per family and language, worst first: an over-budget stratum before one that
 * is too small to judge, and within each group the higher bound first.
 */
export function controlStrata(rows: readonly ControlAnswer[]): ControlStratum[] {
  const groups = new Map<string, { family: string; language: string; rows: ControlAnswer[] }>();
  for (const r of rows) {
    const family = r.family ?? "";
    const language = r.language ?? "";
    const key = `${family}\u0000${language}`;
    const g = groups.get(key) ?? { family, language, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  const rank = { over: 0, too_few: 1, within: 2 } as const;
  return [...groups.values()]
    .map((g): ControlStratum => {
      const s = summarizeControls(g.rows);
      const decided = s.supported + s.unsupported;
      const status =
        decided < STRATUM_MIN ? "too_few" : s.falseSupportBound > AUDIT_BUDGET ? "over" : "within";
      return { ...s, family: g.family, language: g.language, status };
    })
    .sort(
      (a, b) =>
        rank[a.status] - rank[b.status] ||
        b.falseSupportBound - a.falseSupportBound ||
        a.family.localeCompare(b.family) ||
        a.language.localeCompare(b.language),
    );
}
