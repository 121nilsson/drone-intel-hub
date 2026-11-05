import { pct } from "@/shared/ui/format";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { useDrones, useServices } from "@/shared/infra/services";
import { Btn, Card, CardGrid, ListRow, PageTitle, Panel, Tag } from "@/shared/ui/primitives";
import { Stat } from "./stat";
import { JobStatusPanel } from "@/shared/ui/job-status-panel";
import { fetchAutonomyEvents } from "@/shared/infra/autonomy/autonomy.functions";
import { fetchAutonomy } from "@/shared/infra/evaluation/evaluation.functions";
import { verificationReport } from "@/shared/infra/verification/run";
import { SecondReaderPanel } from "./second-reader-panel";
import type { AutonomyEvent, VerificationRunReport } from "@/shared/contracts/verification";
import type { AutonomyStatus } from "@/shared/infra/evaluation/rule-sandbox.server";

/**
 * What the engine decides on its own, and what it checks before it does.
 *
 * Read-only except for one control: running the deterministic verifier. Nothing here approves or
 * rejects a claim. In Phase 1 the verdicts are measured, not acted on: an uncertain or rejected
 * claim is shown and still counted in consensus (claimCounts does not read verification), and none
 * is sent to a human queue. The panel exists so the loop is visible and its coverage is honest: every score is
 * reported next to how many claims it was measured over.
 */

/** A run's before/after coverage, so a verifier change that lowers the verified share is visible. */
function coverageChange(before: unknown, after: unknown): string | undefined {
  const read = (v: unknown) => {
    if (!v || typeof v !== "object") return undefined;
    const o = v as Record<string, unknown>;
    const n = (k: string) => (typeof o[k] === "number" ? (o[k] as number) : undefined);
    const verified = n("verified");
    if (verified === undefined) return undefined;
    return {
      verified,
      uncertain: n("uncertain") ?? 0,
      rejected: n("rejected") ?? 0,
    };
  };
  const a = read(after);
  if (!a) return undefined;
  const b = read(before);
  const step = (from: number, to: number) => (from === to ? `${to}` : `${from} → ${to}`);
  return b
    ? `${step(b.verified, a.verified)} verified · ${step(b.uncertain, a.uncertain)} uncertain · ${step(b.rejected, a.rejected)} rejected`
    : `after: ${a.verified} verified, ${a.uncertain} uncertain, ${a.rejected} rejected`;
}

