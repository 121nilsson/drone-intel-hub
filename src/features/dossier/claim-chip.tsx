import type { ReactNode } from "react";
import type { ClaimVerification, SpecClaim } from "@/entities/drone/types";
import { ChipButton } from "@/shared/ui/primitives";
import { correctionMark, describeCorrection } from "@/shared/ui/correction";
import { ISSUE_LABEL } from "./provenance-labels";

/**
 * The machine's own verdict, shown only when no human verdict is present: an analyst's word
 * outranks the check, and a verified claim needs no badge at all.
 */
function verificationMark(v: ClaimVerification | undefined, reviewed: boolean): ReactNode {
  if (!v || reviewed || v.state === "verified") return null;
  const reason =
    v.checks.find((c) => c.verdict === "fail")?.detail ??
    v.checks.find((c) => c.verdict === "uncertain" && c.applicable)?.detail;
  return (
    <span
      className={`shrink-0 ${v.state === "rejected" ? "text-destructive" : "opacity-70"}`}
      title={`Deterministic check: ${v.state}${reason ? ` — ${reason}` : ""}`}
    >
      {v.state === "rejected" ? "✕ check failed" : "? uncertain"}
    </span>
  );
}

/** Short chip naming a claim's source; tapping opens the provenance sheet. */
export function ClaimChip({ claim, onOpen }: { claim: SpecClaim; onOpen: () => void }) {
  // An analyst's verdict outranks the others, so the chip shows only that one. An applied
  // correction outranks the check, which saw the uncorrected figure.
  const fix = claim.review ? undefined : claim.autoCorrection;
  const verdict = claim.review || fix?.applied ? undefined : claim.adjudication;
  const rejected = claim.review?.verdict === "rejected";
  return (
    <ChipButton onClick={onOpen} dim={rejected} title={`Open provenance: ${claim.source}`}>
      {/* min-w-0: a flex item's default min-width is its content size, so without this the
          source string refuses to shrink and the ellipsis never appears. */}
      <span className="min-w-0 truncate">{claim.source}</span>
      {claim.date && <span className="shrink-0 opacity-70">· {claim.date.slice(5, 10)}</span>}
      {verdict && (
        <span
          className={`shrink-0 ${verdict.verdict === "outlier" ? "text-destructive" : "text-primary"}`}
          title={
            verdict.verdict === "outlier"
              ? `Contradiction check: marked an outlier${verdict.reason ? ` — ${verdict.reason}` : ""}`
              : "Contradiction check: marked best-supported"
          }
        >
          {verdict.verdict === "outlier" ? "⚠ outlier" : "✓ supported"}
        </span>
      )}
      {fix && (
        <span
          className={`shrink-0 ${fix.kind === "implausible" ? "text-destructive" : "text-primary"} ${fix.applied ? "" : "opacity-70"}`}
          title={describeCorrection(fix)}
        >
          {correctionMark(fix)}
        </span>
      )}
      {claim.review && (
        <span
          className={`shrink-0 ${rejected ? "text-destructive line-through" : "text-primary"}`}
          title={
            rejected
              ? `Rejected by an analyst — ${ISSUE_LABEL[claim.review.issue ?? "value"]}`
              : "Confirmed by an analyst"
          }
        >
          {rejected ? "✕ rejected" : "✓ confirmed"}
        </span>
      )}
      {verificationMark(claim.verification, Boolean(claim.review))}
    </ChipButton>
  );
}
