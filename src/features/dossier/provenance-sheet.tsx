import { Link } from "@tanstack/react-router";
import { ExternalSourceLink, SourceRef } from "@/shared/ui/links";
import { useState } from "react";
import type { ClaimIssue, SpecAttribute, SpecClaim } from "@/entities/drone/types";
import { useDispatches, useServices, useSources } from "@/shared/infra/services";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Btn, Tag } from "@/shared/ui/primitives";
import { TranslateButton } from "@/shared/ui/translate-button";
import { claimKey } from "@/entities/drone/claim-review";
import { correctionMark, describeCorrection } from "@/shared/ui/correction";

export interface ClaimSelection {
  spec: SpecAttribute;
  claim: SpecClaim;
}

/** Why a claim was ruled out, as the analyst reads it on the tag. */
const ISSUE_LABEL: Record<ClaimIssue, string> = {
  value: "the figure is wrong",
  unit: "the unit or parse is wrong",
  system: "it is about another system",
  attribute: "it belongs to another attribute",
};

/** The same reasons as the buttons that pick them. */
const ISSUE_BUTTON: Record<ClaimIssue, string> = {
  value: "Wrong figure",
  unit: "Wrong unit or parse",
  system: "About another system",
  attribute: "About another attribute",
};

/** Short chip naming a claim's source; tapping opens the provenance sheet. */
export function ClaimChip({ claim, onOpen }: { claim: SpecClaim; onOpen: () => void }) {
  // An analyst's verdict outranks the others, so the chip shows only that one. An applied
  // correction outranks the check, which saw the uncorrected figure.
  const fix = claim.review ? undefined : claim.autoCorrection;
  const verdict = claim.review || fix?.applied ? undefined : claim.adjudication;
  const rejected = claim.review?.verdict === "rejected";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`inline-flex max-w-full items-center gap-1 border border-border px-1.5 py-1 font-mono text-[11px] text-muted-foreground hover:border-primary hover:text-primary ${rejected ? "opacity-60" : ""}`}
    >
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
    </button>
  );
}

/**
 * The analyst's verdict on one claim. "Correct" and "about another system" apply at once; a
 * wrong figure or unit first asks for the right figure, which is optional.
 *
 * "About another attribute" moves the claim: a speed read as a height is not a wrong figure but
 * a wrong place, so the figure is filed under the attribute it describes and kept on the record
 * where the post put it.
 */
