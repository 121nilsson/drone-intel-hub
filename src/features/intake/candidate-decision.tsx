import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { useDrones, useServices } from "@/shared/infra/services";
import { Input, Select } from "@/shared/ui/fields";
import { Btn } from "@/shared/ui/primitives";
import { mergeInto, promote, recordMention } from "@/shared/infra/ingest/pipeline";
import type { Candidate } from "@/entities/drone/types";

/** The analyst's controls for one candidate: promote, merge, mention or discard while pending, else the outcome. */
export function CandidateDecision({
  c,
  name,
  setName,
  target,
  setTarget,
}: {
  c: Candidate;
  name: string;
  setName: (name: string) => void;
  target: string;
  setTarget: (target: string) => void;
}) {
  const svc = useServices();
  const drones = useDrones();
  const e = c.extraction;
  const resolvedExists = !!c.resolvedInto && drones.some((x) => x.id === c.resolvedInto);

  return c.status === "pending" ? (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Input
        value={name}
        onChange={(ev) => setName(ev.target.value)}
        placeholder="System name"
        className="text-xs sm:w-48"
        aria-label="Candidate name"
      />
      <Btn
        className="px-4 py-2"
        onClick={() => {
          promote(c, svc, name);
          svc.candidates.update(c.id, { resolvedBy: "analyst" });
          toast("Candidate promoted", {
            description: `New system “${name}” added to the catalog`,
          });
        }}
        disabled={!name.trim()}
      >
        Promote
      </Btn>
      <Select
        value={target}
        onChange={(ev) => setTarget(ev.target.value)}
        className="max-w-full flex-1 text-xs sm:flex-none"
        aria-label="Merge target"
      >
        <option value="">-- Select system to merge into --</option>
        {drones.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </Select>
      <Btn
        variant="ghost"
        disabled={!target}
        onClick={() => {
          mergeInto(c, target, svc);
          svc.candidates.update(c.id, { resolvedBy: "analyst" });
          const targetName = drones.find((d) => d.id === target)?.name ?? target;
          toast("Merged into existing system", {
            description: targetName,
          });
        }}
      >
        Merge
      </Btn>
      <Btn
        variant="ghost"
        disabled={!target}
        onClick={() => {
          recordMention(c, target, svc);
        }}
      >
        Record mention
      </Btn>
      <Btn
        variant="danger"
        onClick={() => {
          // Snapshot the fields triage decisions touch so Undo can restore the exact
          // pre-discard state; optional fields are omitted rather than written as undefined.
          const prev: Partial<Candidate> = {
            status: c.status,
            ...(c.resolvedBy !== undefined ? { resolvedBy: c.resolvedBy } : {}),
            ...(c.resolvedInto !== undefined ? { resolvedInto: c.resolvedInto } : {}),
            ...(c.supersededBy !== undefined ? { supersededBy: c.supersededBy } : {}),
          };
          svc.candidates.update(c.id, { status: "discarded", resolvedBy: "analyst" });
          toast("Candidate discarded", {
            description: e.name ?? c.source,
            action: {
              label: "Undo",
              onClick: () => svc.candidates.update(c.id, prev),
            },
          });
        }}
      >
        Discard
      </Btn>
    </div>
  ) : (
    <p className="mt-3 font-mono text-xs uppercase text-muted-foreground">
      {c.status}
      {c.resolvedInto && (
        <>
          {" "}
          →{" "}
          {resolvedExists ? (
            <Link to="/systems/$id" params={{ id: c.resolvedInto }} className="text-primary">
              {c.resolvedInto}
            </Link>
          ) : (
            // The entry was deleted from its dossier; keep the history, drop the dead link.
            <span className="line-through">{c.resolvedInto} (deleted)</span>
          )}
        </>
      )}
    </p>
  );
}
