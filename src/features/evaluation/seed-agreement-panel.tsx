import { Panel, Tag } from "@/shared/ui/primitives";
import type { SeedAgreement } from "@/shared/infra/evaluation/seed-agreement";
import { pct } from "@/shared/ui/format";

export type SeedState = SeedAgreement & { available: boolean; reason?: string };

export function SeedAgreementPanel({ seed }: { seed: SeedState }) {
  return (
    <Panel title="Seed set agreement">
      {!seed.available || seed.scored === 0 ? (
        <p className="text-xs text-muted-foreground">
          {seed.reason ??
            "The seed set has no answered claims yet. It is filled by the first audit."}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            <Tag tone="info" mono>
              agreement {pct(seed.agreement)} of {seed.scored}
            </Tag>
            <Tag tone="muted" mono>
              bound ≤ {pct(seed.upperBound)}
            </Tag>
            <Tag tone={seed.missed > 0 ? "warning" : "success"} mono>
              found {seed.found}/{seed.found + seed.missed}
            </Tag>
            <Tag tone={seed.invented > 0 ? "warning" : "success"} mono>
              avoided {seed.avoided}/{seed.avoided + seed.invented}
            </Tag>
            {seed.cannotTell > 0 && (
              <Tag tone="muted" mono>
                cannot tell {seed.cannotTell}
              </Tag>
            )}
            {seed.skipped > 0 && (
              <Tag tone="muted" mono>
                unreadable {seed.skipped}
              </Tag>
            )}
            {seed.obviouslyWrong > 0 && (
              <Tag tone="muted" mono>
                plainly wrong {seed.obviouslyWrong}
              </Tag>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            The frozen seed set — claims a person answered — read once more by today's heuristic: a
            "yes" answer must be found, a "no" must not be produced, and "cannot tell" is left out.
            Measurement only: nothing that learns reads the seed set.
          </p>
        </>
      )}
    </Panel>
  );
}
