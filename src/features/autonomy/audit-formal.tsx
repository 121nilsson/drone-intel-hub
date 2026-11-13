import type { AuditStatus } from "@/shared/contracts/verification";
import { Btn, CardGrid } from "@/shared/ui/primitives";
import { pctPrecise } from "@/shared/ui/format";
import { Stat } from "./stat";

/**
 * The formal evaluation: one fixed probability sample of the verified claims, answered by a
 * person, analysed once. Shown apart from the earlier draws, which were not probability samples
 * and are information only.
 */
export function FormalEvaluation({
  status,
  busy,
  onDraw,
  onRedraw,
}: {
  status: AuditStatus;
  busy: boolean;
  onDraw: () => void;
  onRedraw: () => void;
}) {
  const f = status.formal;
  return (
    <div className="mt-4 space-y-3">
      <h3 className="text-sm font-medium">Formal evaluation</h3>
      {!f ? (
        <p className="text-sm text-muted-foreground">
          Not drawn. It samples 200 verified claims at random, in proportion to language, and
          decides once they all have a valid answer. Your answer is the reference: the figures
          measure agreement with it, not an independently established truth.
        </p>
      ) : (
        <>
          <CardGrid>
            <Stat
              label="Valid answers"
              value={`${f.valid} / ${f.units}`}
              hint={
                f.retryPending
                  ? `${f.retryPending} claim(s) wait to be asked again after a failed control`
                  : "one answer per sampled claim"
              }
            />
            <Stat
              label="Errors counted"
              value={`${f.errors}`}
              hint={`${f.cannotTell} “cannot tell” counted as errors (worst case)`}
            />
            <Stat
              label={f.census ? "Error share (census)" : "Upper bound (95%)"}
              value={f.upper === undefined ? "—" : pctPrecise(f.upper)}
              hint={
                f.bestCaseUpper === undefined
                  ? "decided once all answers are in"
                  : `best case, “cannot tell” left out: ${pctPrecise(f.bestCaseUpper)}`
              }
            />
          </CardGrid>
          <p className="text-xs text-muted-foreground">
            Strata:{" "}
            {f.strata
              .map((s) => `${s.name} ${s.sampled}/${s.population} (${s.errors} wrong)`)
              .join(" · ")}
          </p>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {(!f || f.decision !== "continue") && (
          <Btn variant={f ? "ghost" : "primary"} disabled={busy} onClick={onDraw}>
            {f ? "Draw a new formal evaluation" : "Draw the formal evaluation (200 claims)"}
          </Btn>
        )}
        {f && f.retryPending > 0 && (
          <Btn variant="primary" disabled={busy} onClick={onRedraw}>
            Ask {f.retryPending} again
          </Btn>
        )}
      </div>
    </div>
  );
}
