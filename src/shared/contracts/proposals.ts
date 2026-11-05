/**
 * What a learner - a heuristic miner, an AI, the audit, an analyst - may ask the system to
 * change. A proposal is DATA: it names a kind of change and carries a payload, and an applier
 * registered for that kind (shared/infra/proposals) is the only code that can act on it. A
 * proposer can therefore never smuggle behaviour through a payload, and a kind with no applier
 * is refused, not guessed at.
 *
 * Two things are decided by code and never taken from the proposer: the risk tier (it follows
 * from the kind and the payload, so an AI cannot declare its own change "low") and whether the
 * change may run without a person (`AUTO_APPLY_TIERS`). Pure and browser-safe.
 */

/** The shapes of change the learning ladder (get_human_out_of_the_loop_plan.md §5.3) can name. */
export const PROPOSAL_KINDS = [
  "rule",
  "normalizer",
  "prompt",
  "schema",
  "model_route",
  "code_patch",
] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export const RISK_TIERS = ["low", "medium", "high"] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

/**
 * The share of a tier's automatic actions that may be wrong (plan §4.5). Only the low budget can
 * be proven by sampling at this volume; the others are measured from reversals, or keep a gate.
 */
export const ERROR_BUDGET: Readonly<Record<RiskTier, number>> = {
  low: 0.05,
  medium: 0.02,
  high: 0.005,
};

/**
 * The tiers whose proposals may be applied without a person. Empty on purpose: Phase 3 of the
 * plan fills it with "low" once the audit shows verified precision inside the low budget. It is
 * the one line that moves a gate, so a reviewer finds it here and not spread over the appliers.
 */
export const AUTO_APPLY_TIERS: readonly RiskTier[] = [];

export const PROPOSERS = ["heuristic", "ai", "audit", "analyst"] as const;
export type Proposer = (typeof PROPOSERS)[number];

/** A passage that shows why the change is wanted. */
export interface ProposalEvidence {
  candidateId: string;
  source: string;
  span: string;
}

/** What a proposer supplies. No id, risk or time: those are assigned when it is admitted. */
export interface ProposalDraft {
  kind: ProposalKind;
  /** What it changes, in the applier's own terms, e.g. "add_cue:range" or a drone id. */
  target: string;
  payload: Record<string, unknown>;
  rationale: string;
  evidence: ProposalEvidence[];
  proposedBy: Proposer;
}

/** An admitted proposal: checked by its applier, with a risk tier the code assigned. */
export interface Proposal extends ProposalDraft {
  /** Deterministic from kind + target + payload, so proposing the same change twice dedupes. */
  id: string;
  risk: RiskTier;
  createdAt: string;
}

/** The result of an applier looking at a draft. */
export type ProposalCheck = { ok: true; risk: RiskTier } | { ok: false; reason: string };

/**
 * The code that understands one kind. `check` is pure and says whether the payload is well
 * formed and how risky it is; it never touches storage. Acting on an admitted proposal is the
 * server's job and is added with the first writer that uses it, together with the ledger event
 * kind it records.
 */
export interface ProposalApplier {
  kind: ProposalKind;
  check(draft: ProposalDraft): ProposalCheck;
}

export type ProposalAppliers = Partial<Record<ProposalKind, ProposalApplier>>;

export const MAX_PROPOSAL_EVIDENCE = 8;
export const MAX_RATIONALE_LENGTH = 2000;
export const MAX_SPAN_LENGTH = 1000;

/** FNV-1a over a string. Short and stable, not a security hash. */
export function fnv1a(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h.toString(36);
}

/** The canonical text of a payload: top-level keys sorted, so key order never changes an id. */
export const canonicalPayload = (payload: Record<string, unknown>) =>
  JSON.stringify(payload, Object.keys(payload).sort());
