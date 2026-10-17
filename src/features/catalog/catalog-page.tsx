import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { consensus } from "@/entities/drone/consensus";
import { DOMAINS, type Domain, type Drone } from "@/entities/drone/types";
import { CountryBadge } from "@/shared/ui/country-badge";
import { ieeeLabel } from "@/entities/normalization/bands";
import { effectiveInstallationId, effectivePropulsionId } from "@/entities/normalization/taxonomy";
import { effectiveIeeeBands, linkIsFiber } from "@/entities/normalization/rf";
import { useDispatches, useDrones, useServices } from "@/shared/infra/services";
import { fetchWikipediaReference } from "@/shared/infra/wikipedia/functions";
import { Btn, Card, CardGrid, Loading, Panel, Sparkline, Tag } from "@/shared/ui/primitives";
import { cn } from "@/lib/utils";
import { mergeDrones } from "@/features/intake/pipeline";
import { duplicateGroups } from "@/entities/drone/duplicates";
import { applyReference } from "@/features/catalog/reference-import";
import { useRelatedIntel, RelatedChips } from "@/features/intel-graph";
import {
  DEFAULT_SORT,
  emptyFacets,
  fromSearchParams,
  toCatalogSearch,
  type CatalogSort,
} from "@/features/catalog/catalog-state";

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
  render?: (o: string) => ReactNode;
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
              type="button"
              aria-pressed={on}
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

