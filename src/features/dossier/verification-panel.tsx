import type { ClaimVerification } from "@/entities/drone/types";
import { Tag } from "@/shared/ui/primitives";
import { CHECK_LABEL, checkMark, checkTone } from "./provenance-labels";

/**
 * What the machine checked on one claim and what it concluded. Read-only on purpose: the verifier
 * never edits a claim, and this offers no buttons - a correction is the analyst's job, below.
 */
export function VerificationPanel({
  verification,
}: {
  verification: ClaimVerification | undefined;
}) {
  if (!verification)
    return (
      <div className="border-t border-border pt-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Deterministic check
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          No machine check on this claim — an analyst entered it, or it predates the verifier.
        </p>
      </div>
    );
  return (
    <div className="border-t border-border pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Deterministic check
        </p>
        <Tag
          tone={
            verification.state === "verified"
              ? "success"
              : verification.state === "rejected"
                ? "danger"
                : "muted"
          }
        >
          {verification.state}
        </Tag>
        <Tag>{Math.round(verification.coverage * 100)}% decided</Tag>
        {verification.independentSources > 1 && (
          <Tag>{verification.independentSources} outlets agree</Tag>
        )}
      </div>
      <ul className="mt-2 space-y-1">
        {verification.checks.map((c) => (
          <li key={c.id} className="flex gap-2 text-xs">
            <span className={`w-3 shrink-0 text-center font-mono ${checkTone(c)}`}>
              {checkMark(c)}
            </span>
            <span className="min-w-0">
              <span className="font-mono text-[11px] text-muted-foreground">
                {CHECK_LABEL[c.kind]}
              </span>
              {c.detail && <span className="text-muted-foreground"> — {c.detail}</span>}
              {!c.applicable && <span className="text-muted-foreground"> (not applicable)</span>}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1 font-mono text-[10px] text-muted-foreground">
        {verification.verifierVersion} · {verification.at.slice(0, 10)}
      </p>
    </div>
  );
}