function ClaimReviewPanel({
  droneId,
  selection,
  specs,
}: {
  droneId: string;
  selection: ClaimSelection;
  specs: readonly SpecAttribute[];
}) {
  const svc = useServices();
  const [issue, setIssue] = useState<ClaimIssue | null>(null);
  const [correct, setCorrect] = useState("");
  const [target, setTarget] = useState("");
  const { spec, claim } = selection;
  const review = claim.review;
  const apply = (verdict: Parameters<typeof svc.catalog.reviewClaim>[3]) => {
    svc.catalog.reviewClaim(droneId, spec.key, claim, verdict);
    setIssue(null);
    setCorrect("");
  };
  const move = () => {
    if (!target) return;
    svc.catalog.moveClaim(droneId, spec.key, claim, target, correct.trim());
    setIssue(null);
    setTarget("");
    setCorrect("");
  };
  const fix = claim.autoCorrection;
  const movedTo = review?.movedTo ? specs.find((s) => s.key === review.movedTo) : undefined;
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
              className="px-2 py-1 text-xs"
              onClick={() => svc.catalog.reviewCorrection(droneId, spec.key, claim, true)}
            >
              {fix.kind === "unit" ? "Accept correction" : "Reject figure"}
            </Btn>
            <Btn
              variant="ghost"
              className="px-2 py-1 text-xs"
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
          {movedTo && <Tag mono>filed under {movedTo.label}</Tag>}
          <span className="font-mono text-xs text-muted-foreground">{review.at.slice(0, 10)}</span>
          <Btn variant="ghost" className="px-2 py-1 text-xs" onClick={() => apply(null)}>
            Undo
          </Btn>
        </div>
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
            <select
              autoFocus
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="mt-1 w-full border border-border bg-card px-3 py-2 font-mono text-sm focus:border-primary"
            >
              <option value="">Choose an attribute…</option>
              {specs
                .filter((s) => s.key !== spec.key)
                .map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
            </select>
          </label>
          <label className="block text-xs text-muted-foreground">
            Figure as it reads there (optional
            {specs.find((s) => s.key === target)?.unit
              ? `, e.g. "600 ${specs.find((s) => s.key === target)!.unit}"`
              : ""}
            )
            <input
              value={correct}
              onChange={(e) => setCorrect(e.target.value)}
              className="mt-1 w-full border border-border bg-card px-3 py-2 font-mono text-sm focus:border-primary"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Btn type="submit" variant="danger" className="px-2 py-1 text-xs" disabled={!target}>
              Move claim
            </Btn>
            <Btn
              type="button"
              variant="ghost"
              className="px-2 py-1 text-xs"
              onClick={() => {
                setIssue(null);
                setTarget("");
              }}
            >
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
            <input
              autoFocus
              value={correct}
              onChange={(e) => setCorrect(e.target.value)}
              className="mt-1 w-full border border-border bg-card px-3 py-2 font-mono text-sm focus:border-primary"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Btn type="submit" variant="danger" className="px-2 py-1 text-xs">
              Reject claim
            </Btn>
            <Btn
              type="button"
              variant="ghost"
              className="px-2 py-1 text-xs"
              onClick={() => setIssue(null)}
            >
              Cancel
            </Btn>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Btn
            variant="ghost"
            className="px-2 py-1 text-xs"
            onClick={() => apply({ verdict: "confirmed" })}
          >
            ✓ Correct
          </Btn>
          {(Object.keys(ISSUE_BUTTON) as ClaimIssue[]).map((k) => (
            <Btn
              key={k}
              variant="danger"
              className="px-2 py-1 text-xs"
              onClick={() => {
                // A figure about another system has no place here at all, so it is ruled out
                // straight away; the others ask what the right reading is.
                if (k === "system") {
                  apply({ verdict: "rejected", issue: "system" });
                  return;
                }
                setIssue(k);
                setTarget("");
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
        moved one keeps its place in the report and is filed under the attribute it describes.
      </p>
    </div>
  );
}

export function ProvenanceSheet({
  selection,
  droneId,
  droneName,
  specs,
  onClose,
}: {
  selection: ClaimSelection | null;
  droneId: string;
  droneName: string;
  /** The entry's attributes, so a claim can be moved to the one it belongs to. */
  specs: readonly SpecAttribute[];
  onClose: () => void;
}) {
  const dispatches = useDispatches();
  const sources = useSources();
  const svc = useServices();
  const claim = selection?.claim;
  const dispatch = claim?.sourceId
    ? dispatches.find((d) => d.id === claim.sourceId || d.externalId === claim.sourceId)
    : undefined;
  const srcName = (claim?.source ?? "").trim().toLowerCase();
  const monitored = srcName
    ? sources.find((s) => s.name.trim().toLowerCase() === srcName)
    : undefined;
  const sourceHref =
    monitored && /^https?:\/\//i.test(monitored.handle) ? monitored.handle : undefined;
  const n = claim?.normalized;
  return (
    <Sheet open={!!selection} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        {selection && claim && (
          <>
            <SheetHeader>
              <SheetTitle className="font-mono text-sm uppercase tracking-wider">
                {selection.spec.label} · provenance
              </SheetTitle>
              <SheetDescription className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <SourceRef
                  source={claim.source}
                  href={dispatch?.url ?? sourceHref}
                  className="max-w-full"
                />
                {claim.date && <span className="shrink-0">· {claim.date.slice(0, 10)}</span>}
                <Link
                  to="/dispatches"
                  search={{
                    q: dispatch
                      ? (dispatch.url ?? dispatch.externalId ?? dispatch.id)
                      : (claim.source ?? droneName),
                  }}
                  className="shrink-0 font-mono text-xs text-primary hover:underline"
                >
                  {dispatch ? "View post →" : "Search in feed →"}
                </Link>
              </SheetDescription>
            </SheetHeader>
            <div className="mt-4 space-y-4 text-sm">
              <div className="border-l-2 border-primary/50 pl-3">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Claimed value
                </p>
                <p className="mt-1 font-mono text-primary">
                  {claim.raw ?? String(claim.value)}
                  {n?.canonicalValue !== undefined && claim.raw
                    ? ` → ${n.canonicalValue} ${n.canonicalUnit ?? ""}`
                    : ""}
                </p>
              </div>
              {claim.evidence && (
                <blockquote className="border border-border bg-secondary/40 p-3 italic">
                  “{claim.evidence}”
                </blockquote>
              )}
              <div className="flex flex-wrap gap-1.5">
                {claim.model && <Tag>{claim.model}</Tag>}
                {claim.extractionEngine && <Tag>{claim.extractionEngine}</Tag>}
                {claim.extractionConfidence !== undefined && (
                  <Tag>conf {Math.round(claim.extractionConfidence * 100)}%</Tag>
                )}
                {claim.adjudication && (
                  <Tag tone={claim.adjudication.verdict === "outlier" ? "danger" : "primary"}>
                    {claim.adjudication.verdict === "outlier"
                      ? "Contradiction check: outlier"
                      : "Contradiction check: best-supported"}
                    {claim.adjudication.reason ? ` — ${claim.adjudication.reason}` : ""}
                  </Tag>
                )}
              </div>
              <ClaimReviewPanel
                key={`${selection.spec.key}|${claimKey(claim)}`}
                droneId={droneId}
                selection={selection}
                specs={specs}
              />
              {dispatch ? (
                <div className="space-y-2 border-t border-border pt-4">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Source post · {dispatch.sourceName} · {dispatch.publishedAt?.slice(0, 10)}
                  </p>
                  {dispatch.text ? (
                    <p className="whitespace-pre-wrap break-words leading-relaxed">
                      {dispatch.text}
                    </p>
                  ) : (
                    <p className="text-muted-foreground">Post text not kept.</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {dispatch.text && (
                      <TranslateButton text={dispatch.text} model={svc.settings.translateModel} />
                    )}
                    {dispatch.url && (
                      <ExternalSourceLink href={dispatch.url} className="font-mono text-xs">
                        Open original
                      </ExternalSourceLink>
                    )}
                  </div>
                </div>
              ) : (
                <p className="border-t border-border pt-4 text-muted-foreground">
                  {claim.sourceId
                    ? "The source post is no longer in the archive."
                    : "Seed or analyst claim — no saved source post."}
                </p>
              )}
              <Link
                to="/dispatches"
                search={{ q: droneName }}
                className="block font-mono text-xs text-primary hover:underline"
              >
                All posts mentioning {droneName} →
              </Link>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
