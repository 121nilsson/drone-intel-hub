import { useState } from "react";
import type { ClaimIssue, SpecAttribute } from "@/entities/drone/types";
import { useDrones, useServices } from "@/shared/infra/use-services";
import { Input, Select } from "@/shared/ui/fields";
import { Btn, Tag } from "@/shared/ui/primitives";
import { correctionMark, describeCorrection } from "@/shared/ui/correction";
import { ISSUE_BUTTON, ISSUE_LABEL } from "./provenance-labels";
import type { ClaimSelection } from "./provenance-types";

/**
 * The analyst's verdict on one claim. "Correct" applies at once; a wrong figure or unit first
 * asks for the right figure, which is optional.
 *
 * "About another attribute" and "about another system" move the claim: a speed read as a height
 * is not a wrong figure but a wrong place, so the figure is filed under the attribute or entry it
 * describes and kept on the record where the post put it.
 */
export function ClaimReviewPanel({
  droneId,
  selection,
  specs,
}: {
  droneId: string;
  selection: ClaimSelection;
  specs: readonly SpecAttribute[];
}) {
  const svc = useServices();
  const drones = useDrones();
  const [issue, setIssue] = useState<ClaimIssue | null>(null);
  const [correct, setCorrect] = useState("");
  const [target, setTarget] = useState("");
  const [targetDroneId, setTargetDroneId] = useState("");
  const { spec, claim } = selection;
  const review = claim.review;
  const apply = (verdict: Parameters<typeof svc.catalog.reviewClaim>[3]) => {
    svc.catalog.reviewClaim(droneId, spec.key, claim, verdict);
    setIssue(null);
    setCorrect("");
  };
  const reset = () => {
    setIssue(null);
    setTarget("");
    setTargetDroneId("");
    setCorrect("");
  };
  const move = () => {
    if (!target) return;
    svc.catalog.moveClaim(droneId, spec.key, claim, target, correct.trim());
    reset();
  };
  const moveSystem = () => {
    if (!targetDroneId || !target) return;
    svc.catalog.moveClaimToSystem(droneId, spec.key, claim, targetDroneId, target, correct.trim());
    reset();
  };
  const undo = () => {
    if (review?.movedToDroneId) {
      svc.catalog.undoMoveClaimToSystem(droneId, spec.key, claim);
      reset();
      return;
    }
    apply(null);
  };
  const fix = claim.autoCorrection;
  // A filed copy is the destination side of a move, not an independent verdict: undoing it here
  // would clear its review while leaving the original claim rejected.
  const filedCopy = Boolean(claim.movedFrom);
  const targetDrone = drones.find((d) => d.id === targetDroneId);
  const targetSpecs = targetDrone?.specs ?? [];
  const targetUnit = targetSpecs.find((s) => s.key === target)?.unit;
  const movedToDrone = review?.movedToDroneId
    ? drones.find((d) => d.id === review.movedToDroneId)
    : undefined;
  const movedTo = review?.movedTo
    ? (movedToDrone?.specs ?? specs).find((s) => s.key === review.movedTo)
    : undefined;
  return (
    <div className="space-y-2 border-t border-border pt-4">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Analyst review
      </p>
      {fix && !review && (
        <div className="space-y-2 border border-border bg-secondary/40 p-3">
          <p className="text-xs">
            <span className="font-mono text-primary">{correctionMark(fix)}</span> —{" "}
            {describeCorrection(fix)}
          </p>
          <div className="flex flex-wrap gap-2">
            <Btn
              size="sm"
              onClick={() => svc.catalog.reviewCorrection(droneId, spec.key, claim, true)}
            >
              {fix.kind === "unit" ? "Accept correction" : "Reject figure"}
            </Btn>
            <Btn
              variant="ghost"
              size="sm"
              onClick={() => svc.catalog.reviewCorrection(droneId, spec.key, claim, false)}
            >
              Figure is right
            </Btn>
          </div>
        </div>
      )}
      {review ? (
        <div className="flex flex-wrap items-center gap-2">
          <Tag tone={review.verdict === "rejected" ? "danger" : "success"}>
            {review.verdict === "rejected"
              ? `Rejected — ${ISSUE_LABEL[review.issue ?? "value"]}`
              : "Confirmed"}
          </Tag>
          {movedTo && (
            <Tag mono>
              filed under{" "}
              {movedToDrone && (
                <>
                  {movedToDrone.name}
                  {" · "}
                </>
              )}
              {movedTo.label}
            </Tag>
          )}
          {filedCopy && <Tag mono>filed copy</Tag>}
          <span className="font-mono text-xs text-muted-foreground">{review.at.slice(0, 10)}</span>
          {!filedCopy && (
            <Btn variant="ghost" size="sm" onClick={undo}>
              Undo
            </Btn>
          )}
        </div>
      ) : issue === "system" ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            moveSystem();
          }}
        >
          <label className="block text-xs text-muted-foreground">
            Belongs to system
            <Select
              autoFocus
              value={targetDroneId}
              onChange={(e) => {
                setTargetDroneId(e.target.value);
                setTarget("");
              }}
              className="mt-1 w-full"
            >
              <option value="">Choose a system…</option>
              {drones
                .filter((d) => d.id !== droneId)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </Select>
          </label>
          {targetDroneId && (
            <label className="block text-xs text-muted-foreground">
              Attribute
              <Select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="mt-1 w-full"
              >
                <option value="">Choose an attribute…</option>
                {targetSpecs.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <label className="block text-xs text-muted-foreground">
            Figure as it reads there (optional
            {targetUnit ? `, e.g. "600 ${targetUnit}"` : ""})
            <Input
              value={correct}
              onChange={(e) => setCorrect(e.target.value)}
              className="mt-1 w-full"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Btn type="submit" variant="danger" size="sm" disabled={!targetDroneId || !target}>
              Move claim
            </Btn>
            <Btn type="button" variant="ghost" size="sm" onClick={reset}>
              Cancel
            </Btn>
          </div>
        </form>
      ) : issue === "attribute" ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            move();
          }}
        >
          <label className="block text-xs text-muted-foreground">
            Belongs to
            <Select
              autoFocus
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="mt-1 w-full"
            >
              <option value="">Choose an attribute…</option>
              {specs
                .filter((s) => s.key !== spec.key)
                .map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
            </Select>
          </label>
          <label className="block text-xs text-muted-foreground">
            Figure as it reads there (optional
            {specs.find((s) => s.key === target)?.unit
              ? `, e.g. "600 ${specs.find((s) => s.key === target)!.unit}"`
              : ""}
            )
            <Input
              value={correct}
              onChange={(e) => setCorrect(e.target.value)}
              className="mt-1 w-full"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Btn type="submit" variant="danger" size="sm" disabled={!target}>
              Move claim
            </Btn>
            <Btn type="button" variant="ghost" size="sm" onClick={reset}>
              Cancel
            </Btn>
          </div>
        </form>
      ) : issue ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            apply({
              verdict: "rejected",
              issue,
              ...(correct.trim() ? { correctValue: correct } : {}),
            });
          }}
        >
          <label className="block text-xs text-muted-foreground">
            Correct figure (optional{spec.unit ? `, e.g. "20 ${spec.unit}"` : ""})
            <Input
              autoFocus
              value={correct}
              onChange={(e) => setCorrect(e.target.value)}
              className="mt-1 w-full"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Btn type="submit" variant="danger" size="sm">
              Reject claim
            </Btn>
            <Btn type="button" variant="ghost" size="sm" onClick={() => setIssue(null)}>
              Cancel
            </Btn>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Btn variant="ghost" size="sm" onClick={() => apply({ verdict: "confirmed" })}>
            ✓ Correct
          </Btn>
          {(Object.keys(ISSUE_BUTTON) as ClaimIssue[]).map((k) => (
            <Btn
              key={k}
              variant="danger"
              size="sm"
              onClick={() => {
                // Moving asks for the destination; the plain rejections only need a reading.
                setIssue(k);
                setTarget("");
                setTargetDroneId("");
                setCorrect("");
              }}
            >
              {ISSUE_BUTTON[k]}
            </Btn>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        A rejected claim stays on the record but no longer counts towards the consensus value. A
        moved one keeps its place in the report and is filed under the attribute or system it
        describes; undo the move on the original claim.
      </p>
    </div>
  );
}
