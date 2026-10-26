import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useDrones, useServices } from "@/shared/infra/services";
import { Btn, Loading, Panel, PageTitle, Tag } from "@/shared/ui/primitives";
import { allSpecKeys, type SpecKeySummary } from "@/entities/drone/spec-engine";
import { cn } from "@/lib/utils";

type SortKey = "label" | "key" | "value" | "count" | "source" | "discoveredBy";
type SortDir = "asc" | "desc";

export function SpecsPage() {
  const drones = useDrones();
  const svc = useServices();
  const { drones: repo } = svc;
  const keys = useMemo(() => allSpecKeys(drones), [drones]);
  const [editing, setEditing] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  // Drop rewrites every system carrying the key, so it is a two-step action per key.
  const [confirmingDrop, setConfirmingDrop] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("count");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [query, setQuery] = useState("");

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? keys.filter(
          (k) =>
            k.label.toLowerCase().includes(q) ||
            k.key.toLowerCase().includes(q) ||
            k.value.toLowerCase().includes(q) ||
            k.source.toLowerCase().includes(q),
        )
      : keys;
    const num = (v: string) => {
      const m = v.match(/-?\d+(\.\d+)?/);
      return m ? parseFloat(m[0]) : NaN;
    };
    return [...base].sort((a, b) => {
      let r = 0;
      if (sortKey === "label") r = a.label.localeCompare(b.label);
      else if (sortKey === "key") r = a.key.localeCompare(b.key);
      else if (sortKey === "value") {
        const an = num(a.value);
        const bn = num(b.value);
        if (Number.isFinite(an) && Number.isFinite(bn)) r = an - bn;
        else r = a.value.localeCompare(b.value);
      } else if (sortKey === "count") r = a.count - b.count;
      else if (sortKey === "source") r = a.source.localeCompare(b.source);
      else if (sortKey === "discoveredBy") r = a.discoveredBy.localeCompare(b.discoveredBy);
      return sortDir === "asc" ? r : -r;
    });
  }, [keys, query, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "count" ? "desc" : "asc");
    }
  };

  const ariaSort = (k: SortKey) =>
    sortKey === k ? (sortDir === "asc" ? "ascending" : "descending") : "none";

  // Until the store attaches, the panel would read "0 attributes" before showing real ones.
  if (!svc.attached) return <Loading label="Loading attributes…" />;

  const headerBtn = (label: string, k: SortKey, align: "left" | "right" = "left") => (
    <th
      aria-sort={ariaSort(k)}
      className={cn(
        "px-3 py-2 font-normal whitespace-nowrap",
        align === "right" && "text-right",
        sortKey === k && "text-primary",
      )}
    >
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className={cn(
          "inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-widest hover:text-primary",
          align === "right" && "ml-auto",
        )}
      >
        {label}
        {sortKey === k && <span aria-hidden>{sortDir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );

  return (
    <div className="space-y-6">
      <PageTitle subtitle="Schema-less attributes across the catalog. New keys discovered by AI appear here instantly. Sort any column to spot correlations or near-duplicate names.">
        Dynamic spec engine
      </PageTitle>
      <Panel
        title={`${keys.length} attributes${filtered.length !== keys.length ? ` · ${filtered.length} shown` : ""}`}
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name, value or source…"
            className="w-full max-w-sm border border-border bg-background px-3 py-1.5 font-mono text-sm focus:border-primary"
            aria-label="Filter attributes"
          />
        </div>
        {keys.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No attributes recorded yet. Ingest reports and any new key the extractor finds will
            appear here.
          </p>
        )}
        {filtered.length > 0 && (
          <div className="overflow-x-auto border border-border">
            {/* Fixed layout + the colgroup budget below keep every column usable; text-heavy
                cells truncate with a tooltip instead of pushing Source off the screen. */}
            <table className="w-full min-w-[1100px] table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-[19%]" />
                <col className="w-[16%]" />
                <col className="w-[15%]" />
                <col className="w-[7%]" />
                <col className="w-[18%]" />
                <col className="w-[9%]" />
                <col className="w-[16%]" />
              </colgroup>
              <thead>
                <tr className="text-left font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                  {headerBtn("Label", "label")}
                  {headerBtn("Key", "key")}
                  {headerBtn("Value", "value")}
                  {headerBtn("Systems", "count", "right")}
                  {headerBtn("Source", "source")}
                  {headerBtn("Origin", "discoveredBy")}
                  <th className="px-3 py-2 text-right font-normal font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((k) => (
                  <tr key={k.key} className="border-t border-border hover:bg-secondary/40">
                    <td className="px-3 py-2 align-middle">
                      {editing === k.key ? (
                        <input
                          autoFocus
                          value={label}
                          onChange={(e) => setLabel(e.target.value)}
                          aria-label={`Display label for ${k.key}`}
                          className="w-full border border-border bg-background px-2 py-1 text-sm"
                        />
                      ) : (
                        <div className="truncate font-medium" title={k.label}>
                          {k.label}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <div
                        className="truncate font-mono text-xs text-muted-foreground"
                        title={k.key}
                      >
                        {k.key}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-middle font-mono text-xs">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span
                          className={cn(
                            "min-w-0 truncate",
                            k.disputed ? "text-accent" : "text-foreground/90",
                          )}
                          title={k.value}
                        >
                          {k.value}
                        </span>
                        {k.disputed && <Tag tone="danger">disputed</Tag>}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right align-middle font-mono text-xs text-muted-foreground">
                      {k.count}
                    </td>
                    <td className="px-3 py-2 align-middle font-mono text-xs text-muted-foreground">
                      <div
                        className="truncate"
                        title={k.sources > 1 ? `${k.source} · ${k.sources} sources` : k.source}
                      >
                        {k.source}
                        {k.sources > 1 && (
                          <span className="text-muted-foreground/70"> · {k.sources} sources</span>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 align-middle">
                      <Tag
                        tone={k.discoveredBy === "ai" ? "accent" : "default"}
                        title={
                          k.discoveredBy === "seed"
                            ? "Seeded from the reference catalog"
                            : k.discoveredBy === "ai"
                              ? "Discovered by the extractor"
                              : "Named by an analyst"
                        }
                      >
                        {k.discoveredBy}
                      </Tag>
                    </td>
                    <td className="px-3 py-2 text-right align-middle">
                      <div className="flex items-center justify-end gap-1.5">
                        {editing === k.key ? (
                          <Btn className="px-2 py-0.5" onClick={() => rename(k.key)}>
                            Save
                          </Btn>
                        ) : (
                          confirmingDrop !== k.key && (
                            <Btn
                              variant="ghost"
                              className="px-2 py-0.5"
                              onClick={() => {
                                setEditing(k.key);
                                setLabel(k.label);
                              }}
                            >
                              Rename
                            </Btn>
                          )
                        )}
                        {k.discoveredBy !== "seed" &&
                          (confirmingDrop === k.key ? (
                            <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                              <span title={`Removes the attribute from ${k.count} systems`}>
                                Drop from {k.count}?
                              </span>
                              <Btn
                                variant="danger"
                                className="px-2 py-0.5"
                                onClick={() => remove(k.key)}
                              >
                                Yes
                              </Btn>
                              <Btn
                                variant="ghost"
                                className="px-2 py-0.5"
                                onClick={() => setConfirmingDrop(null)}
                              >
                                No
                              </Btn>
                            </span>
                          ) : (
                            <Btn
                              variant="danger"
                              className="px-2 py-0.5"
                              onClick={() => setConfirmingDrop(k.key)}
                            >
                              Drop
                            </Btn>
                          ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {keys.length > 0 && filtered.length === 0 && (
          <p className="text-sm text-muted-foreground">No attributes match the filter.</p>
        )}
      </Panel>
    </div>
  );
}
