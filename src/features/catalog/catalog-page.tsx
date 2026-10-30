import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useMemo, useRef, useState } from "react";
import { consensus } from "@/entities/drone/consensus";
import { groupSpecs, headlineSpec } from "@/entities/drone/spec-groups";
import { DOMAINS, type Domain, type Drone } from "@/entities/drone/types";
import { CountryBadge } from "@/shared/ui/country-badge";
import { ieeeLabel } from "@/entities/normalization/bands";
import { effectiveInstallationId, effectivePropulsionId } from "@/entities/normalization/taxonomy";
import { effectiveIeeeBands, linkIsFiber } from "@/entities/normalization/rf";
import { useDispatches, useDrones, useServices } from "@/shared/infra/services";
import { fetchWikipediaReference } from "@/shared/infra/wikipedia/functions";
import { DataTable, type Column } from "@/shared/ui/data-table";
import { useRememberedChoice, useRememberedSearch } from "@/shared/ui/remembered";
import { TimeAgo } from "@/shared/ui/time-ago";
import { byFrequency } from "@/shared/ui/facets";
import { SearchInput, Select } from "@/shared/ui/fields";
import {
  ActiveFilters,
  FacetGroup,
  FilterChip,
  FilterLayout,
  type ActiveFilter,
} from "@/shared/ui/filters";
import {
  Btn,
  Callout,
  Card,
  CardGrid,
  EmptyState,
  Eyebrow,
  Loading,
  PageTitle,
  Segmented,
  Sparkline,
  Tag,
} from "@/shared/ui/primitives";
import { duplicateGroups } from "@/entities/drone/duplicates";
import { applyReference } from "@/features/catalog/reference-import";
import { DuplicatesPanel } from "@/features/catalog/duplicates-panel";
import { useRelatedIntel, RelatedChips } from "@/shared/ui/intel-graph";
import {
  DEFAULT_SORT,
  emptyFacets,
  fromSearchParams,
  toCatalogSearch,
  type CatalogState,
  type CatalogSort,
} from "@/features/catalog/catalog-state";

function CatalogCard({ d, cp }: { d: Drone; cp: Drone | undefined }) {
  // The two best-known figures, never a price or a programme number.
  const top = groupSpecs(d.specs)
    .filter((g) => g.id !== "cost" && g.id !== "other")
    .flatMap((g) => g.specs)
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

/** The system's defining figure as "Label: consensus" - reach, speed or payload, never a deal. */
function headline(d: Drone): string {
  const spec = headlineSpec(d.specs);
  return spec ? `${spec.label}: ${consensus(spec).display}` : "—";
}

function SystemName({ d, series }: { d: Drone; series: number[] | undefined }) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
      <Link to="/systems/$id" params={{ id: d.id }} className="font-semibold hover:text-primary">
        {d.name}
      </Link>
      {d.cyrillic && <span className="font-mono text-xs text-muted-foreground">{d.cyrillic}</span>}
      {series?.some((v) => v > 0) && (
        <span title="Reports over the last 7 days">
          <Sparkline values={series} />
        </span>
      )}
    </span>
  );
}

const VIEWS = ["compact", "cards"] as const;

type Facets = CatalogState["facets"];
type ListFacet = Exclude<keyof Facets, "fiberOnly">;

