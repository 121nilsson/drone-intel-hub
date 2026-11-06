import { createServerFn } from "@tanstack/react-start";
import type {
  TokenUsageToday,
  AuditAnswer,
  AuditDisagreement,
  AuditSecondLook,
  AuditStatus,
  VerificationRunReport,
} from "@/shared/contracts/verification";

/**
 * Browser bridge to verification on the server: the deterministic run over the whole archive, and
 * the audit of its `verified` claims. Server modules are imported inside the handlers so the
 * database driver stays out of the browser bundle.
 */

export const triggerServerVerification = createServerFn({ method: "POST" }).handler(
  async (): Promise<VerificationRunReport> => {
    const { runServerVerification } = await import("./verify.server");
    const { recordTaskRun } = await import("@/shared/infra/task-runs.server");
    return await recordTaskRun("verification:run", "manual", runServerVerification, (r) => ({
      status: "ok",
      summary: `${r.checked} checked, ${r.changed} updated, ${r.missingText} without post`,
    }));
  },
);

export const fetchAuditStatus = createServerFn({ method: "POST" })
  .validator((d: unknown) => ({
    countUndrawn: !!(d && typeof d === "object" && (d as Record<string, unknown>)["countUndrawn"]),
  }))
  .handler(async ({ data }): Promise<AuditStatus> => {
    const { auditStatus } = await import("./audit.server");
    return await auditStatus(data);
  });

export const drawAuditFirstSession = createServerFn({ method: "POST" }).handler(async () => {
  const { drawFirstSession } = await import("./audit.server");
  return await drawFirstSession();
});

export const drawAuditBatch = createServerFn({ method: "POST" }).handler(async () => {
  const { drawMore } = await import("./audit.server");
  return await drawMore();
});

const ANSWERS: readonly AuditAnswer[] = ["yes", "no", "cannot_tell"];

export const answerAuditItem = createServerFn({ method: "POST" })
  .validator((d: unknown) => {
    const o = d && typeof d === "object" ? (d as Record<string, unknown>) : {};
    const id = typeof o["id"] === "string" ? o["id"].slice(0, 100) : "";
    const answer = ANSWERS.find((a) => a === o["answer"]);
    if (!id || !answer) throw new Error("Invalid audit answer");
    return {
      id,
      answer,
      obviouslyWrong: o["obviouslyWrong"] === true,
      readVia: o["readVia"] === "translation" ? ("translation" as const) : ("original" as const),
    };
  })
  .handler(async ({ data }) => {
    const { answerAudit } = await import("./audit.server");
    await answerAudit(data);
    return { ok: true };
  });

export const disputeAuditControl = createServerFn({ method: "POST" })
  .validator((d: unknown) => {
    const o = d && typeof d === "object" ? (d as Record<string, unknown>) : {};
    const id = typeof o["id"] === "string" ? o["id"].slice(0, 100) : "";
    if (!id) throw new Error("Invalid control");
    return { id, disputed: o["disputed"] !== false };
  })
  .handler(async ({ data }) => {
    const { disputeControl } = await import("./audit.server");
    await disputeControl(data);
    return { ok: true };
  });

export const fetchAuditDisagreements = createServerFn({ method: "POST" }).handler(
  async (): Promise<AuditDisagreement[]> => {
    const { auditDisagreements } = await import("./audit.server");
    return await auditDisagreements();
  },
);

export const recordSecondLook = createServerFn({ method: "POST" })
  .validator((d: unknown) => {
    const o = d && typeof d === "object" ? (d as Record<string, unknown>) : {};
    const id = typeof o["id"] === "string" ? o["id"].slice(0, 100) : "";
    const look = o["look"];
    if (!id || (look !== null && look !== "stands" && look !== "reader_right"))
      throw new Error("Invalid second look");
    return { id, look: look as AuditSecondLook | null };
  })
  .handler(async ({ data }) => {
    const { setSecondLook } = await import("./audit.server");
    await setSecondLook(data);
    return { ok: true };
  });

export const triggerEntailment = createServerFn({ method: "POST" }).handler(async () => {
  const { runEntailment } = await import("./entailment.server");
  const { recordTaskRun, entailmentOutcome } = await import("@/shared/infra/task-runs.server");
  return await recordTaskRun("verification:ai", "manual", runEntailment, entailmentOutcome);
});

export const fetchTokenUsage = createServerFn({ method: "GET" }).handler(
  async (): Promise<TokenUsageToday> => {
    const { tokenUsageToday } = await import("./entailment.server");
    return await tokenUsageToday();
  },
);
