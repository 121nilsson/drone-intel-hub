import { Link } from "@tanstack/react-router";
import { ExternalSourceLink, SourceRef } from "@/shared/ui/links";
import type { SpecAttribute } from "@/entities/drone/types";
import { useDispatches, useServices, useSources } from "@/shared/infra/use-services";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tag } from "@/shared/ui/primitives";
import { TranslateButton } from "@/shared/ui/translate-button";
import { claimKey } from "@/entities/drone/claim-review";
import type { ClaimSelection } from "./provenance-types";
import { ClaimReviewPanel } from "./claim-review-panel";
import { VerificationPanel } from "./verification-panel";

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
              <VerificationPanel verification={claim.verification} />
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
