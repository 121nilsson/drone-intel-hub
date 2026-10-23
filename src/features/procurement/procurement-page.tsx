import { Link } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import type { Procurement } from "@/entities/procurement/types";
import { byNewestContract } from "@/entities/procurement/match";
import { procurementDay, procurementSystemRefs } from "@/entities/procurement/presentation";
import { useDrones, useServices } from "@/shared/infra/services";
import { useProcurements } from "@/shared/infra/use-procurements";
import { ContractRow } from "@/shared/ui/contracts";
import { CountryBadge } from "@/shared/ui/country-badge";
import { SourceRef, SystemChip } from "@/shared/ui/links";
import { Btn, Card, Loading, PageTitle, Tag } from "@/shared/ui/primitives";
import { cn } from "@/lib/utils";
import {
  filterProcurements,
  fromProcurementSearchParams,
  procurementFacets,
  toProcurementSearchParams,
  type ProcurementState,
} from "./procurement-state";

function Facet({
  label,
  options,
  value,
  onToggle,
  render,
}: {
  label: string;
  options: string[];
  value: string[];
  onToggle: (value: string) => void;
  render?: (option: string) => ReactNode;
}) {
  if (!options.length) return null;
  return (
    <div>
      <p className="mb-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const on = value.includes(option);
          return (
            <button
              key={option}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(option)}
              className={cn(
                "min-w-0 max-w-full border px-2 py-0.5 text-left font-mono text-xs",
                on
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="block truncate">{render ? render(option) : option}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex min-w-0 items-center gap-2 border border-border bg-card px-3 py-2">
      <label htmlFor="procurement-search" className="sr-only">
        Search contracts
      </label>
      <input
        id="procurement-search"
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Company, buyer, programme, system, amount…"
        className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-muted-foreground"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="shrink-0 font-mono text-xs text-muted-foreground hover:text-foreground"
          aria-label="Clear contract search"
        >
          ✕
        </button>
      )}
    </div>
  );
}

