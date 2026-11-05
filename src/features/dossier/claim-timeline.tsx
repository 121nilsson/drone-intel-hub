import { Panel, EmptyNote } from "@/shared/ui/primitives";
import { SourceRef, withUnit } from "@/shared/ui/links";
import { type Drone } from "@/entities/drone/types";

export function ClaimTimeline({ drone: d }: { drone: Drone }) {
  return (
    <Panel id="claims" title="Spec claim timeline" className="scroll-mt-28">
      <ol className="relative ml-2 border-l border-border">
        {d.specs
          .flatMap((s) => s.claims.map((claim, i) => ({ spec: s, claim, index: i })))
          .sort((a, b) => (b.claim.date ?? "").localeCompare(a.claim.date ?? ""))
          .slice(0, 40)
          .map(({ spec, claim, index }) => (
            <li key={`${spec.key}-${index}`} className="mb-3 ml-4 min-w-0">
              <span className="absolute -left-1.5 mt-1.5 h-2.5 w-2.5 border border-primary bg-background" />
              <p className="font-mono text-xs text-muted-foreground">
                {(claim.date ?? "").slice(0, 10)} · {spec.label}
              </p>
              <p className="min-w-0 break-words text-sm [overflow-wrap:anywhere]">
                {withUnit(claim.value, spec.unit)}{" "}
                <span className="font-mono text-xs text-muted-foreground">
                  —{" "}
                  <SourceRef
                    source={claim.source || claim.model}
                    className="max-w-[16rem] align-bottom"
                  />
                </span>
              </p>
            </li>
          ))}
        {!d.specs.some((s) => s.claims.length) && <EmptyNote>No dated claims.</EmptyNote>}
      </ol>
    </Panel>
  );
}
