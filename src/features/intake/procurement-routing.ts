import type { Extraction, ExtractedSpec } from "@/entities/drone/types";
import type { Procurement } from "@/entities/procurement/types";
import { parseMoney } from "@/entities/normalization/currency";

/**
 * Financial / programme keys are deal facts, not hardware specs. They are moved out of
 * drone specs at the pipeline boundary (heuristic and AI output alike) and become
 * procurement records, so consensus never treats "$2 billion" as a property of a drone.
 */
const FINANCIAL_KEY =
  /^(?:contract|order|package|deal|delivery|batch|advance|fast_track|total|development|operating|sustainment|programme|program|associated)_?(?:value|cost|funding|amount|commitment|investment|budget)|^(?:contract|order|package)value|funding|investment|production_(?:rate|volume)|_(?:funding|budget)$/i;

export function isFinancialSpecKey(key: string): boolean {
  const k = key.trim().replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
  if (k === "unit_cost") return false;
  return FINANCIAL_KEY.test(k);
}

export interface RoutedExtraction {
  extraction: Extraction;
  financial: ExtractedSpec[];
}

/** Splits financial specs out of an extraction (including per-system slices). Pure. */
export function splitFinancialSpecs(extraction: Extraction): RoutedExtraction {
  const financial: ExtractedSpec[] = [];
  const keep = (specs: ExtractedSpec[]) =>
    specs.filter((s) => {
      if (!isFinancialSpecKey(s.key)) return true;
      financial.push(s);
      return false;
    });
  const specs = keep(extraction.specs);
  const systemExtractions = extraction.systemExtractions?.map((s) => ({
    ...s,
    specs: keep(s.specs),
  }));
  const seen = new Set<string>();
  const unique = financial.filter((s) => {
    const t = `${s.key}|${String(s.value)}|${s.evidence ?? ""}`;
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  });
  return {
    extraction: { ...extraction, specs, ...(systemExtractions ? { systemExtractions } : {}) },
    financial: unique,
  };
}

/** One procurement record per distinct financial claim. */
export function procurementsFrom(
  financial: ExtractedSpec[],
  extraction: Extraction,
  source: string,
  url?: string,
): Procurement[] {
  const now = new Date().toISOString();
  return financial.map((s) => {
    const amount = String(s.value) + (s.unit ? ` ${s.unit}` : "");
    const money = parseMoney(amount);
    const product = extraction.systems?.map((x) => x.name).join(", ") || extraction.name;
    return {
      id: crypto.randomUUID(),
      company: extraction.manufacturer ?? "Unknown",
      country: extraction.origin ?? "",
      amount,
      ...(money ? { currency: money.currency } : {}),
      ...(product ? { product } : {}),
      source,
      ...(url ? { sourceUrl: url } : {}),
      notes: `${s.label}${s.evidence ? `: ${s.evidence}` : ""}`.slice(0, 1000),
      createdAt: now,
    };
  });
}
