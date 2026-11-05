import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Btn, Panel } from "@/shared/ui/primitives";
import {
  triggerAdjudication,
  triggerGitImport,
  triggerHarvest,
} from "@/shared/infra/evaluation/evaluation.functions";
import { ActionList } from "./action-list";

export function TestCorpusPanel() {
  const [autoBusy, setAutoBusy] = useState<string | null>(null);
  const [autoStartedAt, setAutoStartedAt] = useState<number | null>(null);
  const [autoNow, setAutoNow] = useState(Date.now());

  useEffect(() => {
    if (!autoBusy || !autoStartedAt) return;
    const id = setInterval(() => setAutoNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [autoBusy, autoStartedAt]);

  return (
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
                Loads <code className="font-mono">src/test/fixtures/eval-corpus.json</code> into the
                database corpus. Press after that file changes in git.
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
  );
}
