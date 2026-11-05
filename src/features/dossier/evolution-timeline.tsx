import { Panel } from "@/shared/ui/primitives";
import { SourceRef } from "@/shared/ui/links";
import { type Drone } from "@/entities/drone/types";

export function EvolutionTimeline({ drone: d }: { drone: Drone }) {
  return (
    <Panel id="timeline" title="Spec evolution timeline" className="scroll-mt-28">
      <ol className="relative ml-2 border-l border-border">
        {[...d.evolution]
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((e, i) => (
            <li key={i} className="mb-4 ml-4 min-w-0">
              <span className="absolute -left-1.5 mt-1.5 h-3 w-3 border border-primary bg-background" />
              <p className="font-mono text-xs text-muted-foreground">
                {e.date.slice(0, 10)} · {e.kind}
              </p>
              <p className="min-w-0 break-words text-sm [overflow-wrap:anywhere]">
                {e.description}{" "}
                <span className="font-mono text-xs text-muted-foreground">
                  — <SourceRef source={e.source} className="max-w-[16rem] align-bottom" />
                </span>
              </p>
            </li>
          ))}
      </ol>
    </Panel>
  );
}
