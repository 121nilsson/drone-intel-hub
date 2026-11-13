import type { AssertionFrame, FrameValidationStatus } from "@/entities/drone/assertion-frame";
import { validateFrames } from "@/entities/drone/assertion-validation";
import { recordAutonomyEvent } from "@/shared/infra/autonomy/ledger.server";

/**
 * Writes the outcome of checking one post's assertion frames to the ledger. Diagnostic only: it
 * never touches a claim, a consensus or a count. There is deliberately no producer of frames in
 * the ingest flow yet, so nothing calls this except tests and a replay of fixtures.
 *
 * Why one event per post and not per frame: the ledger keeps every decision forever, so volume
 * is set here. The frames, their reasons and the evidence quotes go in `checks`, so an analyst
 * can go from a hit to the text it came from.
 */

export interface AssertionFrameCheckInput {
  sourceId?: string;
  sourceHash: string;
  frames: AssertionFrame[];
  correlationId?: string;
}

/** The worst status across the frames. No frames means nothing was shown to pass, so uncertain. */
function worstStatus(statuses: FrameValidationStatus[]): FrameValidationStatus {
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("uncertain") || statuses.length === 0) return "uncertain";
  return "pass";
}

export async function recordAssertionFrameCheck(input: AssertionFrameCheckInput): Promise<void> {
  // Recomputed here so the ledger reflects the current validator, not whatever status a producer
  // stamped on the frame when it was built.
  const checked = validateFrames(input.frames);
  const count = (s: FrameValidationStatus) =>
    checked.filter((f) => f.validationStatus === s).length;
  const fails = count("fail");
  const uncertain = count("uncertain");
  const firstFailure = checked.flatMap((f) =>
    f.validationStatus === "fail" ? (f.reasons ?? []) : [],
  )[0];

  await recordAutonomyEvent({
    action: "assertion_frame_check",
    actor: "assertion-frames",
    actorKind: "verifier",
    targetCollection: "dispatches",
    targetId: input.sourceId ?? input.sourceHash,
    category: worstStatus(checked.map((f) => f.validationStatus)),
    verdict: `${count("pass")} pass, ${uncertain} uncertain, ${fails} fail`,
    reason:
      `${checked.length} frame(s) checked, ${fails} failed, ${uncertain} uncertain` +
      (firstFailure ? `; first failure: ${firstFailure}` : ""),
    checks: checked.map((f) => ({
      sourceId: input.sourceId ?? null,
      sourceHash: input.sourceHash,
      frameId: f.frameId,
      sentenceIndex: f.sentenceIndex,
      predicate: f.predicate,
      evidence: f.evidence,
      status: f.validationStatus,
      reasons: f.reasons ?? [],
    })),
    reversible: false,
    correlationId: input.correlationId ?? null,
  });
}
