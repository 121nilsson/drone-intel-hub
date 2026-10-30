import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useDrones, useServices } from "@/shared/infra/services";
import { DataTable, type Column } from "@/shared/ui/data-table";
import { Input, SearchInput } from "@/shared/ui/fields";
import { Btn, EmptyState, Loading, Panel, PageTitle, Tag } from "@/shared/ui/primitives";
import { allSpecKeys, type SpecKeySummary } from "@/entities/drone/spec-engine";

type SortKey = "label" | "key" | "value" | "count" | "source" | "discoveredBy";
type SortDir = "asc" | "desc";

const ORIGIN_TITLE: Record<string, string> = {
  seed: "Seeded from the reference catalog",
  ai: "Discovered by the extractor",
};

function OriginTag({ k }: { k: SpecKeySummary }) {
  return (
    <Tag
      tone={k.discoveredBy === "ai" ? "accent" : "default"}
      title={ORIGIN_TITLE[k.discoveredBy] ?? "Named by an analyst"}
    >
      {k.discoveredBy}
    </Tag>
  );
}

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
  const sort = (k: SortKey) => ({
    direction: sortKey === k ? sortDir : null,
    onSort: () => toggleSort(k),
  });

  // Until the store attaches, the panel would read "0 attributes" before showing real ones.
  if (!svc.attached) return <Loading label="Loading attributes…" />;

  const labelCell = (k: SpecKeySummary) =>
    editing === k.key ? (
      <Input
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") rename(k.key);
          if (e.key === "Escape") setEditing(null);
        }}
        aria-label={`Display label for ${k.key}`}
        className="px-2 py-1 font-sans"
      />
    ) : (
      <div className="truncate font-medium" title={k.label}>
        {k.label}
      </div>
    );

  // Rename stays the rightmost button on every row, and Drop sits to its left only where it
  // applies, so the column reads as one line of buttons rather than a ragged edge.
  const actions = (k: SpecKeySummary) => {
    if (editing === k.key)
      return (
        <>
          <Btn size="sm" variant="quiet" onClick={() => setEditing(null)}>
            Cancel
          </Btn>
          <Btn size="sm" onClick={() => rename(k.key)}>
            Save
          </Btn>
        </>
      );
    if (confirmingDrop === k.key)
      return (
        <>
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            Drop from {k.count}?
          </span>
          <Btn size="sm" variant="danger" onClick={() => remove(k.key)}>
            Yes
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => setConfirmingDrop(null)}>
            No
          </Btn>
        </>
      );
    return (
      <>
        {k.discoveredBy !== "seed" && (
          <Btn
            size="sm"
            variant="quiet"
            className="hover:text-destructive"
            title={`Removes the attribute from ${k.count} systems`}
            onClick={() => setConfirmingDrop(k.key)}
          >
            Drop
          </Btn>
        )}
        <Btn
          size="sm"
          variant="ghost"
          onClick={() => {
            setEditing(k.key);
            setLabel(k.label);
          }}
        >
          Rename
        </Btn>
      </>
    );
  };

  const sourceText = (k: SpecKeySummary) =>
    k.sources > 1 ? `${k.source} · ${k.sources} sources` : k.source;

  const columns: Column<SpecKeySummary>[] = [
    { id: "label", header: "Label", width: "19%", sort: sort("label"), cell: labelCell },
    {
      id: "key",
      header: "Key",
      width: "15%",
      sort: sort("key"),
      cell: (k) => (
        <div className="truncate font-mono text-xs text-muted-foreground" title={k.key}>
          {k.key}
        </div>
      ),
    },
    {
      // Every system's claims pooled: the spread across systems, which is expected to vary, so
      // it is not flagged as a dispute the way one system's conflicting sources are.
      id: "value",
      header: "Range across systems",
      width: "17%",
      sort: sort("value"),
      cell: (k) => (
        <div className="truncate font-mono text-xs" title={k.value}>
          {k.value}
        </div>
      ),
    },
    {
      id: "count",
      header: "Systems",
      width: "7%",
      align: "right",
      sort: sort("count"),
      className: "font-mono text-xs text-muted-foreground",
      cell: (k) => k.count,
    },
    {
      id: "source",
      header: "Source",
      width: "18%",
      sort: sort("source"),
      cell: (k) => (
        <div className="truncate font-mono text-xs text-muted-foreground" title={sourceText(k)}>
          {sourceText(k)}
        </div>
      ),
    },
    {
      id: "origin",
      header: "Origin",
      width: "8%",
      sort: sort("discoveredBy"),
      cell: (k) => <OriginTag k={k} />,
    },
    {
      id: "actions",
      header: "Actions",
      width: "16%",
      align: "right",
      cell: (k) => <div className="flex items-center justify-end gap-1.5">{actions(k)}</div>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageTitle subtitle="Schema-less attributes across the catalog. New keys discovered by AI appear here instantly. Sort any column to spot correlations or near-duplicate names.">
        Dynamic spec engine
      </PageTitle>
      <Panel
        title={`${keys.length} attributes${filtered.length !== keys.length ? ` · ${filtered.length} shown` : ""}`}
      >
        <SearchInput
          label="Filter attributes"
          value={query}
          onChange={setQuery}
          placeholder="Filter by name, value or source…"
          className="mb-3 max-w-sm"
        />
        {keys.length === 0 ? (
          <EmptyState>
            No attributes recorded yet. Ingest reports and any new key the extractor finds will
            appear here.
          </EmptyState>
        ) : filtered.length === 0 ? (
          <EmptyState>No attributes match the filter.</EmptyState>
        ) : (
          <DataTable
            label="Attributes"
            columns={columns}
            rows={filtered}
            rowKey={(k) => k.key}
            minWidth="1100px"
            card={(k) => (
              <div className="space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">{labelCell(k)}</div>
                  <OriginTag k={k} />
                </div>
                <p className="font-mono text-xs text-muted-foreground">
                  {k.key} · {k.count} system{k.count === 1 ? "" : "s"}
                </p>
                <p className="font-mono text-xs">{k.value}</p>
                <p className="truncate text-xs text-muted-foreground">{sourceText(k)}</p>
                <div className="flex flex-wrap items-center justify-end gap-1.5 pt-1">
                  {actions(k)}
                </div>
              </div>
            )}
          />
        )}
      </Panel>
    </div>
  );
}
