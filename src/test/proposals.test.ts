import { describe, expect, it } from "vitest";
import { AUTO_APPLY_TIERS, PROPOSAL_KINDS, type ProposalDraft } from "@/shared/contracts/proposals";
import { PROPOSAL_APPLIERS, admitProposal, mayAutoApply } from "@/shared/infra/proposals/admit";
import { hypothesisId } from "@/shared/infra/evaluation/hypotheses";

const evidence = [{ candidateId: "c1", source: "t.me/x", span: "range of 40 km" }];
const draft = (over: Partial<ProposalDraft> = {}): ProposalDraft => ({
  kind: "rule",
  target: "add_cue:range",
  payload: { target: "range", terms: ["reach"] },
  rationale: "Reports say 'reach' where the extractor expects 'range'.",
  evidence,
  proposedBy: "ai",
  ...over,
});
const NOW = new Date("2026-11-05T12:00:00Z");

describe("admitting a proposal", () => {
  it("admits a well-formed rule and assigns its id, risk and time", () => {
    const r = admitProposal(draft(), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.proposal.id).toMatch(/^prop-rule-/);
    expect(r.proposal.risk).toBe("medium");
    expect(r.proposal.createdAt).toBe("2026-11-05T12:00:00.000Z");
  });

  it("gives the same id to the same change however its keys are ordered", () => {
    const a = admitProposal(draft({ payload: { target: "range", terms: ["reach"] } }), NOW);
    const b = admitProposal(draft({ payload: { terms: ["reach"], target: "range" } }), NOW);
    expect(a.ok && b.ok && a.proposal.id === b.proposal.id).toBe(true);
  });

  it("ignores a risk or id the proposer supplies", () => {
    const r = admitProposal(
      {
        ...draft({
          kind: "rule",
          target: "add_alias:*",
          payload: { droneId: "d1", alias: "Bars" },
        }),
        risk: "low",
        id: "mine",
      },
      NOW,
    );
    expect(r.ok && r.proposal.risk).toBe("high");
    expect(r.ok && r.proposal.id).not.toBe("mine");
  });

  it("assigns risk by what the rule can do, not by who proposed it", () => {
    const risk = (target: string, payload: Record<string, unknown>) => {
      const r = admitProposal(draft({ target, payload }), NOW);
      return r.ok ? r.proposal.risk : r.reason;
    };
    expect(risk("add_unit_scale:*", { unit: "лям", multiplier: 1e6 })).toBe("low");
    expect(risk("add_cue:range", { target: "range", terms: ["reach"] })).toBe("medium");
    expect(
      risk("context_filter:altitude", {
        key: "altitude",
        triggerWords: ["hit"],
        action: "suppress",
      }),
    ).toBe("medium");
    expect(risk("add_alias:*", { droneId: "d1", alias: "Bars" })).toBe("high");
    expect(risk("add_stopword:*", { word: "contract" })).toBe("high");
  });

  it("refuses every kind that has no applier", () => {
    for (const kind of PROPOSAL_KINDS.filter((k) => !PROPOSAL_APPLIERS[k])) {
      const r = admitProposal(draft({ kind }), NOW);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain("no applier");
    }
    // code_patch in particular is never applicable from inside the app.
    expect(PROPOSAL_APPLIERS.code_patch).toBeUndefined();
  });

  it("refuses a rule payload the engine's compiler would drop", () => {
    // A regex smuggled in as a term is exactly what the literal-terms DSL rejects.
    const r = admitProposal(draft({ payload: { target: "range", terms: ["(a+)+$"] } }), NOW);
    expect(r.ok).toBe(false);
    expect(
      admitProposal(
        draft({ target: "add_cue:range", payload: { target: "nope", terms: ["x"] } }),
        NOW,
      ).ok,
    ).toBe(false);
    expect(admitProposal(draft({ target: "drop_table:*" }), NOW).ok).toBe(false);
  });

  it("refuses malformed input without throwing", () => {
    for (const input of [null, undefined, 3, "x", [], {}, { ...draft(), kind: "rm -rf" }]) {
      expect(admitProposal(input, NOW).ok).toBe(false);
    }
    expect(admitProposal({ ...draft(), evidence: [] }, NOW).ok).toBe(false);
    expect(admitProposal({ ...draft(), evidence: [{ candidateId: 1 }] }, NOW).ok).toBe(false);
    expect(admitProposal({ ...draft(), rationale: "x".repeat(2001) }, NOW).ok).toBe(false);
    expect(admitProposal({ ...draft(), proposedBy: "root" }, NOW).ok).toBe(false);
    expect(admitProposal({ ...draft(), payload: [] }, NOW).ok).toBe(false);
    expect(admitProposal({ ...draft(), evidence: Array(9).fill(evidence[0]) }, NOW).ok).toBe(false);
  });
});

describe("the auto-apply gate", () => {
  it("is closed for every tier today", () => {
    expect(AUTO_APPLY_TIERS).toEqual([]);
    for (const risk of ["low", "medium", "high"] as const) {
      expect(mayAutoApply({ risk })).toBe(false);
    }
  });

  it("opens only the tiers the policy lists", () => {
    expect(mayAutoApply({ risk: "low" }, ["low"])).toBe(true);
    expect(mayAutoApply({ risk: "high" }, ["low"])).toBe(false);
  });
});

describe("hypothesis ids", () => {
  it("stay what they were before the hash moved to the contract", () => {
    // Stored rules are keyed by these; a change here would orphan them.
    // Literals computed with the original in-place FNV-1a before the move.
    expect(hypothesisId("add_cue", { target: "range", terms: ["reach"] })).toBe(
      "hyp-add_cue-1sev6ni",
    );
    expect(hypothesisId("add_alias", { droneId: "d1", alias: "Bars" })).toBe(
      "hyp-add_alias-ub0bzn",
    );
    expect(hypothesisId("add_cue", { terms: ["reach"], target: "range" })).toBe(
      "hyp-add_cue-1sev6ni",
    );
  });
});
