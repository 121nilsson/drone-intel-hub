import { useMemo } from "react";
import type { Drone } from "@/entities/drone/types";
import {
  DISTRUST_AGREEMENT,
  DISTRUST_MIN_REVIEWS,
  TRUST_AGREEMENT,
  TRUST_MIN_REVIEWS,
  checkTrust,
} from "@/shared/infra/ingest/contradictions";
import { ListRow, Panel, Tag } from "@/shared/ui/primitives";

const pct = (n: number) => `${Math.round(n * 100)}%`;

function tally(drones: readonly Drone[]) {
  const t = { confirmed: 0, value: 0, unit: 0, system: 0 };
  for (const d of drones)
    for (const s of d.specs)
      for (const c of s.claims) {
        // A hand-entered correction is the analyst's own claim, not a verdict on a report.
        if (!c.review || c.extractionEngine === "analyst") continue;
        if (c.review.verdict === "confirmed") t.confirmed++;
        else t[c.review.issue ?? "value"]++;
      }
  return t;
}

/**
 * What analysts' claim verdicts have taught the automation: how many there are, and how far
 * each spec family's contradiction check has earned (or lost) the right to act on its own.
 */
export function AnalystReviewPanel({ drones }: { drones: readonly Drone[] }) {
  const t = useMemo(() => tally(drones), [drones]);
  const trust = useMemo(
    () =>
      [...checkTrust(drones)].sort(
        ([, a], [, b]) => b.agreed + b.disagreed - (a.agreed + a.disagreed),
      ),
    [drones],
  );
  const total = t.confirmed + t.value + t.unit + t.system;
  return (
    <Panel title="Analyst claim reviews">
      <p className="text-sm text-muted-foreground">
        {total === 0
          ? "No claim has been reviewed yet. Open a source chip under a spec on a system page to confirm or reject it."
          : `${t.confirmed} confirmed · ${t.value} wrong value · ${t.unit} wrong unit or parse · ${t.system} about another system.`}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Every review is scored as ground truth: rule sandboxes, shadow scoring and this page's
        evaluation all score the heuristic against it, and it is replayed as a regression test. The
        contradiction check earns autonomy per spec family: with at least {TRUST_MIN_REVIEWS}{" "}
        reviews and {pct(TRUST_AGREEMENT)} agreement it may act on less certain picks; below{" "}
        {pct(DISTRUST_AGREEMENT)} over {DISTRUST_MIN_REVIEWS} it must be more certain.
      </p>
      {trust.length > 0 && (
        <ul className="mt-3 divide-y divide-border border-t border-border">
          {trust.map(([family, v]) => {
            const n = v.agreed + v.disagreed;
            return (
              <li key={family}>
                <ListRow
                  title={<span className="font-mono">{family}</span>}
                  subtitle={`${n} reviewed check verdict${n === 1 ? "" : "s"} · ${pct(n ? v.agreed / n : 0)} agreed`}
                  meta={
                    <Tag
                      tone={
                        v.state === "earned"
                          ? "success"
                          : v.state === "distrusted"
                            ? "danger"
                            : "muted"
                      }
                      mono
                    >
                      {v.state} · bar {v.bar}
                    </Tag>
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
