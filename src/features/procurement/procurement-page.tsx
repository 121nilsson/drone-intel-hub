import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import type { Procurement } from "@/entities/procurement/types";
import { byNewestContract } from "@/entities/procurement/match";
import { procurementSystemRefs } from "@/entities/procurement/presentation";
import { groupSameDeal, isUnknown } from "@/entities/procurement/same-deal";
import type { Drone } from "@/entities/drone/types";
import { useDrones, useServices } from "@/shared/infra/services";
import { useProcurements } from "@/shared/infra/use-procurements";
import { ContractRow } from "@/shared/ui/contracts";
import { CountryBadge } from "@/shared/ui/country-badge";
import { DataTable, type Column } from "@/shared/ui/data-table";
import { SearchInput } from "@/shared/ui/fields";
import { ActiveFilters, FacetGroup, FilterLayout, type ActiveFilter } from "@/shared/ui/filters";
import { SourceRef, SystemChip } from "@/shared/ui/links";
import { useRememberedSearch } from "@/shared/ui/remembered";
import { TimeAgo } from "@/shared/ui/time-ago";
import { Btn, EmptyState, Loading, PageTitle, Tag } from "@/shared/ui/primitives";
import {
  filterProcurements,
  fromProcurementSearchParams,
  procurementFacets,
  toProcurementSearchParams,
  type ProcurementState,
} from "./procurement-state";

/** A field the report did not state, shown quietly so the stated ones stand out. */
const Unstated = ({ children }: { children: string }) => (
  <span className="italic text-muted-foreground/70">{children}</span>
);

function columns(drones: Drone[], reports: ReadonlyMap<string, number>): Column<Procurement>[] {
  return [
    {
      id: "company",
      header: "Company",
      width: "24%",
      cell: (c) => (
        <>
          <p className="break-words font-medium">
            {isUnknown(c.company) ? <Unstated>Company not stated</Unstated> : c.company}
          </p>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
            {c.country ? <CountryBadge code={c.country} /> : <Unstated>Country unknown</Unstated>}
          </p>
          {(reports.get(c.id) ?? 1) > 1 && (
            <Tag className="mt-1" title="The same report and figure were read more than once">
              {reports.get(c.id)} reads
            </Tag>
          )}
          {c.notes && (
            <p
              className="mt-1 line-clamp-3 break-words text-xs text-muted-foreground"
              title={c.notes}
            >
              {c.notes}
            </p>
          )}
        </>
      ),
    },
    {
      id: "buyer",
      header: "Buyer / programme",
      width: "15%",
      cell: (c) => (
        <>
          <p className="break-words">
            {isUnknown(c.customer) ? <Unstated>Buyer not stated</Unstated> : c.customer}
          </p>
          {c.program && (
            <p className="mt-0.5 break-words text-xs text-muted-foreground">{c.program}</p>
          )}
        </>
      ),
    },
    {
      id: "amount",
      header: "Amount",
      width: "13%",
      className: "font-mono text-primary",
      cell: (c) => (
        <>
          {c.amount ?? "—"}
          {c.currency && <Tag className="ml-1.5 align-middle">{c.currency}</Tag>}
        </>
      ),
    },
    {
      id: "announced",
      header: "Announced",
      width: "10%",
      className: "whitespace-nowrap font-mono text-xs text-muted-foreground",
      cell: (c) => <TimeAgo iso={c.announcedAt ?? c.createdAt} />,
    },
    {
      id: "systems",
      header: "Systems",
      width: "22%",
      cell: (c) => {
        const systems = procurementSystemRefs(c, drones);
        if (!systems.length) return <span className="text-muted-foreground">—</span>;
        return (
          <div className="flex min-w-0 flex-wrap gap-1">
            {systems.map((system, i) =>
              system.id ? (
                <SystemChip key={`${system.id}-${i}`} id={system.id} name={system.name} />
              ) : (
                <Tag key={`${system.name}-${i}`} caps={false} mono={false}>
                  {system.name}
                </Tag>
              ),
            )}
          </div>
        );
      },
    },
    {
      id: "source",
      header: "Source",
      width: "16%",
      cell: (c) => <SourceRef source={c.source} href={c.sourceUrl} className="max-w-full" />,
    },
  ];
}