/** Removable chips for every facet in force, labelled the way the sidebar shows them. */
function activeFilters(f: Facets, setF: (next: Facets) => void): ActiveFilter[] {
  const out: ActiveFilter[] = [];
  const list = (
    key: ListFacet,
    label: (v: string) => ActiveFilter["label"],
    text: (v: string) => string = (v) => v,
  ) => {
    const values: string[] = f[key];
    for (const v of values)
      out.push({
        id: `${key}-${v}`,
        label: label(v),
        text: text(v),
        clear: () => setF({ ...f, [key]: values.filter((x) => x !== v) }),
      });
  };
  list("domains", (v) => v);
  list("origin", (v) => <CountryBadge code={v} />);
  list(
    "operators",
    (v) => (
      <>
        Op <CountryBadge code={v} />
      </>
    ),
    (v) => `operator ${v}`,
  );
  list("bands", (v) => v);
  list("ieeeBands", (v) => ieeeLabel(v));
  list("natoBands", (v) => v);
  list("propulsion", (v) => v);
  list("propulsionIds", (v) => v);
  list("installationIds", (v) => v);
  list("protocols", (v) => v);
  if (f.fiberOnly)
    out.push({
      id: "fiber",
      label: "Fiber link",
      text: "fiber link",
      clear: () => setF({ ...f, fiberOnly: false }),
    });
  return out;
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
  // (the duplicate panel, import notes, the view switch) stay local.
  useRememberedSearch("catalog", url, setUrl);
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
  const clearFacets = () => setF(emptyFacets());
  const clearAll = () =>
    setUrl(toCatalogSearch({ q: "", sort: DEFAULT_SORT, facets: emptyFacets() }));
  const [view, setView] = useRememberedChoice("catalog-view", "compact", VIEWS);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);
  const importingRef = useRef(false);
  const fetchReference = useServerFn(fetchWikipediaReference);
  // Most frequent first: facet groups show their first options until opened.
  const opts = useMemo(
    () => ({
      origin: byFrequency(drones.map((d) => d.origin)),
      operators: byFrequency(drones.flatMap((d) => d.operators)),
      bands: byFrequency(drones.flatMap((d) => d.rf.map((r) => r.band))),
      propulsion: byFrequency(drones.map((d) => d.propulsion)),
      ieee: byFrequency(drones.flatMap((d) => d.rf.flatMap((r) => effectiveIeeeBands(r)))),
      families: byFrequency(drones.map((d) => effectivePropulsionId(d))),
      installations: byFrequency(drones.map((d) => effectiveInstallationId(d))),
    }),
    [drones],
  );
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
  // The newest report naming each system: what "recent" means to an analyst. updatedAt moves on
  // every re-analysis, so after a bulk pass every row showed the same day.
  const lastReport = useMemo(() => {
    const last = new Map<string, string>();
    for (const d of dispatches) {
      const at = d.publishedAt ?? d.createdAt;
      for (const id of d.droneIds ?? []) if (at > (last.get(id) ?? "")) last.set(id, at);
    }
    return last;
  }, [dispatches]);
  const results = useMemo(() => repo.search(q, f), [repo, q, f]);
  const sorted = useMemo(() => {
    const list = [...results];
    if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "updated") list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    else if (sort === "reported")
      list.sort((a, b) => (lastReport.get(b.id) ?? "").localeCompare(lastReport.get(a.id) ?? ""));
    else list.sort((a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name));
    return list;
  }, [results, sort, lastReport]);
  const active = useMemo(() => activeFilters(f, setF), [f, setF]);

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

  const columns = useMemo<Column<Drone>[]>(
    () => [
      {
        id: "system",
        header: "System",
        cell: (d) => <SystemName d={d} series={reportSeries.get(d.id)} />,
      },
      {
        id: "origin",
        header: "Origin",
        width: "6rem",
        cell: (d) => <CountryBadge code={d.origin} />,
      },
      {
        id: "domain",
        header: "Domain",
        width: "6rem",
        className: "font-mono text-xs",
        cell: (d) => d.domain,
      },
      {
        id: "headline",
        header: "Headline figure",
        width: "36%",
        className: "font-mono text-xs [overflow-wrap:anywhere]",
        cell: headline,
      },
      {
        id: "updated",
        header: "Last report",
        width: "7.5rem",
        className: "whitespace-nowrap font-mono text-xs text-muted-foreground",
        cell: (d) => <TimeAgo iso={lastReport.get(d.id)} />,
      },
    ],
    [reportSeries, lastReport],
  );

  // The repositories fill asynchronously after SSR; until then every list reads empty, which
  // would read as a legitimately empty catalog. Hold a loading state instead.
  if (!svc.attached) return <Loading label="Loading catalog…" />;

  const toggleIn = (key: ListFacet) => (v: string) => {
    const values: string[] = f[key];
    setF({ ...f, [key]: values.includes(v) ? values.filter((x) => x !== v) : [...values, v] });
  };

  return (
    <div className="space-y-4">
      <PageTitle subtitle="Search and filter catalogued unmanned systems, RF links, and merge duplicates.">
        Systems catalog
      </PageTitle>
      <FilterLayout
        activeCount={active.length}
        onClear={clearFacets}
        resultLabel={`Show ${sorted.length} system${sorted.length === 1 ? "" : "s"}`}
        filters={
          <>
            <FacetGroup
              label="Domain"
              options={DOMAINS}
              value={f.domains}
              onToggle={(v) => toggleIn("domains")(v as Domain)}
            />
            <FacetGroup
              label="Country of origin"
              options={opts.origin}
              value={f.origin}
              onToggle={toggleIn("origin")}
              render={(o) => <CountryBadge code={o} />}
            />
            <FacetGroup
              label="Battlefield operator"
              options={opts.operators}
              value={f.operators}
              onToggle={toggleIn("operators")}
              render={(o) => <CountryBadge code={o} />}
            />
            <FacetGroup
              label="RF band"
              options={opts.bands}
              value={f.bands}
              onToggle={toggleIn("bands")}
            />
            <FacetGroup
              label="IEEE band"
              options={opts.ieee}
              value={f.ieeeBands}
              onToggle={toggleIn("ieeeBands")}
              render={(o) => ieeeLabel(o)}
              searchText={(o) => ieeeLabel(o)}
            />
            <FacetGroup
              label="Propulsion"
              options={opts.propulsion}
              value={f.propulsion}
              onToggle={toggleIn("propulsion")}
            />
            <FacetGroup
              label="Propulsion family"
              options={opts.families}
              value={f.propulsionIds}
              onToggle={toggleIn("propulsionIds")}
            />
            <FacetGroup
              label="Installation"
              options={opts.installations}
              value={f.installationIds}
              onToggle={toggleIn("installationIds")}
            />
            <div>
              <Eyebrow className="mb-2">Link</Eyebrow>
              <FilterChip
                pressed={f.fiberOnly}
                onClick={() => setF({ ...f, fiberOnly: !f.fiberOnly })}
              >
                Fiber link
              </FilterChip>
            </div>
          </>
        }
      >
        {duplicates.length > 0 && (
          <Callout
            title={`${duplicates.length} possible duplicate group${duplicates.length === 1 ? "" : "s"}`}
            action={showDuplicates ? "Hide" : "Review"}
            expanded={showDuplicates}
            onClick={() => setShowDuplicates((v) => !v)}
          >
            Review and merge them into single catalog entries
          </Callout>
        )}
        {showDuplicates && duplicates.length > 0 && <DuplicatesPanel groups={duplicates} />}
        <SearchInput
          label="Search systems"
          value={q}
          onChange={setQ}
          placeholder="Search Geran, Герань, Shahed, Kometa, NVIDIA…"
        />
        <ActiveFilters filters={active} onClearAll={clearFacets} />
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto font-mono text-xs text-muted-foreground" role="status">
            {sorted.length} systems
          </p>
          <Select
            size="sm"
            value={sort}
            onChange={(e) => setSort(e.target.value as CatalogSort)}
            aria-label="Sort systems"
          >
            <option value="name">Sort: name</option>
            <option value="updated">Sort: recently updated</option>
            <option value="reported">Sort: latest report</option>
            <option value="domain">Sort: domain</option>
          </Select>
          <Segmented
            label="Catalog view"
            value={view}
            onChange={setView}
            options={[
              { value: "compact", label: "Compact" },
              { value: "cards", label: "Cards" },
            ]}
          />
        </div>
        {sorted.length === 0 ? (
          drones.length ? (
            <EmptyState
              action={
                <Btn variant="link" onClick={clearAll}>
                  Clear search and filters
                </Btn>
              }
            >
              No systems match the current search and filters.
            </EmptyState>
          ) : (
            <EmptyState>
              No systems catalogued yet. Ingest a report from the{" "}
              <Link to="/intake" className="text-primary underline">
                intake queue
              </Link>{" "}
              or import the reference catalog below.
            </EmptyState>
          )
        ) : view === "compact" ? (
          <DataTable
            label="Systems"
            columns={columns}
            rows={sorted}
            rowKey={(d) => d.id}
            card={(d) => (
              <div className="space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <SystemName d={d} series={reportSeries.get(d.id)} />
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {d.domain}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground">
                  <CountryBadge code={d.origin} />
                  {headlineSpec(d.specs) && (
                    <span className="text-foreground/80">{headline(d)}</span>
                  )}
                </div>
              </div>
            )}
          />
        ) : (
          <CardGrid>
            {sorted.map((d) => {
              const cp = d.counterpartIds
                .map((id) => drones.find((x) => x.id === id))
                .find(Boolean);
              return <CatalogCard key={d.id} d={d} cp={cp} />;
            })}
          </CardGrid>
        )}
        {/* Reference imports are occasional maintenance, so they sit under the list. */}
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <Btn
            size="sm"
            variant="ghost"
            disabled={importing}
            onClick={() => void importReference()}
          >
            {importing ? "Importing…" : "Import reference catalog"}
          </Btn>
          <Btn
            size="sm"
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
          {importNote && (
            <p className="w-full font-mono text-xs text-muted-foreground" role="status">
              {importNote}
            </p>
          )}
        </div>
      </FilterLayout>
    </div>
  );
}