export function AutonomyPage() {
  const svc = useServices();
  const drones = useDrones();
  const [report, setReport] = useState<VerificationRunReport | null>(null);
  const [events, setEvents] = useState<AutonomyEvent[]>([]);
  const [rules, setRules] = useState<AutonomyStatus | null>(null);
  const [busy, setBusy] = useState(false);

  // The stored coverage, computed without a run, so the page is honest the moment it opens.
  const stored = useMemo(
    () =>
      verificationReport(drones, {
        at: new Date().toISOString(),
        checked: 0,
        changed: 0,
        missingText: 0,
      }),
    [drones],
  );
  const view = report ?? stored;
  const { coverage } = view;
  const machineClaims = coverage.checked + coverage.unverified;

  const loadLedger = useCallback(() => {
    fetchAutonomyEvents()
      .then(setEvents)
      .catch(() => {});
    fetchAutonomy()
      .then(setRules)
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadLedger();
  }, [loadLedger]);

  const run = async () => {
    setBusy(true);
    try {
      const r = await svc.verification.run();
      setReport(r);
      toast.success(
        `Checked ${r.checked} claim(s); ${r.changed} entry(ies) updated, ${r.missingText} without source text.`,
      );
      loadLedger();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageTitle subtitle="What the engine decides on its own, what it measures, and how. Nothing here is approved by a person; nothing a person decided is overruled.">
        Autonomy
      </PageTitle>

      <Panel
        title="Deterministic verification"
        right={
          <div className="flex items-center gap-2">
            <Tag tone={view.ran ? "success" : "muted"} mono>
              {view.ran ? `last run ${view.at.slice(11, 16)}` : "not run yet"}
            </Tag>
            <Btn size="sm" onClick={run} disabled={busy}>
              {busy ? "Checking…" : "Run verification"}
            </Btn>
          </div>
        }
      >
        <p className="text-xs text-muted-foreground">
          No AI, no human. Four checks that need none: the quoted evidence is in the source post,
          the figure is measured in the unit the attribute uses, it is physically plausible, and the
          sentence carrying the evidence names the system it was filed under. A claim that fails one
          is <em>rejected</em> — the source or the arithmetic contradicts it. A claim whose checks
          cannot run, or whose sentence names no system, is <em>uncertain</em>. Neither is sent to a
          person to approve.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          These checks show the extractor read the post correctly, not that the post is right. For
          now they are measured only: uncertain and rejected claims are still counted in consensus.
          How often a verified claim is actually right is measured by a person reading a sample, on
          the{" "}
          <Link to="/audit" className="underline">
            Audit
          </Link>{" "}
          page.
        </p>

        <CardGrid cols={3} className="mt-4">
          <Stat
            label="Checked"
            value={`${coverage.checked}`}
            hint={`of ${machineClaims} machine claims (${coverage.analyst} analyst)`}
          />
          <Stat
            label="Decided"
            value={pct(view.decided)}
            hint={`${coverage.verified} verified · ${coverage.rejected} rejected`}
          />
          <Stat
            label="Uncertain"
            value={`${coverage.uncertain}`}
            hint="shown, still counted in consensus"
          />
          <Stat
            label="Not yet checked"
            value={`${coverage.unverified}`}
            hint="no verification record"
          />
          <Stat
            label="Independent sources"
            value={`${view.medianIndependentSources}`}
            hint="median across verified claims"
          />
          <Stat
            label="Last run"
            value={view.ran ? `${view.checked}` : "—"}
            hint={view.ran ? `${view.changed} entries updated` : "run to refresh"}
          />
        </CardGrid>

        <p className="mt-3 text-xs text-muted-foreground">
          Coverage is reported next to the score on purpose: {pct(view.decided)} decided over{" "}
          {coverage.checked} checked claim(s) is the whole claim the number makes.
        </p>
      </Panel>

      <SecondReaderPanel />

      <Panel
        title={`Claims to look at (${view.exceptionCount})`}
        right={
          view.truncated ? <Tag tone="muted">showing {view.exceptions.length}</Tag> : undefined
        }
      >
        {view.exceptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing rejected or uncertain. {coverage.checked === 0 ? "Run the verifier first." : ""}
          </p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {view.exceptions.map((e, i) => (
              <ListRow
                key={`${e.droneId}|${e.specKey}|${i}`}
                title={
                  <>
                    {e.droneName} <span className="text-muted-foreground">· {e.specLabel}</span>
                  </>
                }
                subtitle={
                  <>
                    <span className="font-mono">{e.value}</span> — {e.source} ·{" "}
                    {e.date.slice(0, 10)}
                    {e.detail ? ` · ${e.detail}` : ""}
                  </>
                }
                meta={
                  <>
                    <Tag tone={e.state === "rejected" ? "danger" : "muted"} mono>
                      {e.state}
                    </Tag>
                    {e.independentSources > 1 && <Tag mono>{e.independentSources} outlets</Tag>}
                  </>
                }
                actions={
                  <Link
                    to="/systems/$id"
                    params={{ id: e.droneId }}
                    className="font-mono text-xs text-primary hover:underline"
                  >
                    Open →
                  </Link>
                }
              />
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Decision ledger" right={<Tag mono>{events.length}</Tag>}>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No decisions recorded yet. Each verification run appends one line; the catalogue is the
            state, this is the history.
          </p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {events.map((e) => (
              <ListRow
                key={e.id}
                title={
                  <span className="font-mono text-xs">
                    {e.action}{" "}
                    <span className="text-muted-foreground">
                      · {e.targetCollection}/{e.targetId}
                    </span>
                  </span>
                }
                subtitle={[e.reason, coverageChange(e.before, e.after)].filter(Boolean).join(" · ")}
                meta={
                  <>
                    <Tag mono>{e.actor}</Tag>
                    {e.verdict && <Tag mono>{e.verdict}</Tag>}
                    {e.reversedBy && <Tag tone="danger">reversed</Tag>}
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {e.at.slice(0, 16).replace("T", " ")}
                    </span>
                  </>
                }
              />
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Rule lifecycle"
        right={
          rules ? (
            <Tag tone={rules.autopromote ? "success" : "muted"} mono>
              {rules.autopromote ? "auto-promotion on" : "auto-promotion off"}
            </Tag>
          ) : undefined
        }
      >
        <p className="text-xs text-muted-foreground">
          Generated extraction rules are earned per category: shadow on unseen reports, then
          auto-activated only above the precision and trust bars. This is the same
          <Link to="/evaluation" className="mx-1 text-primary hover:underline">
            evaluation
          </Link>
          machinery; the ledger above records verification, the list below records rule decisions.
        </p>
        {rules && rules.recent.length > 0 ? (
          <ul className="mt-2 divide-y divide-border border-t border-border">
            {rules.recent.map((r, i) => (
              <ListRow
                key={`${r.ruleId}|${i}`}
                title={<span className="font-mono text-xs">{r.ruleId}</span>}
                subtitle={r.note ?? undefined}
                meta={
                  <>
                    <Tag mono>{r.decision}</Tag>
                    <Tag mono>{r.actor}</Tag>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {r.at.slice(0, 10)}
                    </span>
                  </>
                }
              />
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No rule decisions recorded.</p>
        )}
      </Panel>

      <JobStatusPanel />
    </div>
  );
}
