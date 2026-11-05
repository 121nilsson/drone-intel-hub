import { toast } from "sonner";
import { useCandidates, useDrones, useServices } from "@/shared/infra/services";
import { Btn, Panel } from "@/shared/ui/primitives";
import {
  analystCorpus,
  fixturesToCorpus,
  mismatchesToFixtures,
  type EvalReport,
} from "@/shared/infra/evaluation/evaluation";
import { download } from "./evaluation-format";

export function RegressionTestsPanel({ report }: { report: EvalReport }) {
  const candidates = useCandidates();
  const drones = useDrones();
  const { heuristic } = useServices();
  return (
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
              toast.success("Save the file in src/test/fixtures/ — tests run automatically");
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
        {report.fixtures.length} reports where heuristic and stored extraction agree become test
        cases ({report.fixtures.reduce((n, f) => n + f.expect.length, 0)} expected values). Replace{" "}
        <code className="font-mono text-xs">src/test/fixtures/eval-corpus.json</code> with the file
        and the test suite locks in today's correct behavior.
      </p>
    </Panel>
  );
}