function CatalogCard({ d, drones, cp }: { d: Drone; drones: Drone[]; cp: Drone | undefined }) {
  const top = d.specs
    .filter((x) => x.key !== "unit_cost")
    .slice(0, 2)
    .map((x) => `${x.label} ${consensus(x).display}`);
  const relatedIntel = useRelatedIntel(d.id);
  return (
    <Card interactive>
      <Link to="/systems/$id" params={{ id: d.id }} className="block min-w-0 flex-1 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="break-words font-semibold">
              <span className="mr-1.5 text-xs text-muted-foreground">
                <CountryBadge code={d.origin} />
              </span>
              {d.name}
            </h3>
            <p className="truncate text-sm text-muted-foreground">
              {[d.cyrillic, ...d.aliases].filter(Boolean).join(" · ")}
            </p>
          </div>
          <Tag tone="primary" className="shrink-0">
            {d.domain}
          </Tag>
        </div>
        {top.length > 0 && (
          <p className="mt-2 break-words font-mono text-xs text-foreground/80">{top.join(" · ")}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {d.operators.map((o) => (
            <Tag key={o} tone="accent" caps={false} mono={false}>
              Op <CountryBadge code={o} />
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
        {relatedIntel && relatedIntel.edges.length > 0 && (
          <div className="mt-2">
            <RelatedChips edges={relatedIntel.edges} maxChips={3} />
          </div>
        )}
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
    </Card>
  );
}

export function CatalogPage({
  url,
  setUrl,
}: {
  url: Record<string, string>;
  setUrl: (next: Record<string, string>) => void;
}) {
  const drones = useDrones();
  const dispatches = useDispatches();
  const svc = useServices();
  const { drones: repo } = svc;
  // Search, sort and facets are URL state: the URL is the single truth, changes navigate with a
  // replace so a shared or refreshed link always restores the exact view. Session-only bits
  // (merge targets, confirmation state, import notes, the mobile filter drawer) stay local.
  const state = useMemo(() => fromSearchParams(url), [url]);
  const f = state.facets;
  const { q, sort } = state;
  // Navigation is replace-only: a filter click is not a page the analyst wants in history.
  const setQ = useCallback(
    (next: string) => setUrl(toCatalogSearch({ ...state, q: next })),
    [setUrl, state],
  );
  const setSort = useCallback(
    (next: CatalogSort) => setUrl(toCatalogSearch({ ...state, sort: next })),
    [setUrl, state],
  );
  const setF = useCallback(
    (next: typeof f) => setUrl(toCatalogSearch({ ...state, facets: next })),
    [setUrl, state],
  );
  const clearAll = () =>
    setUrl(toCatalogSearch({ q: "", sort: DEFAULT_SORT, facets: emptyFacets() }));
  const [showFilters, setShowFilters] = useState(false);
  const [view, setView] = useState<"compact" | "cards">("compact");
  const [mergeTargets, setMergeTargets] = useState<Record<string, string>>({});
  const [confirmingMerge, setConfirmingMerge] = useState<string | null>(null);
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
  const results = useMemo(() => repo.search(q, f), [repo, q, f]);
  const sorted = useMemo(() => {
    const list = [...results];
    if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "updated") list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    else list.sort((a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name));
    return list;
  }, [results, sort]);

  const filterChips = useMemo(() => {
    const chips: { id: string; label: string; clear: () => void }[] = [];
    for (const d of f.domains)
      chips.push({
        id: `domain-${d}`,
        label: d,
        clear: () => setF({ ...f, domains: f.domains.filter((x) => x !== d) }),
      });
    for (const o of f.origin)
      chips.push({
        id: `origin-${o}`,
        label: o,
        clear: () => setF({ ...f, origin: f.origin.filter((x) => x !== o) }),
      });
    for (const o of f.operators)
      chips.push({
        id: `op-${o}`,
        label: `Op ${o}`,
        clear: () => setF({ ...f, operators: f.operators.filter((x) => x !== o) }),
      });
    for (const b of f.bands)
      chips.push({
        id: `band-${b}`,
        label: b,
        clear: () => setF({ ...f, bands: f.bands.filter((x) => x !== b) }),
      });
    for (const b of f.ieeeBands)
      chips.push({
        id: `ieee-${b}`,
        label: ieeeLabel(b),
        clear: () => setF({ ...f, ieeeBands: f.ieeeBands.filter((x) => x !== b) }),
      });
    for (const p of f.propulsion)
      chips.push({
        id: `prop-${p}`,
        label: p,
        clear: () => setF({ ...f, propulsion: f.propulsion.filter((x) => x !== p) }),
      });
    for (const id of f.propulsionIds)
      chips.push({
        id: `pfam-${id}`,
        label: id,
        clear: () => setF({ ...f, propulsionIds: f.propulsionIds.filter((x) => x !== id) }),
      });
    for (const id of f.installationIds)
      chips.push({
        id: `inst-${id}`,
        label: id,
        clear: () => setF({ ...f, installationIds: f.installationIds.filter((x) => x !== id) }),
      });
    for (const p of f.protocols)
      chips.push({
        id: `proto-${p}`,
        label: p,
        clear: () => setF({ ...f, protocols: f.protocols.filter((x) => x !== p) }),
      });
    if (f.fiberOnly)
      chips.push({
        id: "fiber",
        label: "Fiber link",
        clear: () => setF({ ...f, fiberOnly: false }),
      });
    return chips;
  }, [f, setF]);

  function focusDuplicates() {
    setShowFilters(true);
    requestAnimationFrame(() =>
      document.getElementById("catalog-duplicates")?.scrollIntoView({ behavior: "smooth" }),
    );
  }

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
        `created ${report.created}, enriched ${report.enriched}, linked ${report.linked}, skipped ${skipped}, spec figures ${report.specClaims}${tail}`,
      );
    } catch (e) {
      setImportNote(e instanceof Error ? e.message : "Reference import failed");
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  }
  // Same name in another spelling, a name that is another entry's alias, or one Wikidata item.
  const duplicates = useMemo(() => duplicateGroups(drones), [drones]);

  // 7-day report frequency per system, derived from dispatch provenance.
  const reportSeries = useMemo(() => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const series = new Map<string, number[]>();
    for (const d of dispatches) {
      const ids = d.droneIds ?? [];
      if (!ids.length) continue;
      const ts = Date.parse(d.processedAt ?? d.publishedAt ?? d.createdAt);
      if (!Number.isFinite(ts)) continue;
      const ageDays = Math.floor((now - ts) / dayMs);
      if (ageDays < 0 || ageDays >= 7) continue;
      for (const id of ids) {
        const arr = series.get(id) ?? Array.from({ length: 7 }, () => 0);
        arr[6 - ageDays] = (arr[6 - ageDays] ?? 0) + 1;
        series.set(id, arr);
      }
    }
    return series;
  }, [dispatches]);

  // The repositories fill asynchronously after SSR; until then every list reads empty, which
  // would read as a legitimately empty catalog. Hold a loading state instead.
  if (!svc.attached) return <Loading label="Loading catalog…" />;

  const activeFilters = Object.values(f).reduce(
    (n, v) => n + (Array.isArray(v) ? v.length : v ? 1 : 0),
    0,
  );

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-6">
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
          render={(o) => <CountryBadge code={o} />}
        />
        <Facet
          label="Battlefield operator"
          options={opts.operators}
          value={f.operators}
          onChange={(v) => setF({ ...f, operators: v })}
          render={(o) => <CountryBadge code={o} />}
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
          aria-pressed={f.fiberOnly}
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
          <div id="catalog-duplicates" className="border-t border-border pt-4 scroll-mt-24">
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
                    <p className="text-muted-foreground">{dup.reasons.join("; ")}</p>
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
                        className="w-full border border-border bg-background px-2 py-1 font-mono text-xs"
                        aria-label="Keep system"
                      >
                        {dup.drones.map((d) => (
                          <option key={d.id} value={d.id}>
                            Keep: {d.name} ({d.id})
                          </option>
                        ))}
                      </select>
                      {confirmingMerge === dup.key ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-muted-foreground">
                            Merge {dup.ids.length - 1} into {target}?
                          </span>
                          <Btn
                            className="text-xs"
                            onClick={() => {
                              const toMerge = dup.ids.filter((x) => x !== target);
                              for (const m of toMerge) {
                                mergeDrones(target, m, {
                                  drones: repo,
                                  candidates: svc.candidates,
                                });
                              }
                              setConfirmingMerge(null);
                              setMergeTargets((prev) => {
                                const next = { ...prev };
                                delete next[dup.key];
                                return next;
                              });
                              toast("Duplicate systems merged", {
                                description: `${toMerge.length} folded into ${target}`,
                              });
                            }}
                          >
                            Confirm merge
                          </Btn>
                          <Btn variant="ghost" onClick={() => setConfirmingMerge(null)}>
                            Cancel
                          </Btn>
                        </div>
                      ) : (
                        <Btn
                          variant="ghost"
                          className="w-full justify-center text-xs"
                          disabled={!target || dup.ids.length < 2}
                          onClick={() => setConfirmingMerge(dup.key)}
                        >
                          Merge {dup.ids.length - 1} into keep
                        </Btn>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </aside>
      <div>
        <div className="mb-4">
          <h1 className="text-3xl font-semibold">Systems catalog</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Search and filter catalogued unmanned systems, RF links, and merge duplicates.
          </p>
        </div>
        {duplicates.length > 0 && (
          <button
            type="button"
            onClick={focusDuplicates}
            className="mb-3 w-full border border-accent/50 bg-accent/10 px-3 py-2.5 text-left text-sm hover:border-accent"
          >
            <span className="font-semibold text-accent">
              {duplicates.length} possible duplicate group{duplicates.length === 1 ? "" : "s"}
            </span>
            <span className="mt-0.5 block text-muted-foreground">
              Review in filters → merge into a single catalog entry
            </span>
          </button>
        )}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search Geran, Герань, Shahed, Kometa, NVIDIA…"
          className="w-full border border-border bg-card px-3 py-2.5 font-mono text-sm focus:border-primary"
        />
        {filterChips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {filterChips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={chip.clear}
                aria-label={`Remove filter: ${chip.label}`}
                className="inline-flex items-center gap-1 border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[11px] text-primary hover:bg-primary/15"
              >
                {chip.label}
                <span aria-hidden>×</span>
              </button>
            ))}
          </div>
        )}
        <div className="my-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-xs text-muted-foreground">{sorted.length} systems</p>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as CatalogSort)}
              className="border border-border bg-background px-2 py-1 font-mono text-[11px] focus:border-primary"
              aria-label="Sort systems"
            >
              <option value="name">Sort: name</option>
              <option value="updated">Sort: recently updated</option>
              <option value="domain">Sort: domain</option>
            </select>
            <div
              className="inline-flex border border-border"
              role="group"
              aria-label="Catalog view"
            >
              <button
                type="button"
                aria-pressed={view === "compact"}
                onClick={() => setView("compact")}
                className={`px-2 py-1 font-mono text-[11px] ${
                  view === "compact" ? "bg-primary/15 text-primary" : "text-muted-foreground"
                }`}
              >
                Compact
              </button>
              <button
                type="button"
                aria-pressed={view === "cards"}
                onClick={() => setView("cards")}
                className={`border-l border-border px-2 py-1 font-mono text-[11px] ${
                  view === "cards" ? "bg-primary/15 text-primary" : "text-muted-foreground"
                }`}
              >
                Cards
              </button>
            </div>
          </div>
          <Btn
            type="button"
            variant="ghost"
            disabled={importing}
            onClick={() => void importReference()}
          >
            {importing ? "Importing…" : "Import reference catalog"}
          </Btn>
          <Btn
            type="button"
            variant="ghost"
            title="Adds seeded reference systems this catalog does not have. Never re-adds one an analyst merged or deleted away."
            onClick={() => {
              const added = repo.addMissingDefaults?.() ?? 0;
              setImportNote(
                added
                  ? `Loaded ${added} missing reference ${added === 1 ? "system" : "systems"}`
                  : "No missing reference systems",
              );
            }}
          >
            Load missing
          </Btn>
        </div>
        {importNote && <p className="mb-3 font-mono text-xs text-muted-foreground">{importNote}</p>}
        {sorted.length === 0 && (
          <Panel className="mt-4">
            {drones.length ? (
              <p className="text-sm text-muted-foreground">
                No systems match the current search and filters.{" "}
                <button
                  type="button"
                  onClick={clearAll}
                  className="font-mono text-xs text-primary underline"
                >
                  Clear everything
                </button>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                No systems catalogued yet. Ingest a report from the{" "}
                <Link to="/intake" className="text-primary underline">
                  intake queue
                </Link>{" "}
                or import the reference catalog above.
              </p>
            )}
          </Panel>
        )}
        {view === "compact" ? (
          <div className="overflow-x-auto border border-border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                  <th className="px-3 py-2 font-normal">System</th>
                  <th className="px-3 py-2 font-normal">Origin</th>
                  <th className="px-3 py-2 font-normal">Domain</th>
                  <th className="px-3 py-2 font-normal">Headline figure</th>
                  <th className="px-3 py-2 font-normal">Updated</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((d) => {
                  const firstSpec = d.specs[0];
                  const firstFigure = firstSpec ? consensus(firstSpec) : null;
                  return (
                    <tr key={d.id} className="border-t border-border hover:bg-secondary/40">
                      <td className="px-3 py-2">
                        <Link
                          to="/systems/$id"
                          params={{ id: d.id }}
                          className="font-semibold hover:text-primary"
                        >
                          {d.name}
                        </Link>
                        {d.cyrillic && (
                          <span className="ml-2 font-mono text-xs text-muted-foreground">
                            {d.cyrillic}
                          </span>
                        )}
                        {(() => {
                          const s = reportSeries.get(d.id);
                          if (!s || !s.some((v) => v > 0)) return null;
                          return (
                            <span className="ml-2" title="Reports over the last 7 days">
                              <Sparkline values={s} />
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2">
                        <CountryBadge code={d.origin} />
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{d.domain}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {firstSpec ? `${firstSpec.label}: ${firstFigure?.display ?? "—"}` : "—"}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                        {d.updatedAt ? d.updatedAt.slice(0, 10) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!sorted.length && (
              <p className="px-3 py-4 text-sm text-muted-foreground">No systems match.</p>
            )}
          </div>
        ) : (
          <CardGrid>
            {sorted.map((d) => {
              const cp = d.counterpartIds
                .map((id) => drones.find((x) => x.id === id))
                .find(Boolean);
              return <CatalogCard key={d.id} d={d} drones={drones} cp={cp} />;
            })}
          </CardGrid>
        )}
      </div>
    </div>
  );
}
