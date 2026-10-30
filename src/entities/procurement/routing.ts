import type { Drone, Extraction, ExtractedSpec, SpecAttribute } from "@/entities/drone/types";
import type { Procurement } from "@/entities/procurement/types";
import { parseMoney } from "@/entities/normalization/currency";
import { countryCode } from "@/entities/normalization/country";
import { namedIn, type SystemRef } from "./linking";

/**
 * Financial / programme keys are deal facts, not hardware specs. They are moved out of
 * drone specs at the pipeline boundary (heuristic and AI output alike) and become
 * procurement records, so consensus never treats "$2 billion" as a property of a drone.
 */
const FINANCIAL_KEY =
  /(?:^|_)(?:contract|order|package|deal|delivery|batch|advance|fast_track|total|development|operating|sustainment|programme|program|associated)_?(?:value|cost|funding|amount|commitment|investment|budget|ceiling|price)|^(?:contract|order|package)value|^price_total$|funding|investment|production_(?:rate|volume)|_(?:funding|budget)$/i;

/**
 * A deal figure the model filed under a price key: "Funding amount", "Sales value" and
 * "Contract value" all arrived as `unit_price`, and would have read as what one unit costs.
 */
const FINANCIAL_LABEL =
  /\b(?:contract|order|deal|sales|programme|program|package)\s+(?:value|ceiling|amount|total)\b|\bfunding\b|\bbudget\b|\btotal\s+(?:price|cost|value)\b|\bgrant\b/i;

export function isFinancialSpecKey(key: string): boolean {
  const k = key
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase();
  if (k === "unit_cost") return false;
  return FINANCIAL_KEY.test(k);
}

/** A deal figure by its key or by what its label says it is. */
export function isFinancialSpec(spec: { key: string; label?: string }): boolean {
  return isFinancialSpecKey(spec.key) || FINANCIAL_LABEL.test(spec.label ?? "");
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
      if (!isFinancialSpec(s)) return true;
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

/** Context that belongs to the post, not to any one financial claim inside it. */
export interface ProcurementContext {
  sourceId?: string;
  publishedAt?: string;
}

const unique = (values: (string | undefined)[]): string[] => [
  ...new Set(values.map((v) => v?.trim()).filter((v): v is string => Boolean(v))),
];

const isoDate = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
};

/** The supplier country should be an ISO2 code; a model's longer answer is not a country badge. */
const isoCountry = (value: string | undefined): string | undefined => {
  const code = value ? countryCode(value) : undefined;
  return code && /^[A-Z]{2}$/.test(code) ? code : undefined;
};

/**
 * Content identity of a contract. A re-analysis of the same post produces a new document id, but
 * the same source claim and figure, so the repository can skip the duplicate instead of growing
 * one procurement row per pipeline run.
 */
export function procurementDedupeKey(
  p: Pick<Procurement, "source" | "sourceId" | "sourceUrl" | "amount" | "company" | "notes">,
): string {
  return [p.sourceId ?? p.sourceUrl ?? p.source, p.amount ?? "", p.company, p.notes ?? ""]
    .map((part) => part.trim().replace(/\s+/g, " ").toLowerCase())
    .join("|");
}

