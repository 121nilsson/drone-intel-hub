import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useCandidates, useDrones, useServices } from "@/shared/infra/services";
import {
  Btn,
  Card,
  CardGrid,
  ListRow,
  PageTitle,
  Panel,
  Segmented,
  Sparkline,
  Tag,
} from "@/shared/ui/primitives";
import {
  analystCorpus,
  evaluateHeuristic,
  fixturesToCorpus,
  mismatchesToFixtures,
  type EvalReport,
  type Prf,
} from "@/shared/infra/evaluation/evaluation";
import {
  triggerEvaluation,
  fetchEvalReports,
  fetchEvalKeyTrends,
  triggerGitImport,
  triggerHarvest,
  triggerAdjudication,
} from "@/shared/infra/evaluation/evaluation.functions";
import type { EvalKeyTrend } from "@/shared/infra/evaluation/evaluation.server";
import { RulesPanel } from "./rules-panel";
import { AnalystReviewPanel } from "./analyst-review-panel";
import { CorrectionQueue } from "./correction-queue";
import { PendingFixturesPanel } from "./pending-fixtures-panel";
import { ActionList, Stage } from "./action-list";
import { JobStatusPanel } from "./job-status-panel";

const pct = (n: number) => `${Math.round(n * 100)}%`;

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
const SIZES = [50, 100, 250, 500];

