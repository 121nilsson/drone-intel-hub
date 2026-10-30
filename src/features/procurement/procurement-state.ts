import type { Procurement } from "@/entities/procurement/types";
import { procurementHaystack } from "@/entities/procurement/presentation";
import { byFrequency } from "@/shared/ui/facets";

/**
 * Procurement search is URL state for the same reason the catalog's is: a buyer/currency view is
 * worth sharing, and refreshing must not throw it away. Values stay shallow strings; CSVs are
 * compact and the values (ISO2, ISO currency, buyer names) do not contain commas in practice.
 */
export interface ProcurementState {
  q: string;
  countries: string[];
  currencies: string[];
  buyers: string[];
  /** A catalog id from a dossier's "View contracts" link, or a system name from a pasted URL. */
  system: string;
}

export interface ProcurementFacets {
  countries: string[];
  currencies: string[];
  buyers: string[];
}

const csv = (raw: unknown): string[] =>
  typeof raw === "string"
    ? [
        ...new Set(
          raw
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ]
    : [];

const join = (values: string[]) => values.join(",");

/** Validate a URL record into clean shallow params; unknown fields are dropped. */
export function parseProcurementSearchParams(s: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof s["q"] === "string" && s["q"].trim()) out["q"] = s["q"];
  for (const param of ["country", "currency", "buyer"] as const) {
    const values = csv(s[param]);
    if (values.length) out[param] = join(values);
  }
  if (typeof s["system"] === "string" && s["system"].trim()) out["system"] = s["system"];
  return out;
}

export function fromProcurementSearchParams(p: Record<string, string>): ProcurementState {
  return {
    q: p["q"] ?? "",
    countries: csv(p["country"]),
    currencies: csv(p["currency"]),
    buyers: csv(p["buyer"]),
    system: p["system"] ?? "",
  };
}

/** Only non-default values reach the URL. */
export function toProcurementSearchParams(state: ProcurementState): Record<string, string> {
  const out: Record<string, string> = {};
  if (state.q.trim()) out["q"] = state.q;
  if (state.countries.length) out["country"] = join(state.countries);
  if (state.currencies.length) out["currency"] = join(state.currencies);
  if (state.buyers.length) out["buyer"] = join(state.buyers);
  if (state.system) out["system"] = state.system;
  return out;
}

export function procurementFacets(procurements: readonly Procurement[]): ProcurementFacets {
  return {
    countries: byFrequency(procurements.map((p) => p.country)),
    currencies: byFrequency(procurements.map((p) => p.currency)),
    buyers: byFrequency(procurements.map((p) => p.customer)),
  };
}

export function matchesProcurement(procurement: Procurement, state: ProcurementState): boolean {
  if (state.countries.length && !state.countries.includes(procurement.country)) return false;
  if (state.currencies.length && !state.currencies.includes(procurement.currency ?? ""))
    return false;
  if (state.buyers.length && !state.buyers.includes(procurement.customer ?? "")) return false;
  if (state.system) {
    const wanted = state.system.toLowerCase();
    const names = (procurement.systemNames ?? []).map((name) => name.toLowerCase());
    if (
      !(procurement.systemIds ?? []).includes(state.system) &&
      !names.includes(wanted) &&
      !(procurement.product ?? "").toLowerCase().includes(wanted)
    )
      return false;
  }
  const q = state.q.trim().toLowerCase();
  return !q || procurementHaystack(procurement).includes(q);
}

/** Filter only; callers sort with `byNewestContract` so the ordering stays one policy. */
export function filterProcurements(
  procurements: readonly Procurement[],
  state: ProcurementState,
): Procurement[] {
  return procurements.filter((procurement) => matchesProcurement(procurement, state));
}
