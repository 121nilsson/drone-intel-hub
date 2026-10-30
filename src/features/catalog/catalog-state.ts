import type { CatalogFacets } from "@/shared/contracts/repository";

/**
 * Catalog search↔URL codec. The catalog's filters and sort live in the URL so a view can be
 * shared, bookmarked, or pasted into a report; without this, refreshing the page throws away a
 * facet setup that may have taken a dozen clicks to build.
 *
 * TanStack Router re-serializes whatever validateSearch returns into the URL, so the params can
 * only be shallow string leaves: parse() validates and returns exactly what the URL said, no
 * defaults filled in, and fromSearchParams()/toCatalogSearch() do the defaulting round-trip.
 * Facet values are compact CSVs with one short param per facet (`dom`, `org`, …) so a common
 * URL reads well: /catalog?dom=Air&q=shahed. Values come from corpora (band names, protocol
 * ids) and are not chosen to collide with commas, which is why no escaping layer is added.
 */
export type CatalogSort = "name" | "updated" | "reported" | "domain";

const SORTS: CatalogSort[] = ["name", "updated", "reported", "domain"];

/**
 * The view an analyst sees with no params in the URL. "updated" leads because the catalog's value
 * is freshness — the systems whose evidence moved are the ones worth reopening, and a name-sorted
 * list buries them under a–z. It is also the value toCatalogSearch() leaves out of the URL, so a
 * bare /catalog must land on it.
 */
export const DEFAULT_SORT: CatalogSort = "updated";

const FACET_PARAMS: { field: keyof CatalogFacets; param: string }[] = [
  { field: "domains", param: "dom" },
  { field: "origin", param: "org" },
  { field: "operators", param: "op" },
  { field: "bands", param: "band" },
  { field: "ieeeBands", param: "ieee" },
  { field: "natoBands", param: "nato" },
  { field: "propulsion", param: "prop" },
  { field: "propulsionIds", param: "fam" },
  { field: "installationIds", param: "inst" },
  { field: "protocols", param: "proto" },
];
const FIBER_PARAM = "fiber";

export interface CatalogState {
  q: string;
  sort: CatalogSort;
  facets: Required<CatalogFacets>;
}

export const emptyFacets = (): Required<CatalogFacets> => ({
  domains: [],
  origin: [],
  operators: [],
  bands: [],
  propulsion: [],
  propulsionIds: [],
  installationIds: [],
  protocols: [],
  ieeeBands: [],
  natoBands: [],
  fiberOnly: false,
});

const csv = (raw: unknown) => (typeof raw === "string" ? raw.split(",").filter(Boolean) : null);

/** Validate a URL search record into clean shallow params (unknown fields are dropped in full). */
export function parseCatalogSearchParams(s: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof s["q"] === "string" && s["q"]) out["q"] = s["q"];
  const sort = SORTS.find((x) => x === s["sort"]);
  if (sort) out["sort"] = sort;
  for (const { param } of FACET_PARAMS) {
    const values = csv(s[param]);
    if (values?.length) out[param] = values.join(",");
  }
  if (s[FIBER_PARAM] === "1") out[FIBER_PARAM] = "1";
  return out;
}

export function fromSearchParams(p: Record<string, string>): CatalogState {
  const facets = emptyFacets();
  for (const { field, param } of FACET_PARAMS) {
    (facets[field] as string[]) = csv(p[param]) ?? [];
  }
  if (p[FIBER_PARAM] === "1") facets.fiberOnly = true;
  return {
    q: p["q"] ?? "",
    sort: (SORTS.find((x) => x === p["sort"]) ?? DEFAULT_SORT) as CatalogSort,
    facets,
  };
}

/** Only divergences from the default are encoded; nothing to say means no URL params at all. */
export function toCatalogSearch(state: CatalogState): Record<string, string> {
  const out: Record<string, string> = {};
  if (state.q) out["q"] = state.q;
  if (state.sort !== DEFAULT_SORT) out["sort"] = state.sort;
  for (const { field, param } of FACET_PARAMS) {
    const values = state.facets[field] as string[];
    if (values.length) out[param] = values.join(",");
  }
  if (state.facets.fiberOnly) out[FIBER_PARAM] = "1";
  return out;
}
