import { Link } from "@tanstack/react-router";
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
  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex max-w-full items-center gap-1 border border-border px-1.5 py-1 font-mono text-[11px] text-muted-foreground hover:border-primary hover:text-primary"
    >
      <span className="truncate">{claim.source}</span>
      {claim.date && <span className="shrink-0 opacity-70">· {claim.date.slice(5, 10)}</span>}
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
              <SheetDescription>
                {claim.source} · {claim.date?.slice(0, 10)}
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
                      <a
                        href={dispatch.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-xs text-primary underline"
                      >
                        Open original ↗
                      </a>
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
