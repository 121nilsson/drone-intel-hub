import {
  AUTO_APPLY_TIERS,
  MAX_PROPOSAL_EVIDENCE,
  MAX_RATIONALE_LENGTH,
  MAX_SPAN_LENGTH,
  PROPOSAL_KINDS,
  PROPOSERS,
  canonicalPayload,
  fnv1a,
  type Proposal,
  type ProposalAppliers,
  type ProposalDraft,
} from "@/shared/contracts/proposals";
import { ruleApplier } from "./rule-applier";

/**
 * Appliers by kind. A kind with no entry here cannot be admitted, which is how the rest of the
 * ladder (normalizer, prompt, schema, model route, code patch) stays closed until its applier,
 * its tests and its ledger event kind arrive together.
 */
export const PROPOSAL_APPLIERS: ProposalAppliers = {
  rule: ruleApplier,
};

export type AdmitResult = { ok: true; proposal: Proposal } | { ok: false; reason: string };

const bad = (reason: string): AdmitResult => ({ ok: false, reason });

/**
 * Turn whatever a proposer produced into a Proposal, or say why not. The input is untrusted - an
 * AI's JSON arrives here - so the shape is checked field by field, the kind must have an
 * applier, and risk is set by that applier. Nothing is stored or applied.
 */
export function admitProposal(
  input: unknown,
  now: Date = new Date(),
  appliers: ProposalAppliers = PROPOSAL_APPLIERS,
): AdmitResult {
  if (!input || typeof input !== "object") return bad("a proposal must be an object");
  const d = input as Record<string, unknown>;

  const kind = d["kind"];
  if (typeof kind !== "string" || !(PROPOSAL_KINDS as readonly string[]).includes(kind))
    return bad("unknown proposal kind");
  const applier = appliers[kind as ProposalDraft["kind"]];
  if (!applier) return bad(`no applier is registered for "${kind}" proposals`);

  const proposedBy = d["proposedBy"];
  if (typeof proposedBy !== "string" || !(PROPOSERS as readonly string[]).includes(proposedBy))
    return bad("unknown proposer");
  const target = d["target"];
  if (typeof target !== "string" || !target.trim() || target.length > 200)
    return bad("target must be a short non-empty string");
  const payload = d["payload"];
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return bad("payload must be an object");
  const rationale = d["rationale"];
  if (typeof rationale !== "string" || !rationale.trim() || rationale.length > MAX_RATIONALE_LENGTH)
    return bad("rationale is required and must be short");

  const rawEvidence = d["evidence"];
  if (!Array.isArray(rawEvidence) || !rawEvidence.length)
    return bad("a proposal needs at least one piece of evidence");
  if (rawEvidence.length > MAX_PROPOSAL_EVIDENCE) return bad("too much evidence");
  const evidence: ProposalDraft["evidence"] = [];
  for (const e of rawEvidence) {
    const r = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
    const { candidateId, source, span } = r;
    if (typeof candidateId !== "string" || typeof source !== "string" || typeof span !== "string")
      return bad("evidence needs candidateId, source and span");
    if (!span.trim() || span.length > MAX_SPAN_LENGTH) return bad("evidence span out of range");
    evidence.push({ candidateId, source, span });
  }

  // `risk` or `id` in the input is ignored, not trusted: both are assigned below.
  const draft: ProposalDraft = {
    kind: kind as ProposalDraft["kind"],
    target: target.trim(),
    payload: payload as Record<string, unknown>,
    rationale: rationale.trim(),
    evidence,
    proposedBy: proposedBy as ProposalDraft["proposedBy"],
  };
  const checked = applier.check(draft);
  if (!checked.ok) return bad(checked.reason);

  return {
    ok: true,
    proposal: {
      ...draft,
      id: `prop-${draft.kind}-${fnv1a(`${draft.target}:${canonicalPayload(draft.payload)}`)}`,
      risk: checked.risk,
      createdAt: now.toISOString(),
    },
  };
}

/** Whether a proposal may be applied without a person: only for tiers the policy has opened. */
export const mayAutoApply = (p: Pick<Proposal, "risk">, tiers = AUTO_APPLY_TIERS): boolean =>
  tiers.includes(p.risk);
