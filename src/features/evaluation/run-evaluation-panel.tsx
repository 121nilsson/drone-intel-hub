import { useState } from "react";
import { toast } from "sonner";
import { useCandidates, useDrones, useServices } from "@/shared/infra/services";
import { Btn, Panel, Segmented } from "@/shared/ui/primitives";
import { evaluateHeuristic, type EvalReport } from "@/shared/infra/evaluation/evaluation";
import { triggerEvaluation } from "@/shared/infra/evaluation/evaluation.functions";

const SIZES = [50, 100, 250, 500];

export function RunEvaluationPanel({ onReport }: { onReport: (report: EvalReport) => void }) {
  const candidates = useCandidates();
  const drones = useDrones();
  const { heuristic } = useServices();
  const [size, setSize] = useState(100);
  const [discarded, setDiscarded] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

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
      onReport(r);
    } catch (e) {
      toast.error(`Evaluation failed: ${(e as Error).message}`);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  return (
    <Panel title="Run an evaluation">
      <p className="mb-3 text-xs text-muted-foreground">
        Picks a sample of processed reports, reads each again with the heuristic, and compares the
        result with what the catalogue has verified (analyst verdicts first, then machine
        verification, then the stored AI reading). Pick a sample size and run it here, or run it on
        the server to keep the report for the trend.
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
        {candidates.length} candidates available · only texts ≥ 50 chars · contract values excluded
      </p>
      <details className="mt-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer">How to read the results</summary>
        <p className="mt-2">
          <strong>P (precision)</strong> = share of the heuristic&apos;s values that the stored
          reading also has (fewer false positives). <strong>R (recall)</strong> = share of stored
          values the heuristic found (fewer misses). <strong>F1</strong> balances the two
          (2·P·R/(P+R)); 1.0 is perfect.
        </p>
        <p className="mt-2">
          <strong>tp</strong> = hits, <strong>fp</strong> = false positives, <strong>fn</strong> =
          misses. Mismatch types: <em>exact/semantic</em> = match, <em>differentReading</em> = same
          value read differently (&quot;up to 120 km&quot;), <em>wrongKey</em> = right value under
          the wrong attribute, <em>falsePositive</em> = the heuristic found something the stored
          reading does not have, <em>rejected</em> = AI saw the heuristic&apos;s value and dropped
          it, <em>miss</em> = the stored reading has something the heuristic missed.
        </p>
        <p className="mt-2">
          <strong>Reference coverage</strong> is the share of the comparison that rests on a
          verified claim (machine-verified, or an analyst&apos;s verdict). Claims the verifier could
          not decide are excluded from the scores rather than counted as misses, and everything else
          falls back to the stored reading — so an F1 on low coverage says little.
        </p>
      </details>
    </Panel>
  );
}
