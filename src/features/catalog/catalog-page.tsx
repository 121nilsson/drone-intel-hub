import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef, useState } from "react";
import { consensus } from "@/entities/drone/consensus";
import { DOMAINS, flag, type Domain, type Drone } from "@/entities/drone/types";
import { ieeeLabel } from "@/entities/normalization/bands";
import { effectiveInstallationId, effectivePropulsionId } from "@/entities/normalization/taxonomy";
import { effectiveIeeeBands, linkIsFiber } from "@/entities/normalization/rf";
import { useDrones, useServices } from "@/shared/infra/services";
import { fetchWikipediaReference } from "@/shared/infra/wikipedia.functions";
import type { CatalogFacets } from "@/shared/contracts/repository";
import { Btn, Tag } from "@/shared/ui/primitives";
import { cn } from "@/lib/utils";
import { mergeDrones } from "@/features/intake/pipeline";
import { applyReference } from "@/features/catalog/reference-import";

function Facet({
  label,
  options,
  value,
  onChange,
  render,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  render?: (o: string) => string;
}) {
  return (
    <div>
      <p className="mb-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value.includes(o);
          return (
            <button
              key={o}
              onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
              className={cn(
                "border px-2 py-0.5 font-mono text-xs",
                on
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {render ? render(o) : o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CatalogPage() {
  const drones = useDrones();
  const svc = useServices();
  const { drones: repo } = svc;
  const [q, setQ] = useState("");
  const [f, setF] = useState<Required<CatalogFacets>>({
    domains: [],
    origin: [],
    operators: [],
    bands: [],
    propulsion: [],
    ieeeBands: [],
    natoBands: [],
    propulsionIds: [],
    installationIds: [],
    protocols: [],
    fiberOnly: false,
  });
  const [showFilters, setShowFilters] = useState(false);
  const [mergeTargets, setMergeTargets] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);
  const importingRef = useRef(false);
  const fetchReference = useServerFn(fetchWikipediaReference);
  const opts = useMemo(
    () => ({
      origin: [...new Set(drones.map((d) => d.origin))],
      operators: [...new Set(drones.flatMap((d) => d.operators))],
      bands: [...new Set(drones.flatMap((d) => d.rf.map((r) => r.band)))],
      propulsion: [...new Set(drones.map((d) => d.propulsion))],
      ieee: [...new Set(drones.flatMap((d) => d.rf.flatMap((r) => effectiveIeeeBands(r))))],
      families: [
        ...new Set(
          drones.flatMap((d) => {
            const id = effectivePropulsionId(d);
            return id ? [id] : [];
          }),
        ),
      ],
      installations: [
        ...new Set(
          drones.flatMap((d) => {
            const id = effectiveInstallationId(d);
            return id ? [id] : [];
          }),
        ),
      ],
    }),
    [drones],
  );
  const results = useMemo(() => repo.search(q, f), [repo, q, f, drones]);

  async function importReference() {
    if (importingRef.current) return;
    importingRef.current = true;
    setImporting(true);
    setImportNote(null);
    try {
      const res = await fetchReference();
      if (!res.ok) {
        setImportNote(res.error);
        return;
      }
      const report = applyReference(repo.list(), res.cards);
      for (const drone of report.changed) repo.upsert(drone);
      const skipped = report.skipped + res.skipped;
      const tail = res.truncated ? ", truncated" : "";
      setImportNote(
        `created ${report.created}, enriched ${report.enriched}, linked ${report.linked}, skipped ${skipped}${tail}`,
      );
    } catch (e) {
      setImportNote(e instanceof Error ? e.message : "Reference import failed");
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  }
  const duplicates = useMemo(() => {
    const byKey = new Map<string, Drone[]>();
    for (const d of drones) {
      // Group by canonical normalized name
      const key = d.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\u0400-\u04ff]+/g, "-");
      const arr = byKey.get(key) || [];
      arr.push(d);
      byKey.set(key, arr);
    }
    return Array.from(byKey.entries())
      .filter(([_, group]) => group.length > 1)
      .map(([key, group]) => ({
        key,
        name: group[0]?.name ?? key,
        drones: group,
        ids: group.map((g) => g.id),
      }));
  }, [drones]);

  const activeFilters =
    Object.values(f).reduce((n, v) => n + (Array.isArray(v) ? v.length : v ? 1 : 0), 0);

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr] lg:gap-6">
      <button
        type="button"
        onClick={() => setShowFilters((v) => !v)}
        className="flex items-center justify-between border border-border bg-card px-3 py-2.5 font-mono text-xs uppercase tracking-wider lg:hidden"
      >
        <span>Filters{activeFilters ? ` · ${activeFilters} active` : ""}</span>
        <span className="text-primary">{showFilters ? "Hide" : "Show"}</span>
      </button>
      <aside
        className={cn(
          "space-y-5 border border-border bg-card/80 p-4",
          !showFilters && "hidden lg:block",
        )}
      >
        <Facet
          label="Domain"
          options={DOMAINS}
          value={f.domains}
          onChange={(v) => setF({ ...f, domains: v as Domain[] })}
        />
        <Facet
          label="Country of origin"
          options={opts.origin}
          value={f.origin}
          onChange={(v) => setF({ ...f, origin: v })}
          render={flag}
        />
        <Facet
          label="Battlefield operator"
          options={opts.operators}
          value={f.operators}
          onChange={(v) => setF({ ...f, operators: v })}
          render={flag}
        />
        <Facet
          label="RF band"
          options={opts.bands}
          value={f.bands}
          onChange={(v) => setF({ ...f, bands: v })}
        />
        <Facet
          label="IEEE band"
          options={opts.ieee}
          value={f.ieeeBands}
          onChange={(v) => setF({ ...f, ieeeBands: v })}
          render={(o) => ieeeLabel(o)}
        />
        <Facet
          label="Propulsion"
          options={opts.propulsion}
          value={f.propulsion}
          onChange={(v) => setF({ ...f, propulsion: v })}
        />
        <Facet
          label="Propulsion family"
          options={opts.families}
          value={f.propulsionIds}
          onChange={(v) => setF({ ...f, propulsionIds: v })}
        />
        <Facet
          label="Installation"
          options={opts.installations}
          value={f.installationIds}
          onChange={(v) => setF({ ...f, installationIds: v })}
        />
        <button
          type="button"
          onClick={() => setF({ ...f, fiberOnly: !f.fiberOnly })}
          className={cn(
            "border px-2 py-0.5 font-mono text-xs",
            f.fiberOnly
              ? "border-primary bg-primary/15 text-primary"
              : "border-border text-muted-foreground",
          )}
        >
          Fiber link
        </button>
        {duplicates.length > 0 && (
          <div className="border-t border-border pt-4">
            <p className="mb-2 font-mono text-[11px] uppercase tracking-widest text-accent">
              Duplicate Systems ({duplicates.length})
            </p>
            <div className="space-y-3">
              {duplicates.map((dup) => {
                const target = mergeTargets[dup.key] || dup.ids[0] || "";
                return (
                  <div
                    key={dup.key}
                    className="border border-border/80 bg-background/50 p-2.5 text-xs"
                  >
                    <p className="font-semibold text-foreground">{dup.name}</p>
                    <div className="my-1.5 flex flex-wrap gap-1">
                      {dup.drones.map((d) => (
                        <Link
                          key={d.id}
                          to="/systems/$id"
                          params={{ id: d.id }}
                          className="font-mono text-[11px] text-primary hover:underline"
                        >
                          {d.id}
                        </Link>
                      ))}
                    </div>
                    <div className="mt-2 space-y-1.5">
                      <select
                        value={target}
                        onChange={(e) =>
                          setMergeTargets((prev) => ({ ...prev, [dup.key]: e.target.value }))
                        }
                        className="w-full border border-border bg-background px-2 py-1 font-mono text-xs outline-none focus:border-primary"
                        aria-label="Keep system"
                      >
                        {dup.drones.map((d) => (
                          <option key={d.id} value={d.id}>
                            Keep: {d.name} ({d.id})
                          </option>
                        ))}
                      </select>
                      <Btn
                        variant="ghost"
                        className="w-full justify-center text-xs"
                        disabled={!target || dup.ids.length < 2}
                        onClick={() => {
                          const toMerge = dup.ids.filter((x) => x !== target);
                          for (const m of toMerge) {
                            mergeDrones(target, m, { drones: repo, candidates: svc.candidates });
                          }
                          setMergeTargets((prev) => {
                            const next = { ...prev };
                            delete next[dup.key];
                            return next;
                          });
                        }}
                      >
                        Merge {dup.ids.length - 1} into keep
                      </Btn>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </aside>
      <div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search Geran, Герань, Shahed, Kometa, NVIDIA…"
          className="w-full border border-border bg-card px-3 py-2.5 font-mono text-sm outline-none focus:border-primary"
        />
        <div className="my-3 flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-xs text-muted-foreground">{results.length} systems</p>
          <Btn
            type="button"
            variant="ghost"
            disabled={importing}
            onClick={() => void importReference()}
          >
            {importing ? "Importing…" : "Import reference catalog"}
          </Btn>
        </div>
        {importNote && <p className="mb-3 font-mono text-xs text-muted-foreground">{importNote}</p>}
        <div className="grid gap-3 md:grid-cols-2">
          {results.map((d) => {
            const top = d.specs
              .filter((x) => x.key !== "unit_cost")
              .slice(0, 2)
              .map((x) => `${x.label} ${consensus(x).display}`);
            const cp = d.counterpartIds.map((id) => drones.find((x) => x.id === id)).find(Boolean);
            return (
              <div
                key={d.id}
                className="flex flex-col border border-border bg-card/80 transition-colors hover:border-primary"
              >
                <Link to="/systems/$id" params={{ id: d.id }} className="block flex-1 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold">
                        <span className="mr-1.5 font-mono text-xs text-muted-foreground">
                          {flag(d.origin)}
                        </span>
                        {d.name}
                      </h3>
                      <p className="truncate text-sm text-muted-foreground">
                        {[d.cyrillic, ...d.aliases].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <Tag tone="primary">{d.domain}</Tag>
                  </div>
                  {top.length > 0 && (
                    <p className="mt-2 font-mono text-xs text-foreground/80">{top.join(" · ")}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {d.operators.map((o) => (
                      <Tag key={o} tone="accent">
                        Op {flag(o)}
                      </Tag>
                    ))}
                    {d.rf.slice(0, 3).map((r, i) => (
                      <Tag key={i}>
                        {linkIsFiber(r)
                          ? "fiber"
                          : r.freqMHz
                            ? `${r.role} ${r.freqMHz[0]}–${r.freqMHz[1]}`
                            : r.band}
                      </Tag>
                    ))}
                  </div>
                </Link>
                {cp && (
                  <Link
                    to="/counterparts"
                    search={{ a: d.id, b: cp.id }}
                    className="border-t border-border px-4 py-2.5 font-mono text-xs uppercase text-muted-foreground hover:text-primary"
                  >
                    Compare vs {cp.name} →
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