/** One procurement record per distinct financial claim. */
export function procurementsFrom(
  financial: ExtractedSpec[],
  extraction: Extraction,
  source: string,
  url?: string,
  context: ProcurementContext = {},
): Procurement[] {
  const now = new Date().toISOString();
  const announcedAt = isoDate(context.publishedAt);
  // The post's own subject first: it is what a deal links to when its sentence names nothing.
  const systems: SystemRef[] = [
    ...(extraction.name
      ? [
          {
            name: extraction.name,
            aliases: extraction.aliases,
            ...(extraction.matchId ? { id: extraction.matchId } : {}),
          },
        ]
      : []),
    ...(extraction.systemExtractions ?? []).map((x) => ({
      name: x.name,
      aliases: x.aliases,
      ...(x.matchId ? { id: x.matchId } : {}),
    })),
    ...(extraction.systems ?? []).map((x) => ({
      name: x.name,
      ...(x.matchId ? { id: x.matchId } : {}),
    })),
  ];
  return financial.map((s) => {
    const named = s.evidence ? namedIn(s.evidence, systems) : [];
    const linked = named.length ? named : systems.slice(0, 1);
    const systemNames = unique(linked.map((x) => x.name));
    const systemIds = unique(linked.map((x) => x.id));
    const product = systemNames.join(", ");
    const amount = String(s.value) + (s.unit ? ` ${s.unit}` : "");
    const money = parseMoney(amount);
    const notes = `${s.label}${s.evidence ? `: ${s.evidence}` : ""}`.slice(0, 1000);
    const base = {
      company: extraction.manufacturer ?? "Unknown",
      // `origin` is an ISO2 code and "??" is the extractor's unknown sentinel; a badge should
      // show nothing rather than "XX" when the post did not identify a country.
      country: isoCountry(extraction.origin) ?? "",
      amount,
      source,
      notes,
      ...(context.sourceId ? { sourceId: context.sourceId } : {}),
      ...(url ? { sourceUrl: url } : {}),
    };
    return {
      id: crypto.randomUUID(),
      ...base,
      ...(money ? { currency: money.currency } : {}),
      ...(product ? { product } : {}),
      ...(systemIds.length ? { systemIds } : {}),
      ...(systemNames.length ? { systemNames } : {}),
      ...(announcedAt ? { announcedAt } : {}),
      dedupeKey: procurementDedupeKey(base),
      createdAt: now,
    };
  });
}

/**
 * Fill the metadata a deterministic pass cannot know (buyer, programme, announcement date) from
 * the procurement extractor. Only blanks are filled: the source claim's amount, company and
 * evidence stay exactly as routed, and a later re-analysis cannot replace them with model prose.
 */
export function enrichProcurement(record: Procurement, extracted: Procurement): Procurement {
  const next = { ...record };
  if ((!next.company || next.company === "Unknown") && extracted.company) {
    next.company = extracted.company.trim();
  }
  if (!next.country) {
    const country = isoCountry(extracted.country);
    if (country) next.country = country;
  }
  if (!next.customer && extracted.customer) next.customer = extracted.customer.trim();
  if (!next.program && extracted.program) next.program = extracted.program.trim();
  if (!next.product && extracted.product) next.product = extracted.product.trim();
  if (!next.amount && extracted.amount) {
    next.amount = extracted.amount.trim();
    if (!next.currency && extracted.currency) next.currency = extracted.currency.trim();
  }
  if (!next.announcedAt) {
    const announcedAt = isoDate(extracted.announcedAt);
    if (announcedAt) next.announcedAt = announcedAt;
  }
  if (!next.notes && extracted.notes) next.notes = extracted.notes.trim();
  return next;
}

/**
 * Procurement records for a deal figure that was stored as a spec before routing existed (or
 * before its label was understood as one). Each claim is one record, built the way ingestion
 * builds them, so a claim the pipeline already routed has the same dedupe key and is skipped.
 */
export function procurementsFromStoredSpec(
  drone: Pick<Drone, "id" | "name" | "manufacturer" | "origin">,
  spec: SpecAttribute,
  now = new Date().toISOString(),
): Procurement[] {
  return spec.claims.map((c) => {
    const amount = String(c.value) + (spec.unit ? ` ${spec.unit}` : "");
    const money = parseMoney(amount);
    const base = {
      company: drone.manufacturer ?? "Unknown",
      country: isoCountry(drone.origin) ?? "",
      amount,
      source: c.source,
      notes: `${spec.label}${c.evidence ? `: ${c.evidence}` : ""}`.slice(0, 1000),
      ...(c.sourceId ? { sourceId: c.sourceId } : {}),
    };
    return {
      id: crypto.randomUUID(),
      ...base,
      ...(money ? { currency: money.currency } : {}),
      product: drone.name,
      systemIds: [drone.id],
      systemNames: [drone.name],
      dedupeKey: procurementDedupeKey(base),
      createdAt: now,
    };
  });
}
