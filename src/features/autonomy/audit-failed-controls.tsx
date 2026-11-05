import { CONTROL_WINDOW } from "@/entities/drone/audit";
import type { AuditFailedControl } from "@/shared/contracts/verification";
import { Btn, Tag } from "@/shared/ui/primitives";
import { SourceRef } from "@/shared/ui/links";

/**
 * The hidden controls answered "yes". Each voids the answers around it. A control from the first
 * sessions rested on the identity check, which misses "It builds on…", so the owner may say it was
 * wrong; an altered control showed a figure the post does not contain and stands.
 */
export function FailedControls({
  controls,
  voided,
  busy,
  onDispute,
}: {
  controls: AuditFailedControl[];
  voided: number;
  busy: boolean;
  onDispute: (id: string, disputed: boolean) => void;
}) {
  if (!controls.length) return null;
  const standing = controls.filter((c) => !c.disputed).length;
  return (
    <div className="mt-3 space-y-2 text-sm">
      <p className={standing ? "text-destructive" : "text-muted-foreground"}>
        {standing
          ? `${voided} answer(s) not counted: ${standing} hidden control(s) were answered "yes", and each voids about ${2 * CONTROL_WINDOW + 1} answers around it.`
          : "Every failed control has been disputed; no answers are voided."}
      </p>
      <ul className="space-y-2">
        {controls.map((c) => (
          <li key={c.id} className="rounded border border-border p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{c.droneName}</span>
              <span className="text-muted-foreground">
                {c.specLabel}: {c.value}
              </span>
              <Tag tone="muted" mono>
                {c.kind === "altered" ? "figure altered" : "identity check"}
              </Tag>
              {c.disputed && (
                <Tag tone="muted" mono>
                  disputed
                </Tag>
              )}
            </div>
            {c.evidence && <p className="mt-1 break-words text-muted-foreground">“{c.evidence}”</p>}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
              <SourceRef source={c.source} />
              {c.kind === "misread" && (
                <Btn
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => onDispute(c.id, !c.disputed)}
                >
                  {c.disputed
                    ? "Withdraw: the control was right"
                    : "The control was wrong: the post states this for this system"}
                </Btn>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
