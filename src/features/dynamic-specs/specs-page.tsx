import { useState } from "react";
import { useDrones, useServices } from "@/shared/infra/services";
import { Btn, Panel, Tag } from "@/shared/ui/primitives";
import { allSpecKeys } from "./spec-engine";

export function SpecsPage() {
  const drones = useDrones();
  const { drones: repo } = useServices();
  const keys = allSpecKeys(drones);
  const [editing, setEditing] = useState<string | null>(null);
  const [label, setLabel] = useState("");

  const rename = (key: string) => {
    drones.forEach((d) => {
      if (d.specs.some((s) => s.key === key))
        repo.upsert({ ...d, specs: d.specs.map((s) => (s.key === key ? { ...s, label } : s)) });
    });
    setEditing(null);
  };
  const remove = (key: string) =>
    drones.forEach((d) => {
      if (d.specs.some((s) => s.key === key))
        repo.upsert({ ...d, specs: d.specs.filter((s) => s.key !== key) });
    });

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
        <ul className="divide-y divide-border">
          {keys.map((k) => (
            <li key={k.key} className="flex flex-wrap items-center gap-3 py-2.5">
              <code className="w-36 text-xs text-muted-foreground">{k.key}</code>
              {editing === k.key ? (
                <input
                  autoFocus
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
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
              {k.discoveredBy !== "seed" && (
                <Btn variant="danger" onClick={() => remove(k.key)}>
                  Drop
                </Btn>
              )}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
