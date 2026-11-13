import type { AuditStatus } from "@/shared/contracts/verification";

export const DECISION: Record<
  AuditStatus["decision"],
  { label: string; tone: "success" | "danger" | "warning" | "muted"; says: string }
> = {
  pass: {
    label: "pass",
    tone: "success",
    says: "Verified precision is proven within the budget, at the formal evaluation's single analysis.",
  },
  fail: {
    label: "fail",
    tone: "danger",
    says: "Every claim of a fully audited population was checked, and more of them are wrong than the budget allows.",
  },
  not_proven: {
    label: "not proven",
    tone: "warning",
    says: "The formal evaluation is complete, but its upper bound is above the budget: precision is not proven.",
  },
  incomplete: {
    label: "incomplete",
    tone: "warning",
    says: "The exact bound could not be computed within its limit. That is never a pass.",
  },
  continue: {
    label: "open",
    tone: "muted",
    says: "Not settled yet: the gate is one analysis over a fixed sample of 200 valid answers. Earlier figures are information, not a decision.",
  },
};
