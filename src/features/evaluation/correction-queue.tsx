import { useMemo } from "react";
import { claimKey } from "@/entities/drone/claim-review";
import type { Drone } from "@/entities/drone/types";
import { correctionTrust } from "@/shared/infra/ingest/auto-correct";
import { TRUST_AGREEMENT, TRUST_MIN_REVIEWS } from "@/shared/infra/ingest/earned-trust";
import { useDispatches, useServices } from "@/shared/infra/services";
import { correctionMark, describeCorrection } from "@/shared/ui/correction";
import { SystemChip } from "@/shared/ui/links";
import { ReviewSource } from "@/shared/ui/review-source";
import { Btn, Card, ListRow, Panel, Tag } from "@/shared/ui/primitives";

/** Rows shown at once; the rest wait for the next ones to be answered. */
const QUEUE_SIZE = 25;

const KIND_LABEL: Record<string, string> = {
  "unit:consensus": "Unit slip against the other sources",
  "unit:bounds": "Unit slip against physical bounds",
  "implausible:bounds": "Implausible figure",
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * The corrector's findings nobody has answered yet, and how far each kind has come towards being
 * applied on its own. Each answer here is one of the analyst decisions that autonomy is earned
 * from, so working down this list is the quickest way to hand a kind of correction to automation.
 */
export function CorrectionQueue({ drones }: { drones: readonly Drone[] }) {
  const svc = useServices();
  const dispatches = useDispatches();
  const trust = useMemo(() => correctionTrust(drones), [drones]);
  const pending = useMemo(
    () =>
      drones.flatMap((d) =>
        d.specs.flatMap((s) =>
          s.claims.flatMap((c) =>
            c.autoCorrection && !c.review ? [{ drone: d, spec: s, claim: c }] : [],
          ),
        ),
      ),
    [drones],
  );
  const kinds = Object.keys(KIND_LABEL);
  /** The post a claim was read from, so a reviewer can judge the figure in its own sentence. */
  const posts = useMemo(() => {
    const byId = new Map<string, (typeof dispatches)[number]>();
    for (const d of dispatches) {
      byId.set(d.id, d);
      byId.set(d.externalId, d);
    }
    return byId;
  }, [dispatches]);
  return (
    <Panel title={`Auto-corrections · ${pending.length} awaiting review`}>
      <p className="text-xs text-muted-foreground">
        The corrector finds unit slips and impossible figures without a model. A kind of correction
        is applied automatically once {pct(TRUST_AGREEMENT)} of at least {TRUST_MIN_REVIEWS} answers
        agree with it, and stops being applied as soon as agreement falls.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        For each figure below, read the source. If the corrector is right, press the left button; if
        the report really states this figure for this system, press <strong>Figure is right</strong>
        .{pending.length === 0 && " Nothing is waiting right now."}
      </p>
      <ul className="mt-3 divide-y divide-border border-y border-border">
        {kinds.map((k) => {
          const t = trust.get(k);
          const n = (t?.agreed ?? 0) + (t?.disagreed ?? 0);
          return (
            <li key={k}>
              <ListRow
                title={KIND_LABEL[k]}
                subtitle={`${n} answered · ${n ? pct((t?.agreed ?? 0) / n) : "—"} agreed`}
                meta={
                  <Tag
                    tone={
                      t?.state === "earned"
                        ? "success"
                        : t?.state === "distrusted"
                          ? "danger"
                          : "muted"
                    }
                    mono
                  >
                    {t?.state === "earned" ? "applied" : (t?.state ?? "default")}
                  </Tag>
                }
              />
            </li>
          );
        })}
      </ul>
      {pending.length > 0 && (
        <div className="mt-3 space-y-2">
          {pending.slice(0, QUEUE_SIZE).map(({ drone, spec, claim }) => {
            const fix = claim.autoCorrection!;
            const post = claim.sourceId ? posts.get(claim.sourceId) : undefined;
            return (
              <Card
                key={`${drone.id}|${spec.key}|${claimKey(claim)}`}
                className="p-3 space-y-2 text-xs"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <SystemChip id={drone.id} name={drone.name} />
                  <span className="font-mono">
                    {spec.label}: {claim.raw ?? String(claim.value)}
                  </span>
                  <span className="font-mono text-primary">{correctionMark(fix)}</span>
                </div>
                <ReviewSource
                  source={claim.source}
                  href={post?.url}
                  text={post?.text || claim.evidence || claim.raw}
                  textClassName="italic"
                />
                <p className="break-words text-muted-foreground">{describeCorrection(fix)}</p>
                <div className="flex flex-wrap gap-2">
                  <Btn
                    className="px-2 py-1 text-xs"
                    onClick={() => svc.catalog.reviewCorrection(drone.id, spec.key, claim, true)}
                  >
                    {fix.kind === "unit" ? "Accept correction" : "Reject figure"}
                  </Btn>
                  <Btn
                    variant="ghost"
                    className="px-2 py-1 text-xs"
                    onClick={() => svc.catalog.reviewCorrection(drone.id, spec.key, claim, false)}
                  >
                    Figure is right
                  </Btn>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