export function ProcurementPage({
  url,
  setUrl,
}: {
  url: Record<string, string>;
  setUrl: (next: Record<string, string>) => void;
}) {
  const procurements = useProcurements();
  const drones = useDrones();
  const svc = useServices();
  useRememberedSearch("procurement", url, setUrl);
  const state = useMemo(() => fromProcurementSearchParams(url), [url]);
  const facets = useMemo(() => procurementFacets(procurements), [procurements]);
  const rows = useMemo(
    () => filterProcurements(procurements, state).sort(byNewestContract),
    [procurements, state],
  );
  // One row per deal: the same report and figure read twice is one contract, counted.
  const deals = useMemo(() => groupSameDeal(rows), [rows]);
  const reads = useMemo(() => new Map(deals.map((d) => [d.contract.id, d.reports])), [deals]);
  const cols = useMemo(() => columns(drones, reads), [drones, reads]);

  const setState = (next: ProcurementState) => setUrl(toProcurementSearchParams(next));
  const toggle = (key: "countries" | "currencies" | "buyers", value: string) => {
    const values = state[key];
    setState({
      ...state,
      [key]: values.includes(value) ? values.filter((v) => v !== value) : [...values, value],
    });
  };
  // Clearing filters keeps the search text: the box shows it, and it is cleared from there.
  const clearFilters = () =>
    setState({ q: state.q, countries: [], currencies: [], buyers: [], system: "" });
  const systemName = state.system
    ? (drones.find((d) => d.id === state.system)?.name ?? state.system)
    : "";
  const active: ActiveFilter[] = [
    ...(state.system
      ? [
          {
            id: "system",
            label: `System: ${systemName}`,
            text: `system ${systemName}`,
            clear: () => setState({ ...state, system: "" }),
          },
        ]
      : []),
    ...state.countries.map((v) => ({
      id: `country-${v}`,
      label: <CountryBadge code={v} />,
      text: v,
      clear: () => toggle("countries", v),
    })),
    ...state.currencies.map((v) => ({
      id: `currency-${v}`,
      label: v,
      text: v,
      clear: () => toggle("currencies", v),
    })),
    ...state.buyers.map((v) => ({
      id: `buyer-${v}`,
      label: v,
      text: v,
      clear: () => toggle("buyers", v),
    })),
  ];

  if (!svc.attached) return <Loading label="Loading contracts…" />;
  return (
    <div className="space-y-4">
      <PageTitle subtitle="Contracts, grants and production deals routed out of system specs.">
        Procurement
      </PageTitle>
      <FilterLayout
        activeCount={active.length}
        onClear={clearFilters}
        resultLabel={`Show ${deals.length} deal${deals.length === 1 ? "" : "s"}`}
        filters={
          <>
            <FacetGroup
              label="Supplier country"
              options={facets.countries}
              value={state.countries}
              onToggle={(v) => toggle("countries", v)}
              render={(v) => <CountryBadge code={v} />}
            />
            <FacetGroup
              label="Currency"
              options={facets.currencies}
              value={state.currencies}
              onToggle={(v) => toggle("currencies", v)}
            />
            <FacetGroup
              label="Buyer"
              options={facets.buyers}
              value={state.buyers}
              onToggle={(v) => toggle("buyers", v)}
              limit={8}
            />
          </>
        }
      >
        <SearchInput
          label="Search contracts"
          value={state.q}
          onChange={(q) => setState({ ...state, q })}
          placeholder="Company, buyer, programme, system, amount…"
        />
        <ActiveFilters filters={active} onClearAll={clearFilters} />
        <p className="font-mono text-xs text-muted-foreground" role="status">
          {deals.length} deal{deals.length === 1 ? "" : "s"}
          {deals.length !== rows.length && ` from ${rows.length} records`}
          {rows.length !== procurements.length && ` · ${procurements.length} in total`}
        </p>
        {!rows.length ? (
          procurements.length ? (
            <EmptyState
              action={
                <Btn
                  variant="link"
                  onClick={() =>
                    setState({ q: "", countries: [], currencies: [], buyers: [], system: "" })
                  }
                >
                  Clear search and filters
                </Btn>
              }
            >
              No contracts match this view.
            </EmptyState>
          ) : (
            <EmptyState
              action={
                <Link to="/sources" className="text-primary hover:underline">
                  Go to sources
                </Link>
              }
            >
              No procurement records yet. Contracts are extracted when a post carries a contract,
              grant or production deal; run a source sync to populate them.
            </EmptyState>
          )
        ) : (
          <DataTable
            label="Contracts"
            columns={cols}
            rows={deals.map((d) => d.contract)}
            rowKey={(c) => c.id}
            minWidth="960px"
            testId="procurement-table"
            cardTestId="procurement-cards"
            card={(c) => <ContractRow contract={c} drones={drones} showNotes />}
          />
        )}
      </FilterLayout>
    </div>
  );
}
