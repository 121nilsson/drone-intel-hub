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
  triggerMinePatterns,
  triggerApproveOverride,
  triggerRejectOverride,
  fetchEvalReports,
  triggerGitImport,
  triggerHarvest,
  triggerAdjudication,
} from "@/shared/infra/evaluation.functions";
import type { PatternSuggestion } from "@/shared/infra/evaluation.server";

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
  const [suggestions, setSuggestions] = useState<PatternSuggestion[]>([]);
  const [trend, setTrend] = useState<{ generatedAt: string; f1: number }[]>([]);

  useEffect(() => {
    fetchEvalReports()
      .then((rows) =>
        setTrend(rows.map((r) => ({ generatedAt: r.generatedAt, f1: r.f1 })).reverse()),
      )
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
      toast.error(`Utvärderingen misslyckades: ${(e as Error).message}`);
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
      <PageTitle subtitle="Kör heuristiken isolerat mot redan bearbetade rapporter och jämför med lagrad extraction. Skriver aldrig till databasen och anropar aldrig AI.">
        Heuristic evaluation
      </PageTitle>
      <Panel title="Så läser du resultaten">
        <p className="text-sm text-muted-foreground">
          <strong>P (Precision)</strong> = andel heuristik-träffar som också finns i den lagrade
          extractionen (få falska positiva). <strong>R (Recall)</strong> = andel lagrade värden som
          heuristiken hittade (få missar). <strong>F1</strong> = balanserat mått (2·P·R/(P+R)); 1.0
          = perfekt.
          <br />
          <strong>tp</strong> = träffar, <strong>fp</strong> = falska positiva, <strong>fn</strong>{" "}
          = missar. Mismatch-typer: <em>exact/semantic</em> = match, <em>differentReading</em> =
          samma värde men annan läsning (t.ex. "up to 120 km"), <em>wrongKey</em> = rätt värde men
          fel nyckel, <em>falsePositive</em> = heuristiken hittade något AI inte hade,
          <em>miss</em> = AI hittade något heuristiken missade.
        </p>
      </Panel>

      {trend.length > 1 && (
        <Panel title="Trend (F1 över tid)">
          <div className="flex items-center gap-3">
            <Sparkline values={trend.map((t) => t.f1)} width={120} height={24} />
            <span className="font-mono text-xs text-muted-foreground">
              {trend.length} körningar · senaste F1 {trend[trend.length - 1]?.f1.toFixed(2)}
            </span>
          </div>
        </Panel>
      )}

      <Panel title="Urval">
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
            inkl. kasserade
          </label>
          <Btn onClick={run} disabled={running || candidates.length === 0}>
            {running && progress
              ? `Kör… ${progress.done}/${progress.total}`
              : running
                ? "Kör…"
                : "Kör utvärdering"}
          </Btn>
          <Btn
            variant="ghost"
            disabled={running}
            onClick={async () => {
              setRunning(true);
              try {
                const r = await triggerEvaluation();
                toast.success(`Server-utvärdering klar: ${r.totalItems ?? 0} kandidater`);
              } catch (e) {
                toast.error(`Server-utvärdering misslyckades: ${(e as Error).message}`);
              } finally {
                setRunning(false);
              }
            }}
          >
            Kör på server (spara rapport)
          </Btn>
        </div>
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          {candidates.length} kandidater tillgängliga · endast texter ≥ 50 tecken · kontraktsbelopp
          räknas inte
        </p>
      </Panel>

      {report && (
        <>
          <CardGrid cols={3}>
            <Kpi label="Specs" v={report.summary} />
            <Kpi label="Systemnamn" v={report.identity.name} />
            <Kpi label="Katalogkoppling" v={report.identity.matchId} />
          </CardGrid>

          <Panel title={`Urval: ${report.totalItems} rapporter`}>
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
                    ⚠ {t}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Regressionstester"
            right={
              <div className="flex flex-wrap gap-2">
                <Btn
                  variant="ghost"
                  disabled={report.fixtures.length === 0}
                  onClick={() => {
                    download("eval-corpus.json", fixturesToCorpus(report.fixtures));
                    toast.success("Lägg filen i src/test/fixtures/ — testerna körs automatiskt");
                  }}
                >
                  Ladda ner corpus
                </Btn>
                <Btn
                  variant="ghost"
                  disabled={report.mismatches.length === 0}
                  onClick={() => {
                    download("eval-mismatches.json", mismatchesToFixtures(report.mismatches));
                    toast.success(
                      "Lägg filen i src/test/fixtures/ — negativa tester körs automatiskt",
                    );
                  }}
                >
                  Ladda ner mismatch-corpus
                </Btn>
                <Btn
                  variant="ghost"
                  disabled={drones.length === 0}
                  onClick={() => {
                    download("eval-catalog.json", drones);
                    toast.success(
                      "Lägg filen i src/test/fixtures/ — samma katalog som utvärderingen använde",
                    );
                  }}
                >
                  Ladda ner katalog
                </Btn>
              </div>
            }
          >
            <p className="text-sm text-muted-foreground">
              {report.fixtures.length} rapporter där heuristiken och lagrad extraction är överens
              blir testfall ({report.fixtures.reduce((n, f) => n + f.expect.length, 0)} förväntade
              värden). Ersätt{" "}
              <code className="font-mono text-xs">src/test/fixtures/eval-corpus.json</code> med
              filen så låser testsviten dagens korrekta beteende.
            </p>
          </Panel>

          <Panel title="Per spec-nyckel (sämst först)" contentClassName="p-0">
            <ul className="divide-y divide-border">
              {keys.map(([k, v]) => {
                const mis = report.mismatches.filter((m) => m.specKey === k);
                return (
                  <li key={k}>
                    <button
                      className="w-full text-left"
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
                          <p className="text-xs text-muted-foreground">Inga avvikelser.</p>
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
                              nyckel: {m.specKey} · {m.matchType}
                            </div>

                            <div className="mt-1 font-mono">
                              heuristik: {m.heuristicValue ?? "—"} {m.heuristicUnit ?? ""} · lagrad:{" "}
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

          <Panel title="Förslag (mönstergrävning)">
            <div className="mb-3 flex flex-wrap gap-2">
              <Btn
                variant="ghost"
                onClick={async () => {
                  try {
                    const s = await triggerMinePatterns();
                    setSuggestions(s);
                    toast.success(`${s.length} förslag hittade`);
                  } catch (e) {
                    toast.error(`Mönstergrävning misslyckades: ${(e as Error).message}`);
                  }
                }}
              >
                Analysera mönster
              </Btn>
            </div>
            {suggestions.length === 0 && (
              <p className="text-sm text-muted-foreground">Inga förslag ännu.</p>
            )}
            <ul className="space-y-2">
              {suggestions.map((s) => (
                <li key={s.id} className="border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs">{s.description}</span>
                    <div className="flex gap-2">
                      <Btn
                        variant="ghost"
                        onClick={async () => {
                          await triggerApproveOverride({ data: { suggestion: s } });
                          setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
                          toast.success("Förslag godkänt — skrivs till lexicon_overrides");
                        }}
                      >
                        Godkänn
                      </Btn>
                      <Btn
                        variant="danger"
                        onClick={async () => {
                          await triggerRejectOverride({ data: { id: s.id } });
                          setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
                          toast.success("Förslag avvisat");
                        }}
                      >
                        Avvisa
                      </Btn>
                    </div>
                  </div>
                  {s.sample.length > 0 && (
                    <ul className="mt-2 space-y-1 font-mono text-[11px] text-muted-foreground">
                      {s.sample.map((e, i) => (
                        <li key={i} className="break-words">
                          {e}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Automation (server)">
            <div className="flex flex-wrap gap-2">
              <Btn
                variant="ghost"
                onClick={async () => {
                  const r = await triggerGitImport();
                  toast.success(`Import: ${r.imported} nya, ${r.skipped} hoppade`);
                }}
              >
                Importera git-corpus
              </Btn>
              <Btn
                variant="ghost"
                onClick={async () => {
                  const r = await triggerHarvest();
                  toast.success(`Harvest: ${r.inserted} nya, ${r.skipped} hoppade`);
                }}
              >
                Harvest corpus
              </Btn>
              <Btn
                variant="ghost"
                onClick={async () => {
                  const r = await triggerAdjudication();
                  toast.success(`Adjudication: ${r.adjudicated} domar, ${r.inserted} nya`);
                }}
              >
                Kör adjudication
              </Btn>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
