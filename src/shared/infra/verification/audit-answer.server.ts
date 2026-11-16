import type { AuditAnswer, AuditSecondLook } from "@/shared/contracts/verification";
import { serverServices } from "@/shared/infra/server-services.server";

/** The person's answers, disputes and second looks on audit items. */
export async function answerAudit(input: {
  id: string;
  answer: AuditAnswer;
  obviouslyWrong: boolean;
  readVia: "original" | "translation";
}): Promise<void> {
  const found = await serverServices().audit.recordAnswer(input);
  if (!found) throw new Error("No such audit item");
}

/**
 * The owner's dispute of a failed 'misread' control: the post did state the figure for this
 * system, so the control was wrong and voids nothing. An 'altered' control is wrong by
 * construction and cannot be disputed. `disputed: false` withdraws a dispute.
 */
export async function disputeControl(input: { id: string; disputed: boolean }): Promise<void> {
  const found = await serverServices().audit.recordDispute({
    id: input.id,
    disputedAt: input.disputed ? new Date() : null,
  });
  if (!found) throw new Error("Only a control of the first sessions' kind can be disputed");
}

/**
 * The person's second look at a contradicted answer, or null to clear it. A note about the reader
 * and about the person's own habits: it does not change `answer`, which is what the audit counts.
 */
export async function setSecondLook(input: {
  id: string;
  look: AuditSecondLook | null;
}): Promise<void> {
  const found = await serverServices().audit.recordSecondLook(input);
  if (!found) throw new Error("No such answered audit item");
}
