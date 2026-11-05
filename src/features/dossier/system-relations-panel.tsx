import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  isRelationActive,
  lineage,
  RELATION_KINDS,
  relationProblem,
  resolveRelations,
} from "@/entities/drone/system-hierarchy";
import type { Drone, RelationKind, SystemClass } from "@/entities/drone/types";
import { useServices } from "@/shared/infra/use-services";
import { Btn, EmptyNote, Panel, Tag } from "@/shared/ui/primitives";
import { SystemChip } from "@/shared/ui/links";
import { Input, Select } from "@/shared/ui/fields";
import { RELATION_LABEL, STORED_KIND_HINT, SYSTEM_CLASS_LABEL } from "@/shared/ui/relation-labels";

/**
 * Every relation of an entry, read the one way the catalogue reads them (system-hierarchy.ts):
 * what it is a variant of, what is derived from it, its subsystems and effectors, what carries
 * it, its counterparts. Suggested relations wait here for the analyst; a link the analyst makes
 * or removes is one of the stored kinds, from the entry that depends on the other.
 */

/** The entry's place in its family, top first: [Geran] → Geran-3. */
export function FamilyBreadcrumb({ drone, catalog }: { drone: Drone; catalog: readonly Drone[] }) {
  const chain = useMemo(() => lineage(drone, catalog).reverse(), [drone, catalog]);
  if (!chain.length && !drone.systemClass) return null;
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      {drone.systemClass && <Tag mono>{SYSTEM_CLASS_LABEL[drone.systemClass]}</Tag>}
      {chain.map((d) => (
        <span key={d.id} className="inline-flex items-center gap-1.5">
          <Link to="/systems/$id" params={{ id: d.id }} className="hover:text-primary">
            {d.name}
          </Link>
          <span aria-hidden>→</span>
        </span>
      ))}
      {chain.length > 0 && <span className="text-foreground">{drone.name}</span>}
    </p>
  );
}

export function SystemRelationsPanel({
  drone,
  catalog,
}: {
  drone: Drone;
  catalog: readonly Drone[];
}) {
  const svc = useServices();
  const [busy, setBusy] = useState(false);
  const [targetName, setTargetName] = useState("");
  const [kind, setKind] = useState<RelationKind>("variant_of");
  const edges = useMemo(() => resolveRelations(drone, catalog), [drone, catalog]);
  const pending = (drone.relations ?? []).filter(
    (r) => !r.review && !isRelationActive(r) && r.status === "candidate",
  );
  const byId = useMemo(() => new Map(catalog.map((d) => [d.id, d])), [catalog]);
  const target = useMemo(
    () => catalog.find((d) => d.name.toLowerCase() === targetName.trim().toLowerCase()),
    [catalog, targetName],
  );
  const problem = target ? relationProblem(drone, target, kind, catalog) : undefined;

  const run = (what: () => unknown, done: string) => {
    setBusy(true);
    try {
      if (what() === undefined)
        toast.error("Nothing changed: refused, or the entry changed meanwhile.");
      else toast.success(done);
    } finally {
      setBusy(false);
    }
  };

  const groups = useMemo(() => {
    const by = new Map<string, typeof edges>();
    for (const e of edges) by.set(e.displayKind, [...(by.get(e.displayKind) ?? []), e]);
    return [...by.entries()];
  }, [edges]);

  return (
    <Panel id="variants" title="Relations" className="scroll-mt-28">
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Kind of system</span>
          <Select
            size="sm"
            aria-label="Kind of system"
            value={drone.systemClass ?? ""}
            disabled={busy}
            onChange={(e) =>
              run(
                () =>
                  svc.catalog.setSystemClass(
                    drone.id,
                    (e.target.value || null) as SystemClass | null,
                  ),
                "Kind of system saved",
              )
            }
          >
            <option value="">Not set</option>
            {(Object.keys(SYSTEM_CLASS_LABEL) as SystemClass[]).map((c) => (
              <option key={c} value={c}>
                {SYSTEM_CLASS_LABEL[c]}
              </option>
            ))}
          </Select>
        </div>

        {groups.length ? (
          groups.map(([display, list]) => (
            <div key={display}>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {RELATION_LABEL[display as keyof typeof RELATION_LABEL].many}
              </p>
              <ul className="mt-1 space-y-1">
                {list.map((e) => (
                  <li
                    key={`${display}-${e.target.id}`}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <SystemChip id={e.target.id} name={e.target.name} />
                    {e.kind === "counterpart_to" && (
                      <Link
                        to="/counterparts"
                        search={{ a: drone.id, b: e.target.id }}
                        className="text-xs text-primary hover:underline"
                      >
                        compare →
                      </Link>
                    )}
                    {e.claim?.role && (
                      <span className="text-xs text-muted-foreground">{e.claim.role}</span>
                    )}
                    <Btn
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        run(() => svc.catalog.unlinkSystems(drone.id, e.target.id), "Unlinked")
                      }
                    >
                      Unlink
                    </Btn>
                  </li>
                ))}
              </ul>
            </div>
          ))
        ) : (
          <EmptyNote>No relations recorded.</EmptyNote>
        )}

        {pending.length > 0 && (
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Suggested by reports
            </p>
            <ul className="mt-1 space-y-2">
              {pending.map((r) => {
                const t = byId.get(r.targetSystemId);
                return (
                  <li key={r.id} className="space-y-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="text-muted-foreground">{RELATION_LABEL[r.kind].one}</span>
                      {t ? <SystemChip id={t.id} name={t.name} /> : <span>{r.targetSystemId}</span>}
                      <Btn
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          run(
                            () => svc.catalog.reviewRelation(drone.id, r.id, "confirmed"),
                            "Confirmed",
                          )
                        }
                      >
                        Confirm
                      </Btn>
                      <Btn
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          run(
                            () => svc.catalog.reviewRelation(drone.id, r.id, "rejected"),
                            "Turned down",
                          )
                        }
                      >
                        Reject
                      </Btn>
                    </p>
                    {r.evidence && (
                      <p className="text-xs italic text-muted-foreground">“{r.evidence}”</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <form
          className="space-y-2 border-t border-border pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!target || problem) return;
            run(() => svc.catalog.linkSystems(drone.id, target.id, kind), "Linked");
            setTargetName("");
          }}
        >
          <p className="text-xs text-muted-foreground">
            Link from this entry: {drone.name} is <em>{STORED_KIND_HINT[kind]}</em>.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              size="sm"
              aria-label="Relation"
              value={kind}
              onChange={(e) => setKind(e.target.value as RelationKind)}
            >
              {RELATION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {RELATION_LABEL[k].one}
                </option>
              ))}
            </Select>
            <Input
              aria-label="System"
              list="relation-targets"
              className="min-w-0 flex-1 text-xs"
              placeholder="System name"
              value={targetName}
              onChange={(e) => setTargetName(e.target.value)}
            />
            <datalist id="relation-targets">
              {catalog
                .filter((d) => d.id !== drone.id)
                .map((d) => (
                  <option key={d.id} value={d.name} />
                ))}
            </datalist>
            <Btn size="sm" type="submit" disabled={busy || !target || !!problem}>
              Link
            </Btn>
          </div>
          {problem && <p className="text-xs text-destructive">{problem}</p>}
        </form>
      </div>
    </Panel>
  );
}
