import { Panel, Tag } from "@/shared/ui/primitives";
import type { EvalReport } from "@/shared/infra/evaluation/evaluation";
import { Coverage } from "./evaluation-kpi";

export function ReferenceCoveragePanel({ report }: { report: EvalReport }) {
  return (
    <Panel title="Reference coverage">
      <div className="flex flex-wrap gap-1.5">
        <Coverage c={report.reference} />
        <Tag tone="success" mono>
          verified {report.reference.verified}
        </Tag>
        <Tag tone="danger" mono>
          rejected {report.reference.rejected}
        </Tag>
        <Tag tone="info" mono>
          analyst {report.reference.analyst}
        </Tag>
        <Tag tone="muted" mono>
          unverified {report.reference.unverified}
        </Tag>
        {report.reference.dropped > 0 && (
          <Tag tone="muted" mono>
            ai-dropped {report.reference.dropped}
          </Tag>
        )}
        {report.reference.uncertain > 0 && (
          <Tag tone="warning" mono>
            uncertain, left out {report.reference.uncertain}
          </Tag>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Scores are measured against verified catalogue claims. A claim the verifier could not decide
        is left out of every score, and a claim nobody has judged still falls back to the stored AI
        reading — so a score on low coverage is weak evidence, not a regression.
      </p>
    </Panel>
  );
}
