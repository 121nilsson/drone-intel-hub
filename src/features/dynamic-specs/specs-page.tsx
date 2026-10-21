import { useState } from "react";
import { toast } from "sonner";
import { useDrones, useServices } from "@/shared/infra/services";
import { Btn, ListRow, Loading, Panel, PageTitle, Tag } from "@/shared/ui/primitives";
import { allSpecKeys } from "@/entities/drone/spec-engine";

export function SpecsPage() {
  const drones = useDrones();
  const svc = useServices();
  const { drones: repo } = svc;
  const keys = allSpecKeys(drones);
  const [editing, setEditing] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  // Drop rewrites every system carrying the key, so it is a two-step action per key.
  const [confirmingDrop, setConfirmingDrop] = useState<string | null>(null);

  const rename = (key: string) => {
    const apply = (d: Parameters<typeof repo.upsert>[0]) => ({
      ...d,
      specs: d.specs.map((s) => (s.key === key ? { ...s, label } : s)),
    });
    drones.forEach((d) => {
      if (d.specs.some((s) => s.key === key)) repo.upsert(apply(d), apply);
    });
    setEditing(null);
    toast("Attribute renamed", { description: `${key} → ${label}` });
  };
  const remove = (key: string) => {
    const apply = (d: Parameters<typeof repo.upsert>[0]) => ({
      ...d,
      specs: d.specs.filter((s) => s.key !== key),
    });
    drones.forEach((d) => {
      if (d.specs.some((s) => s.key === key)) repo.upsert(apply(d), apply);
    });
    setConfirmingDrop(null);
    toast("Attribute dropped", { description: key });
  };

  // Until the store attaches, the panel would read "0 attributes" before showing real ones.
  if (!svc.attached) return <Loading label="Loading attributes…" />;

  return (
    <div className="space-y-6">
      <PageTitle subtitle="Schema-less attributes across the catalog. New keys discovered by AI appear here instantly.">
        Dynamic spec engine
      </PageTitle>
      <Panel title={`${keys.length} attributes`}>
        {keys.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No attributes recorded yet. Ingest reports and any new key the extractor finds will
            appear here.
          </p>
        )}
        <ul className="divide-y divide-border">
          {keys.map((k) => (
            <ListRow
              key={k.key}
              title={
                editing === k.key ? (
                  <input
                    autoFocus
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    aria-label={`Display label for ${k.key}`}
                    className="w-full border border-border bg-background px-2 py-1 text-sm"
                  />
                ) : (
                  <span className="font-medium">{k.label}</span>
                )
              }
              subtitle={<code>{k.key}</code>}
              meta={
                <>
                  <Tag tone={k.discoveredBy === "ai" ? "accent" : "default"}>{k.discoveredBy}</Tag>
                  <span className="font-mono text-xs text-muted-foreground">{k.count} systems</span>
                </>
              }
              actions={
                <>
                  {editing === k.key ? (
                    <Btn onClick={() => rename(k.key)}>Save</Btn>
                  ) : (
                    <Btn
                      variant="ghost"
                      onClick={() => {
                        setEditing(k.key);
                        setLabel(k.label);
                      }}
                    >
                      Rename
                    </Btn>
                  )}
                  {k.discoveredBy !== "seed" &&
                    (confirmingDrop === k.key ? (
                      <span className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-muted-foreground">
                          Remove from {k.count} system{k.count === 1 ? "" : "s"}?
                        </span>
                        <Btn variant="danger" onClick={() => remove(k.key)}>
                          Confirm drop
                        </Btn>
                        <Btn variant="ghost" onClick={() => setConfirmingDrop(null)}>
                          Cancel
                        </Btn>
                      </span>
                    ) : (
                      <Btn variant="danger" onClick={() => setConfirmingDrop(k.key)}>
                        Drop
                      </Btn>
                    ))}
                </>
              }
            />
          ))}
        </ul>
      </Panel>
    </div>
  );
}
