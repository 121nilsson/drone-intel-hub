import { useMemo, useState } from "react";
import { toast } from "sonner";
import { familyProposals, type FamilyProposal } from "@/entities/drone/family-audit";
import { useDrones, useServices, useAttached } from "@/shared/infra/use-services";
import { Btn, EmptyNote, ListRow, PageTitle, Panel, Tag } from "@/shared/ui/primitives";
import { SystemChip } from "@/shared/ui/links";

/**
 * The catalogue's families, as proposals for the analyst (entities/drone/family-audit.ts): which
 * entries are families, which are their variants, which names are filed in the wrong place, and
 * which entries are one family under two spellings. Nothing is applied until a person decides -
 * identity is the high-risk tier of the autonomy plan - and a proposal turned down is recorded,
 * so it is not made again.
 */

const GROUPS: Array<{ kind: FamilyProposal["kind"]; title: string; says: string }> = [
  {
    kind: "merge",
    title: "One family under two entries",
    says: "Merging keeps every claim of both; reports of either name land on one entry.",
  },
  {
    kind: "family_class",
    title: "Families",
    says: 'A family is an umbrella: generic reports ("Gerans") belong to it, its variants point at it.',
  },
  {
    kind: "variant_link",
    title: "Variants not yet linked",
    says: "Each is numbered after another entry. Linking files it under that entry without merging their figures.",
  },
  {
    kind: "alias_conflict",
    title: "Names filed in the wrong place",
    says: "An alias decides which entry a report lands on. Removing it here stops that entry from drawing the other's reports.",
  },
];

export function FamiliesPage() {
  const svc = useServices();
  const attached = useAttached();
  const drones = useDrones();
  const [busy, setBusy] = useState(false);
  const proposals = useMemo(() => familyProposals(drones), [drones]);
  const byId = useMemo(() => new Map(drones.map((d) => [d.id, d])), [drones]);
  const chip = (id: string) => {
    const d = byId.get(id);
    return d ? <SystemChip id={d.id} name={d.name} /> : <span>{id}</span>;
  };

  const act = (what: () => unknown, done: string) => {
    setBusy(true);
    try {
      const r = what();
      if (r === undefined) toast.error("Nothing changed: the entry may have changed meanwhile.");
      else toast.success(done);
    } finally {
      setBusy(false);
    }
  };

  const row = (p: FamilyProposal) => {
    const c = svc.catalog;
    switch (p.kind) {
      case "family_class":
        return (
          <ListRow
            key={p.id}
            stack
            title={
              <p className="flex flex-wrap items-center gap-2">{chip(p.droneId)} is a family</p>
            }
            subtitle={p.reason}
            actions={
              <>
                <Btn
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    act(() => c.setSystemClass(p.droneId, "family"), "Marked as a family")
                  }
                >
                  Mark as family
                </Btn>
                <Btn
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    act(() => c.setSystemClass(p.droneId, "platform"), "Kept as a platform")
                  }
                >
                  Not a family
                </Btn>
              </>
            }
          />
        );
      case "variant_link":
        return (
          <ListRow
            key={p.id}
            stack
            title={
              <p className="flex flex-wrap items-center gap-2">
                {chip(p.sourceId)} is a variant of {chip(p.targetId)}
              </p>
            }
            subtitle={p.reason}
            actions={
              <>
                <Btn
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    act(
                      () => c.linkSystems(p.sourceId, p.targetId, "variant_of"),
                      "Linked as a variant",
                    )
                  }
                >
                  Link
                </Btn>
                <Btn
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    act(
                      () => c.declineRelation(p.sourceId, p.targetId, "variant_of"),
                      "Turned down",
                    )
                  }
                >
                  Not a variant
                </Btn>
              </>
            }
          />
        );
      case "alias_conflict":
        return (
          <ListRow
            key={p.id}
            stack
            title={
              <p className="flex flex-wrap items-center gap-2">
                <Tag mono>{p.alias}</Tag> on {chip(p.droneId)}
              </p>
            }
            subtitle={p.reason}
            actions={
              <>
                <Btn
                  size="sm"
                  variant="danger"
                  disabled={busy}
                  onClick={() =>
                    act(() => c.reviewAlias(p.droneId, p.aliasClaimId, "rejected"), "Alias removed")
                  }
                >
                  Remove alias here
                </Btn>
                <Btn
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    act(() => c.reviewAlias(p.droneId, p.aliasClaimId, "confirmed"), "Alias kept")
                  }
                >
                  Keep it
                </Btn>
              </>
            }
          />
        );
      case "merge":
        return (
          <ListRow
            key={p.id}
            stack
            title={
              <p className="flex flex-wrap items-center gap-2">
                Merge {chip(p.mergeId)} into {chip(p.keepId)}
              </p>
            }
            subtitle={p.reason}
            actions={
              <>
                <Btn
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    act(() => c.merge(p.keepId, p.mergeId, "family audit: same family"), "Merged")
                  }
                >
                  Merge
                </Btn>
                <Btn
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => act(() => c.markDistinct(p.keepId, p.mergeId), "Kept apart")}
                >
                  Different systems
                </Btn>
              </>
            }
          />
        );
    }
  };

  return (
    <div className="space-y-6">
      <PageTitle subtitle="Which entries are families, which are their variants, and which names are filed in the wrong place. Proposals only: nothing changes until you decide, and a proposal you turn down is not made again.">
        Families
      </PageTitle>
      {!attached ? null : proposals.length === 0 ? (
        <EmptyNote>
          Nothing to review: every family, variant and name is where it belongs.
        </EmptyNote>
      ) : (
        GROUPS.map((g) => {
          const items = proposals.filter((p) => p.kind === g.kind);
          if (!items.length) return null;
          return (
            <Panel key={g.kind} title={g.title} right={<Tag mono>{items.length}</Tag>}>
              <p className="mb-3 text-xs text-muted-foreground">{g.says}</p>
              <ul className="divide-y divide-border">{items.map(row)}</ul>
            </Panel>
          );
        })
      )}
    </div>
  );
}