function ContractTable({ rows }: { rows: Procurement[] }) {
  const drones = useDrones();
  return (
    <div className="hidden overflow-x-auto border border-border bg-card/80 md:block">
      <table className="w-full min-w-[960px] table-fixed text-sm" data-testid="procurement-table">
        <colgroup>
          <col className="w-[24%]" />
          <col className="w-[15%]" />
          <col className="w-[13%]" />
          <col className="w-[10%]" />
          <col className="w-[22%]" />
          <col className="w-[16%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-border text-left font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2">Company</th>
            <th className="px-3 py-2">Buyer / programme</th>
            <th className="px-3 py-2">Amount</th>
            <th className="px-3 py-2">Announced</th>
            <th className="px-3 py-2">Systems</th>
            <th className="px-3 py-2">Source</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((contract) => {
            const systems = procurementSystemRefs(contract, drones);
            return (
              <tr key={contract.id} className="align-top">
                <td className="min-w-0 px-3 py-3">
                  <p className="break-words font-medium">{contract.company}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1 font-mono text-xs text-muted-foreground">
                    {contract.country ? (
                      <CountryBadge code={contract.country} />
                    ) : (
                      "Country unknown"
                    )}
                  </p>
                  {contract.notes && (
                    <p
                      className="mt-1 line-clamp-3 break-words text-xs text-muted-foreground"
                      title={contract.notes}
                    >
                      {contract.notes}
                    </p>
                  )}
                </td>
                <td className="min-w-0 px-3 py-3">
                  <p className="break-words">{contract.customer ?? "Buyer unknown"}</p>
                  {contract.program && (
                    <p className="mt-0.5 break-words text-xs text-muted-foreground">
                      {contract.program}
                    </p>
                  )}
                </td>
                <td className="px-3 py-3 font-mono text-primary">
                  {contract.amount ?? "—"}
                  {contract.currency && (
                    <Tag className="ml-1.5 align-middle">{contract.currency}</Tag>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-muted-foreground">
                  {procurementDay(contract)}
                </td>
                <td className="min-w-0 px-3 py-3">
                  <div className="flex min-w-0 flex-wrap gap-1">
                    {systems.length ? (
                      systems.map((system, i) =>
                        system.id ? (
                          <SystemChip key={`${system.id}-${i}`} id={system.id} name={system.name} />
                        ) : (
                          <Tag key={`${system.name}-${i}`} caps={false} mono={false}>
                            {system.name}
                          </Tag>
                        ),
                      )
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>
                </td>
                <td className="min-w-0 px-3 py-3">
                  <SourceRef
                    source={contract.source}
                    href={contract.sourceUrl}
                    className="max-w-full"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
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
  const state = useMemo(() => fromProcurementSearchParams(url), [url]);
  const facets = useMemo(() => procurementFacets(procurements), [procurements]);
  const rows = useMemo(
    () => filterProcurements(procurements, state).sort(byNewestContract),
    [procurements, state],
  );
  const [showFilters, setShowFilters] = useState(false);

  const setState = (next: ProcurementState) => setUrl(toProcurementSearchParams(next));
  const toggle = (key: "countries" | "currencies" | "buyers", value: string) => {
    const values = state[key];
    setState({
      ...state,
      [key]: values.includes(value) ? values.filter((v) => v !== value) : [...values, value],
    });
  };
  const activeFilters =
    state.countries.length + state.currencies.length + state.buyers.length + (state.system ? 1 : 0);
  const clearFilters = () => {
    setState({ q: "", countries: [], currencies: [], buyers: [], system: "" });
    setShowFilters(false);
  };
  const systemName = state.system
    ? (drones.find((d) => d.id === state.system)?.name ?? state.system)
    : "";

  if (!svc.attached) return <Loading label="Loading contracts…" />;
  return (
    <div className="space-y-4">
      <PageTitle subtitle="Contracts, grants and production deals routed out of system specs.">
        Procurement
      </PageTitle>
      <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside
          className={cn(
            "space-y-4 border border-border bg-card/60 p-3 lg:block",
            showFilters ? "block" : "hidden lg:block",
          )}
          aria-label="Procurement filters"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Filters
            </p>
            {activeFilters > 0 && (
              <button
                type="button"
                onClick={clearFilters}
                className="font-mono text-xs text-primary hover:underline"
              >
                Clear
              </button>
            )}
          </div>
          {state.system && (
            <div>
              <p className="mb-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                System
              </p>
              <div className="flex items-start gap-1.5">
                <Tag tone="primary" className="min-w-0">
                  <span className="truncate">{systemName}</span>
                </Tag>
                <button
                  type="button"
                  onClick={() => setState({ ...state, system: "" })}
                  className="shrink-0 font-mono text-xs text-muted-foreground hover:text-foreground"
                  aria-label="Clear system filter"
                >
                  ✕
                </button>
              </div>
            </div>
          )}
          <Facet
            label="Supplier country"
            options={facets.countries}
            value={state.countries}
            onToggle={(value) => toggle("countries", value)}
            render={(option) => <CountryBadge code={option} />}
          />
          <Facet
            label="Currency"
            options={facets.currencies}
            value={state.currencies}
            onToggle={(value) => toggle("currencies", value)}
          />
          <Facet
            label="Buyer"
            options={facets.buyers}
            value={state.buyers}
            onToggle={(value) => toggle("buyers", value)}
          />
        </aside>
        <section className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <SearchBox value={state.q} onChange={(q) => setState({ ...state, q })} />
            </div>
            <Btn
              variant="ghost"
              className="lg:hidden"
              onClick={() => setShowFilters((open) => !open)}
              aria-expanded={showFilters}
            >
              Filters{activeFilters ? ` (${activeFilters})` : ""}
            </Btn>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-xs text-muted-foreground" role="status">
              {rows.length} of {procurements.length} contract
              {procurements.length === 1 ? "" : "s"}
            </p>
            {activeFilters > 0 && (
              <p className="font-mono text-xs text-muted-foreground">
                {activeFilters} active filter{activeFilters === 1 ? "" : "s"}
              </p>
            )}
          </div>
          {!rows.length ? (
            <div className="border border-dashed border-border p-6 text-sm text-muted-foreground">
              {procurements.length ? (
                <p>
                  No contracts match this view.{" "}
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="text-primary hover:underline"
                  >
                    Clear filters
                  </button>
                </p>
              ) : (
                <p>
                  No procurement records yet. Contracts are extracted when a post carries a
                  contract, grant or production deal; run a source sync to populate them.{" "}
                  <Link to="/sources" className="text-primary hover:underline">
                    Go to sources
                  </Link>
                </p>
              )}
            </div>
          ) : (
            <>
              <ul className="space-y-2 md:hidden" data-testid="procurement-cards">
                {rows.map((contract) => (
                  <Card as="li" key={contract.id} className="p-3">
                    <ContractRow contract={contract} drones={drones} showNotes />
                  </Card>
                ))}
              </ul>
              <ContractTable rows={rows} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
