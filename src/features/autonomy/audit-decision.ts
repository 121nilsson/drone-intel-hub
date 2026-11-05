import type { AuditStatus } from "@/shared/contracts/verification";

export const DECISION: Record<
  AuditStatus["decision"],
  { label: string; tone: "success" | "danger" | "warning" | "muted"; says: string }
> = {
  pass: {
    label: "pass",
    tone: "success",
    says: "Verified precision is proven within the budget.",
  },
  fail: {
    label: "fail",
    tone: "danger",
    says: "Verified claims are proven to be wrong more often than the budget allows.",
  },
  not_proven: {
    label: "not proven",
    tone: "warning",
    says: "The audit reached its maximum without proving precision within the budget.",
  },
  continue: {
    label: "open",
    tone: "muted",
    says: "Not settled yet: the first decision is after 100 answers, then after every 50.",
  },
};
