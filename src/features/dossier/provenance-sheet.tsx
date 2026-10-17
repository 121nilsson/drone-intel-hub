import { Link } from "@tanstack/react-router";
import { ExternalSourceLink, SourceRef } from "@/shared/ui/links";
import type { SpecAttribute, SpecClaim } from "@/entities/drone/types";
import { useDispatches, useServices } from "@/shared/infra/services";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tag } from "@/shared/ui/primitives";
import { TranslateButton } from "@/features/dispatches/dispatches-page";

export interface ClaimSelection {
  spec: SpecAttribute;
  claim: SpecClaim;
}

/** Short chip naming a claim's source; tapping opens the provenance sheet. */
export function ClaimChip({ claim, onOpen }: { claim: SpecClaim; onOpen: () => void }) {
  const verdict = claim.adjudication;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex max-w-full items-center gap-1 border border-border px-1.5 py-1 font-mono text-[11px] text-muted-foreground hover:border-primary hover:text-primary"
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
    </button>
  );
}

export function ProvenanceSheet({
  selection,
  droneName,
  onClose,
}: {
  selection: ClaimSelection | null;
  droneName: string;
  onClose: () => void;
}) {
  const dispatches = useDispatches();
  const svc = useServices();
  const claim = selection?.claim;
  const dispatch = claim?.sourceId
    ? dispatches.find((d) => d.id === claim.sourceId || d.externalId === claim.sourceId)
    : undefined;
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
                <SourceRef source={claim.source} href={dispatch?.url} className="max-w-full" />
                {claim.date && <span className="shrink-0">· {claim.date.slice(0, 10)}</span>}
                {dispatch && (
                  <Link
                    to="/dispatches"
                    search={{ q: dispatch.externalId ?? dispatch.id }}
                    className="shrink-0 font-mono text-xs text-primary hover:underline"
                  >
                    Visa posten →
                  </Link>
                )}
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
