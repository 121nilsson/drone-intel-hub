import { useState } from "react";
import { toast } from "sonner";
import { useDrones, useServices } from "@/shared/infra/services";
import { Btn, Loading, Panel, Tag } from "@/shared/ui/primitives";
import { allSpecKeys } from "./spec-engine";

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
    drones.forEach((d) => {
      if (d.specs.some((s) => s.key === key))
        repo.upsert({ ...d, specs: d.specs.map((s) => (s.key === key ? { ...s, label } : s)) });
    });
    setEditing(null);
    toast("Attribute renamed", { description: `${key} → ${label}` });
  };
  const remove = (key: string) => {
    drones.forEach((d) => {
      if (d.specs.some((s) => s.key === key))
        repo.upsert({ ...d, specs: d.specs.filter((s) => s.key !== key) });
    });
    setConfirmingDrop(null);
    toast("Attribute dropped", { description: key });
  };

  // Until the store attaches, the panel would read "0 attributes" before showing real ones.
  if (!svc.attached) return <Loading label="Loading attributes…" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Dynamic spec engine</h1>
        <p className="mt-1 text-muted-foreground">
          Schema-less attributes across the catalog. New keys discovered by AI appear here
          instantly.
        </p>
      </div>
      <Panel title={`${keys.length} attributes`}>
        {keys.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No attributes recorded yet. Ingest reports and any new key the extractor finds will
            appear here.
          </p>
        )}
        <ul className="divide-y divide-border">
          {keys.map((k) => (
            <li key={k.key} className="flex flex-wrap items-center gap-3 py-2.5">
              <code className="w-36 text-xs text-muted-foreground">{k.key}</code>
              {editing === k.key ? (
                <input
                  autoFocus
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  aria-label={`Display label for ${k.key}`}
                  className="flex-1 border border-border bg-background px-2 py-1 text-sm"
                />
              ) : (
                <span className="flex-1">{k.label}</span>
              )}
              <Tag tone={k.discoveredBy === "ai" ? "accent" : "default"}>{k.discoveredBy}</Tag>
              <span className="font-mono text-xs text-muted-foreground">{k.count} systems</span>
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
                  <span className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">
                      Remove this attribute from {k.count} system{k.count === 1 ? "" : "s"}?
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
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
