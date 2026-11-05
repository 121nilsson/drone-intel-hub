import type { ClaimIssue, VerificationCheck, VerificationKind } from "@/entities/drone/types";

/** Why a claim was ruled out, as the analyst reads it on the tag. */
export const ISSUE_LABEL: Record<ClaimIssue, string> = {
  value: "the figure is wrong",
  unit: "the unit or parse is wrong",
  system: "it is about another system",
  attribute: "it belongs to another attribute",
};

/** The same reasons as the buttons that pick them. */
export const ISSUE_BUTTON: Record<ClaimIssue, string> = {
  value: "Wrong figure",
  unit: "Wrong unit or parse",
  system: "About another system",
  attribute: "About another attribute",
};

/** What each deterministic check asks, in the reader's words. */
export const CHECK_LABEL: Record<VerificationKind, string> = {
  evidence_span: "Evidence in the source",
  unit_dimension: "Unit matches the attribute",
  bounds: "Figure is plausible",
  identity: "Evidence names this system",
  target: "Figure is for the attribute's target",
  value_in_quote: "Quote states the value",
  attribute_words: "The figure's words fit the attribute",
  ai_entailment: "AI read the source as saying this",
  cross_source: "Other sources agree",
  reference: "Matches the reference",
};

export const checkMark = (c: VerificationCheck) =>
  !c.applicable ? "·" : c.verdict === "pass" ? "✓" : c.verdict === "fail" ? "✕" : "?";

export const checkTone = (c: VerificationCheck) =>
  !c.applicable
    ? "text-muted-foreground"
    : c.verdict === "pass"
      ? "text-primary"
      : c.verdict === "fail"
        ? "text-destructive"
        : "text-muted-foreground";
