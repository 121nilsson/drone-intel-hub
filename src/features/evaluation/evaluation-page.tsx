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
  Sparkline,
  Tag,
} from "@/shared/ui/primitives";
import {
  evaluateHeuristic,
  fixturesToCorpus,
  mismatchesToFixtures,
  type EvalReport,
  type Prf,
} from "./evaluation";
import {
  triggerEvaluation,
  fetchEvalReports,
  fetchEvalKeyTrends,
  triggerGitImport,
  triggerHarvest,
  triggerAdjudication,
} from "@/shared/infra/evaluation.functions";
import type { EvalKeyTrend } from "@/shared/infra/evaluation.server";
import { RulesPanel } from "./rules-panel";

const pct = (n: number) => `${Math.round(n * 100)}%`;
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
    <div className="space-y-4">
      <PageTitle subtitle="Run the heuristic engine in isolation against already-processed reports and compare with stored extraction. Never writes to the database and never calls AI.">
        Heuristic evaluation
      </PageTitle>
      <Panel title="How it works">
        <p className="text-sm text-muted-foreground">
          1. Click <strong>Run evaluation</strong> to sample candidates and compare heuristic vs
          stored extraction. 2. Review mismatches per spec key. 3. Use{" "}
          <strong>Automation (server)</strong> to import/harvest corpus or run adjudication. 4.
          Propose and sandbox dynamic rules in
          <strong> Dynamiska regler</strong>. All server actions are safe and never modify heuristic
          code automatically.
        </p>
      </Panel>
      <Panel title="How to read the results">
        <p className="text-sm text-muted-foreground">
          <strong>P (Precision)</strong> = share of heuristic hits that also exist in the stored
          extraction (fewer false positives). <strong>R (Recall)</strong> = share of stored values
          the heuristic found (fewer misses). <strong>F1</strong> = balanced metric (2·P·R/(P+R));
          1.0 = perfect.
          <br />
          <strong>tp</strong> = hits, <strong>fp</strong> = false positives, <strong>fn</strong> =
          misses. Mismatch types: <em>exact/semantic</em> = match, <em>differentReading</em> = same
          value but different reading (e.g. "up to 120 km"), <em>wrongKey</em> = right value but
          wrong key, <em>falsePositive</em> = heuristic found something AI did not,
          <em>rejected</em> = AI saw the heuristic value and dropped it, <em>miss</em> = AI found
          something the heuristic missed.
        </p>
      </Panel>

      {trend.length > 1 && (
        <Panel title="Trend (F1 over time)">
          <div className="flex items-center gap-3">
            <Sparkline values={trend.map((t) => t.f1)} width={120} height={24} />
            <span className="font-mono text-xs text-muted-foreground">
              {trend.length} runs · latest F1 {trend[trend.length - 1]?.f1.toFixed(2)}
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

      <Panel title="Sample">
        <div className="flex flex-wrap items-center gap-2">
          {SIZES.map((n) => (
            <Btn key={n} variant={n === size ? "primary" : "ghost"} onClick={() => setSize(n)}>
              {n}
            </Btn>
          ))}
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
                  onClick={() => {
                    download("eval-corpus.json", fixturesToCorpus(report.fixtures));
                    toast.success("Save the file in src/test/fixtures/ — tests run automatically");
                  }}
                >
                  Download corpus
                </Btn>
                <Btn
                  variant="ghost"
                  disabled={report.mismatches.length === 0}
                  onClick={() => {
                    download("eval-mismatches.json", mismatchesToFixtures(report.mismatches));
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
              <code className="font-mono text-xs">src/test/fixtures/eval-corpus.json</code> with the
              file and the test suite locks in today's correct behavior.
            </p>
          </Panel>

          <Panel title="Per spec key (worst first)" contentClassName="p-0">
            <ul className="divide-y divide-border">
              {keys.map(([k, v]) => {
                const mis = report.mismatches.filter((m) => m.specKey === k);
                return (
                  <li key={k}>
                    <button
                      className="w-full cursor-pointer text-left"
                      onClick={() => setOpenKey(openKey === k ? null : k)}
                    >
                      <ListRow
                        title={<span className="font-mono">{k}</span>}
                        subtitle={`tp ${v.tp} · fp ${v.fp} · fn ${v.fn}`}
                        meta={
                          <Tag
                            tone={v.f1 < 0.5 ? "danger" : v.f1 < 0.8 ? "warning" : "success"}
                            mono
                          >
                            F1 {v.f1.toFixed(2)} · P {pct(v.precision)} · R {pct(v.recall)}
                          </Tag>
                        }
                      />
                    </button>
                    {openKey === k && (
                      <div className="space-y-2 px-3 pb-3">
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
                              heuristic: {m.heuristicValue ?? "—"} {m.heuristicUnit ?? ""} → stored:{" "}
                              {m.referenceValue ?? "—"} {m.referenceUnit ?? ""}
                            </div>
                            {m.evidence && (
                              <p className="mt-1 break-words italic text-muted-foreground">
                                “{m.evidence}”
                              </p>
                            )}
                          </Card>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Panel>
        </>
      )}
      <Panel title="Automation (server)">
        <p className="mb-3 text-xs text-muted-foreground">
          Run these after an evaluation to import, harvest, or adjudicate. They never modify the
          heuristic code.
        </p>
        <div className="flex flex-wrap gap-2">
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
        </div>
      </Panel>

      <RulesPanel />
    </div>
  );
}
