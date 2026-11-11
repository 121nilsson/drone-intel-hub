import { useMemo } from "react";
import {
  verificationByPromptVersion,
  type PromptVerificationRow,
} from "@/entities/drone/verification-coverage";
import { useAttached, useDrones } from "@/shared/infra/use-services";
import { DataTable, type Column } from "@/shared/ui/data-table";
import { pct } from "@/shared/ui/format";
import { Loading, Panel, Tag } from "@/shared/ui/primitives";

/**
 * How the verifier judged the claims each prompt version produced. A prompt change is judged here
 * by what the verifier later said about its claims, so the shares are over every claim the version
 * produced, not only the checked ones.
 */

const share = (n: number, total: number) => (total === 0 ? "—" : pct(n / total));

const columns: readonly Column<PromptVerificationRow>[] = [
  {
    id: "promptVersion",
    header: "Prompt version",
    cell: (r) => <span className="font-mono">{r.promptVersion}</span>,
  },
  { id: "claims", header: "Claims", cell: (r) => r.total, align: "right", className: "font-mono" },
  {
    id: "verified",
    header: "Verified",
    cell: (r) => share(r.verified, r.total),
    align: "right",
    className: "font-mono",
  },
  {
    id: "uncertain",
    header: "Uncertain",
    cell: (r) => share(r.uncertain, r.total),
    align: "right",
    className: "font-mono",
  },
  {
    id: "rejected",
    header: "Rejected",
    cell: (r) => share(r.rejected, r.total),
    align: "right",
    className: "font-mono",
  },
];

export function PromptVersionPanel() {
  const drones = useDrones();
  const attached = useAttached();
  const rows = useMemo(() => verificationByPromptVersion(drones), [drones]);

  return (
    <Panel title="Verified share by prompt version" right={<Tag mono>{rows.length}</Tag>}>
      <p className="text-xs text-muted-foreground">
        Shares are over every machine-extracted claim a version produced, checked or not. Claims
        written before lineage was recorded appear as &quot;unknown&quot;.
      </p>
      <div className="mt-3">
        {!attached ? (
          <Loading />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No machine-extracted claims yet.</p>
        ) : (
          <DataTable
            bare
            label="Verified share by prompt version"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.promptVersion}
          />
        )}
      </div>
    </Panel>
  );
}