function Kpi({ label, v }: { label: string; v: Prf }) {
  return (
    <Card className="p-3">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold">F1 {v.f1.toFixed(2)}</div>
      <div className="font-mono text-xs text-muted-foreground">
        P {pct(v.precision)} · R {pct(v.recall)}
      </div>
    </Card>
  );
}

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function EvaluationPage() {
  const candidates = useCandidates();
  const drones = useDrones();
  const { heuristic } = useServices();
  const [size, setSize] = useState(100);
  const [discarded, setDiscarded] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [report, setReport] = useState<EvalReport | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [trend, setTrend] = useState<{ generatedAt: string; f1: number }[]>([]);
  const [keyTrends, setKeyTrends] = useState<EvalKeyTrend[]>([]);
  const [autoBusy, setAutoBusy] = useState<string | null>(null);
  const [autoStartedAt, setAutoStartedAt] = useState<number | null>(null);
  const [autoNow, setAutoNow] = useState(Date.now());

  useEffect(() => {
    if (!autoBusy || !autoStartedAt) return;
    const id = setInterval(() => setAutoNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [autoBusy, autoStartedAt]);

  useEffect(() => {
    fetchEvalReports()
      .then((rows) =>
        setTrend(rows.map((r) => ({ generatedAt: r.generatedAt, f1: r.f1 })).reverse()),
      )
      .catch(() => {});
    fetchEvalKeyTrends()
      .then((rows) => setKeyTrends(rows))
      .catch(() => {});
  }, []);

  const run = async () => {
    setRunning(true);
    try {
      setProgress({ done: 0, total: size });
      const r = await evaluateHeuristic(candidates, drones, heuristic, {
        sampleSize: size,
        includeDiscarded: discarded,
        seed: Date.now() % 100000,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setReport(r);
      setOpenKey(null);
    } catch (e) {
      toast.error(`Evaluation failed: ${(e as Error).message}`);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const keys = useMemo(
    () =>
      report
        ? Object.entries(report.perKey)
            .filter(([, v]) => v.tp + v.fp + v.fn > 0)
            .sort(([, a], [, b]) => a.f1 - b.f1 || b.tp + b.fn - (a.tp + a.fn))
        : [],
    [report],
  );

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
        <Panel title="Run an evaluation">
          <p className="mb-3 text-xs text-muted-foreground">
            Picks a sample of processed reports, reads each again with the heuristic, and compares
            the result with what is stored (analyst verdicts first, then the AI&apos;s reading).
            Pick a sample size and run it here, or run it on the server to keep the report for the
            trend.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label="Sample size"
              value={String(size)}
              onChange={(n) => setSize(Number(n))}
              options={SIZES.map((n) => ({ value: String(n), label: n }))}
            />
            <label className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={discarded}
                onChange={(e) => setDiscarded(e.target.checked)}
              />
              incl. discarded
            </label>
            <Btn onClick={run} disabled={running || candidates.length === 0}>
              {running && progress
                ? `Running… ${progress.done}/${progress.total}`
                : running
                  ? "Running…"
                  : "Run evaluation"}
            </Btn>
            <Btn
              variant="ghost"
              disabled={running}
              onClick={async () => {
                setRunning(true);
                try {
                  const r = await triggerEvaluation();
                  toast.success(`Server evaluation done: ${r.totalItems ?? 0} candidates`);
                } catch (e) {
                  toast.error(`Server evaluation failed: ${(e as Error).message}`);
                } finally {
                  setRunning(false);
                }
              }}
            >
              Run on server (save report)
            </Btn>
          </div>
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            {candidates.length} candidates available · only texts ≥ 50 chars · contract values
            excluded
          </p>
          <details className="mt-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer">How to read the results</summary>
            <p className="mt-2">
              <strong>P (precision)</strong> = share of the heuristic&apos;s values that the stored
              reading also has (fewer false positives). <strong>R (recall)</strong> = share of
              stored values the heuristic found (fewer misses). <strong>F1</strong> balances the two
              (2·P·R/(P+R)); 1.0 is perfect.
            </p>
            <p className="mt-2">
              <strong>tp</strong> = hits, <strong>fp</strong> = false positives, <strong>fn</strong>{" "}
              = misses. Mismatch types: <em>exact/semantic</em> = match, <em>differentReading</em> =
              same value read differently (&quot;up to 120 km&quot;), <em>wrongKey</em> = right
              value under the wrong attribute, <em>falsePositive</em> = the heuristic found
              something the stored reading does not have, <em>rejected</em> = AI saw the
              heuristic&apos;s value and dropped it, <em>miss</em> = the stored reading has
              something the heuristic missed.
            </p>
          </details>
        </Panel>

        {report && (
          <>
            <CardGrid cols={3}>
              <Kpi label="Specs" v={report.summary} />
              <Kpi label="System names" v={report.identity.name} />
              <Kpi label="Catalog links" v={report.identity.matchId} />
            </CardGrid>

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

            <Panel
              title="Regression tests"
              right={
                <div className="flex flex-wrap gap-2">
                  <Btn
                    variant="ghost"
                    disabled={report.fixtures.length === 0}
                    onClick={async () => {
                      const analyst = await analystCorpus(candidates, drones, heuristic);
                      download(
                        "eval-corpus.json",
                        fixturesToCorpus([...analyst.positive, ...report.fixtures]),
                      );
                      toast.success(
                        "Save the file in src/test/fixtures/ — tests run automatically",
                      );
                    }}
                  >
                    Download corpus
                  </Btn>
                  <Btn
                    variant="ghost"
                    disabled={report.mismatches.length === 0}
                    onClick={async () => {
                      const analyst = await analystCorpus(candidates, drones, heuristic);
                      download("eval-mismatches.json", [
                        ...analyst.negative,
                        ...mismatchesToFixtures(report.mismatches),
                      ]);
                      toast.success(
                        "Save the file in src/test/fixtures/ — negative tests run automatically",
                      );
                    }}
                  >
                    Download mismatch-corpus
                  </Btn>
                  <Btn
                    variant="ghost"
                    disabled={drones.length === 0}
                    onClick={() => {
                      download("eval-catalog.json", drones);
                      toast.success(
                        "Save the file in src/test/fixtures/ — same catalog used by the evaluation",
                      );
                    }}
                  >
                    Download catalog
                  </Btn>
                </div>
              }
            >
              <p className="text-sm text-muted-foreground">
                {report.fixtures.length} reports where heuristic and stored extraction agree become
                test cases ({report.fixtures.reduce((n, f) => n + f.expect.length, 0)} expected
                values). Replace{" "}
                <code className="font-mono text-xs">src/test/fixtures/eval-corpus.json</code> with
                the file and the test suite locks in today's correct behavior.
              </p>
            </Panel>

            <Panel title="Per spec key (worst first)" contentClassName="p-0">
              {(report.unscoredMisses ?? 0) > 0 && (
                <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
                  {report.unscoredMisses} stored figure{report.unscoredMisses === 1 ? "" : "s"} with
                  no canonical meaning (role, status, container dimensions…) are not scored: the
                  heuristic never tries to read them.
                </p>
              )}
              <ul className="divide-y divide-border">
                {keys.map(([k, v]) => {
                  const mis = report.mismatches.filter((m) => m.specKey === k);
                  return (
                    // The key name is the toggle; a row cannot sit inside a button, since the
                    // row is itself a list item.
                    <ListRow
                      key={k}
                      className="px-3"
                      title={
                        <Btn
                          variant="link"
                          className="font-mono"
                          aria-expanded={openKey === k}
                          onClick={() => setOpenKey(openKey === k ? null : k)}
                        >
                          {openKey === k ? "▾" : "▸"} {k}
                        </Btn>
                      }
                      subtitle={`tp ${v.tp} · fp ${v.fp} · fn ${v.fn}`}
                      meta={
                        <Tag tone={v.f1 < 0.5 ? "danger" : v.f1 < 0.8 ? "warning" : "success"} mono>
                          F1 {v.f1.toFixed(2)} · P {pct(v.precision)} · R {pct(v.recall)}
                        </Tag>
                      }
                      below={
                        openKey === k ? (
                          <div className="space-y-2">
                            {mis.length === 0 && (
                              <p className="text-xs text-muted-foreground">No mismatches.</p>
                            )}
                            {mis.map((m, i) => (
                              <Card key={i} className="text-xs">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Tag tone="warning" mono>
                                    {m.matchType}
                                  </Tag>
                                  <span className="min-w-0 break-all font-mono text-muted-foreground">
                                    {m.source}
                                  </span>
                                </div>
                                <div className="mt-1 font-mono">
                                  key: {m.specKey} · {m.matchType}
                                </div>

                                <div className="mt-1 font-mono">
                                  heuristic: {m.heuristicValue ?? "—"} {m.heuristicUnit ?? ""} →
                                  stored: {m.referenceValue ?? "—"} {m.referenceUnit ?? ""}
                                </div>
                                {m.evidence && (
                                  <p className="mt-1 break-words italic text-muted-foreground">
                                    “{m.evidence}”
                                  </p>
                                )}
                              </Card>
                            ))}
                          </div>
                        ) : undefined
                      }
                    />
                  );
                })}
              </ul>
            </Panel>
          </>
        )}
        {trend.length > 1 && (
          <Panel title="Trend (F1 over time)">
            <div className="flex items-center gap-3">
              <Sparkline values={trend.map((t) => t.f1)} width={120} height={24} />
              <span className="font-mono text-xs text-muted-foreground">
                {trend.length} server runs · latest F1 {trend[trend.length - 1]?.f1.toFixed(2)}
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

        <Panel title="Test corpus (server)">
          <p className="mb-3 text-xs text-muted-foreground">
            The corpus is the set of reports with known right answers that every rule and every
            evaluation is scored against. These run only when you press them.
          </p>
          <ActionList
            items={[
              {
                button: (
                  <Btn
                    variant="ghost"
                    disabled={!!autoBusy}
                    onClick={async () => {
                      setAutoBusy("import");
                      setAutoStartedAt(Date.now());
                      try {
                        const r = await triggerGitImport();
                        toast.success(`Import: ${r.imported} new, ${r.skipped} skipped`);
                      } catch (e) {
                        toast.error(`Import failed: ${(e as Error).message}`);
                      } finally {
                        setAutoBusy(null);
                        setAutoStartedAt(null);
                      }
                    }}
                  >
                    {autoBusy === "import" && autoStartedAt
                      ? `Importing… ${Math.max(1, Math.round((autoNow - autoStartedAt) / 1000))}s`
                      : "Import git corpus"}
                  </Btn>
                ),
                does: (
                  <>
                    Loads <code className="font-mono">src/test/fixtures/eval-corpus.json</code> into
                    the database corpus. Press after that file changes in git.
                  </>
                ),
              },
              {
                button: (
                  <Btn
                    variant="ghost"
                    disabled={!!autoBusy}
                    onClick={async () => {
                      setAutoBusy("harvest");
                      setAutoStartedAt(Date.now());
                      try {
                        const r = await triggerHarvest();
                        toast.success(`Harvest: ${r.inserted} new, ${r.skipped} skipped`);
                      } catch (e) {
                        toast.error(`Harvest failed: ${(e as Error).message}`);
                      } finally {
                        setAutoBusy(null);
                        setAutoStartedAt(null);
                      }
                    }}
                  >
                    {autoBusy === "harvest" && autoStartedAt
                      ? `Harvesting… ${Math.max(1, Math.round((autoNow - autoStartedAt) / 1000))}s`
                      : "Harvest corpus"}
                  </Btn>
                ),
                does: "Runs a fresh evaluation and adds the reports where the heuristic and the stored reading agree as new test cases, so today's correct readings stay correct.",
              },
              {
                button: (
                  <Btn
                    variant="ghost"
                    disabled={!!autoBusy}
                    onClick={async () => {
                      setAutoBusy("adjudication");
                      setAutoStartedAt(Date.now());
                      try {
                        const r = await triggerAdjudication();
                        toast.success(`Adjudication: ${r.adjudicated} verdicts, ${r.inserted} new`);
                      } catch (e) {
                        toast.error(`Adjudication failed: ${(e as Error).message}`);
                      } finally {
                        setAutoBusy(null);
                        setAutoStartedAt(null);
                      }
                    }}
                  >
                    {autoBusy === "adjudication" && autoStartedAt
                      ? `Adjudicating… ${Math.max(1, Math.round((autoNow - autoStartedAt) / 1000))}s`
                      : "Run adjudication"}
                  </Btn>
                ),
                does: (
                  <>
                    Asks AI to settle up to 10 disagreements between the heuristic and the stored
                    reading. Its answers wait under{" "}
                    <a href="#decide" className="text-primary hover:underline">
                      Pending test cases
                    </a>{" "}
                    until you approve them.
                  </>
                ),
              },
            ]}
          />
        </Panel>
      </Stage>
    </div>
  );
}
