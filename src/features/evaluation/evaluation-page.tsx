import { useEffect, useState } from "react";
import { useDrones, useServices } from "@/shared/infra/use-services";
import { CardGrid, PageTitle, Panel, Sparkline, Tag } from "@/shared/ui/primitives";
import type { EvalReport } from "@/shared/infra/evaluation/evaluation";
import {
  fetchEvalReports,
  fetchEvalKeyTrends,
  fetchSeedAgreement,
} from "@/shared/infra/evaluation/evaluation.functions";
import type { EvalKeyTrend } from "@/shared/infra/evaluation/evaluation.server";
import { RulesPanel } from "./rules-panel";
import { AnalystReviewPanel } from "./analyst-review-panel";
import { CorrectionQueue } from "./correction-queue";
import { PendingFixturesPanel } from "./pending-fixtures-panel";
import { Stage } from "./action-list";
import { JobStatusPanel } from "@/shared/ui/job-status-panel";
import { Kpi } from "./evaluation-kpi";
import { pct } from "@/shared/ui/format";
import { RunEvaluationPanel } from "./run-evaluation-panel";
import { ReferenceCoveragePanel } from "./reference-coverage-panel";
import { SeedAgreementPanel, type SeedState } from "./seed-agreement-panel";
import { RegressionTestsPanel } from "./regression-tests-panel";
import { PerKeyPanel } from "./per-key-panel";
import { TestCorpusPanel } from "./test-corpus-panel";

const STAGES = [
  {
    id: "decide",
    n: 1,
    title: "Needs your decision",
    when: "Corrections and test cases waiting for a person. Start here - it is the only part that needs you regularly.",
  },
  {
    id: "measure",
    n: 2,
    title: "Measure the heuristic",
    when: "See how well the heuristic reads reports, and where it goes wrong. Run after a code change or a new active rule.",
  },
  {
    id: "teach",
    n: 3,
    title: "Teach the heuristic",
    when: "Review, test and activate rules, and keep the test corpus current. Work here when a weakness shows up in step 2.",
  },
];

export function EvaluationPage() {
  const drones = useDrones();
  const [report, setReport] = useState<EvalReport | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [trend, setTrend] = useState<
    { generatedAt: string; f1: number; ref?: number | undefined }[]
  >([]);
  const [keyTrends, setKeyTrends] = useState<EvalKeyTrend[]>([]);
  const [seed, setSeed] = useState<SeedState | null>(null);

  useEffect(() => {
    fetchEvalReports()
      .then((rows) =>
        setTrend(
          rows
            .map((r) => ({ generatedAt: r.generatedAt, f1: r.f1, ref: r.reference?.ratio }))
            .reverse(),
        ),
      )
      .catch(() => {});
    fetchEvalKeyTrends()
      .then((rows) => setKeyTrends(rows))
      .catch(() => {});
    fetchSeedAgreement()
      .then((s) => setSeed(s))
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-8">
      <PageTitle subtitle="Where the heuristic engine - the rule-based reader that runs before any AI - is checked against reality and taught to read better. Nothing on this page edits the heuristic's code.">
        Evaluation
      </PageTitle>

      <Panel title="Start here">
        <ol className="grid gap-3 text-sm md:grid-cols-3">
          {STAGES.map((s) => (
            <li key={s.id} className="min-w-0">
              <a href={`#${s.id}`} className="font-medium text-primary hover:underline">
                {s.n} · {s.title}
              </a>
              <p className="mt-0.5 text-xs text-muted-foreground">{s.when}</p>
            </li>
          ))}
        </ol>
      </Panel>

      <div id="automation" className="scroll-mt-20">
        <JobStatusPanel />
      </div>

      <Stage
        id="decide"
        n={1}
        title="Needs your decision"
        purpose="Your answers are ground truth: they score every automatic check and are replayed as regression tests. Clear this list whenever something is waiting."
      >
        <CorrectionQueue drones={drones} />
        <PendingFixturesPanel />
      </Stage>

      <Stage
        id="measure"
        n={2}
        title="Measure the heuristic"
        purpose="Run after the heuristic code changes or a rule is activated, to see where it reads reports wrongly. Read-only: it never writes to the catalogue and never calls AI."
      >
        <RunEvaluationPanel
          onReport={(r) => {
            setReport(r);
            setOpenKey(null);
          }}
        />

        {report && (
          <>
            <CardGrid cols={3}>
              <Kpi label="Specs" v={report.summary} />
              <Kpi label="System names" v={report.identity.name} />
              <Kpi label="Catalog links" v={report.identity.matchId} />
            </CardGrid>

            <ReferenceCoveragePanel report={report} />

            {seed && <SeedAgreementPanel seed={seed} />}

            <Panel title={`Sample: ${report.totalItems} reports`}>
              <div className="flex flex-wrap gap-1.5">
                {(["platform", "outcome", "epoch"] as const).flatMap((dim) =>
                  Object.entries(report.stratification[dim]).map(([k, n]) => (
                    <Tag
                      key={`${dim}-${k}`}
                      tone={dim === "platform" ? "info" : dim === "outcome" ? "default" : "muted"}
                      mono
                    >
                      {k}: {n}
                    </Tag>
                  )),
                )}
              </div>
              {report.topIssues.length > 0 && (
                <ul className="mt-3 space-y-1 font-mono text-xs text-warning">
                  {report.topIssues.map((t) => (
                    <li key={t} className="break-words">
                      · {t}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <RegressionTestsPanel report={report} />

            <PerKeyPanel report={report} openKey={openKey} setOpenKey={setOpenKey} />
          </>
        )}
        {trend.length > 1 && (
          <Panel title="Trend (F1 over time)">
            <div className="flex items-center gap-3">
              <Sparkline values={trend.map((t) => t.f1)} width={120} height={24} />
              <span className="font-mono text-xs text-muted-foreground">
                {trend.length} server runs · latest F1 {trend[trend.length - 1]?.f1.toFixed(2)}
                {trend[trend.length - 1]?.ref !== undefined &&
                  ` · ref ${pct(trend[trend.length - 1]!.ref!)}`}
              </span>
            </div>
          </Panel>
        )}

        {keyTrends.length > 0 && (
          <Panel title="Trend per spec key">
            <ul className="space-y-2">
              {keyTrends.map((k) => (
                <li key={k.key} className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs">{k.key}</span>
                  <div className="flex items-center gap-2">
                    <Sparkline values={k.values} width={80} height={16} />
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {k.values.length} runs · F1 {k.values[k.values.length - 1]?.toFixed(2)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <AnalystReviewPanel drones={drones} />
      </Stage>

      <Stage
        id="teach"
        n={3}
        title="Teach the heuristic"
        purpose="Rules change what the heuristic reads; the test corpus is what every rule is checked against. Work here once the evaluation shows a weakness, or when shadow rules have had time to collect results."
      >
        <RulesPanel />
        <TestCorpusPanel />
      </Stage>
    </div>
  );
}
