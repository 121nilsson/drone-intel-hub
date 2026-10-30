import { z } from "zod";
import { countryCode } from "@/entities/normalization/country";
import extractionPrompt from "./extraction-prompt.json";

const confidence = z.coerce.number().finite().min(0).max(1);

/**
 * Models follow the prompt's `field|null` convention and also emit "" for "unknown", so both read
 * as absent. Everything below is tolerant at the boundary: one malformed field or array item is
 * dropped rather than failing the whole extraction, because a failed parse throws away every
 * valid fact in the same reply.
 */
const blank = (v: unknown) => (v === null || (typeof v === "string" && !v.trim()) ? undefined : v);

const optionalText = z.preprocess(blank, z.string().trim().min(1).optional());

/** Absent on null/blank, and on a value that fails `schema` (e.g. "Russian Federation" as ISO2). */
const lenient = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(blank, schema.optional()).catch(undefined);

/** Keeps the items that parse and drops the rest; a lone item or null is accepted too. */
const lenientArray = <T extends z.ZodTypeAny>(item: T) =>
  z
    .preprocess(
      (v) => (Array.isArray(v) ? v : v === null || v === undefined ? [] : [v]),
      z.array(z.unknown()),
    )
    .catch([])
    .transform((items) =>
      items.flatMap((i): z.output<T>[] => {
        const r = item.safeParse(i);
        return r.success ? [r.data as z.output<T>] : [];
      }),
    );

const textList = (max: number) => lenientArray(z.string().trim().min(1).max(max));

/** "Japan", "UK" and "Russian Federation" become JP, GB and RU before the length check drops them. */
const toCountry = (v: unknown) => (typeof v === "string" ? countryCode(v) : v);
const country = (fallback: string) =>
  z
    .preprocess((v) => toCountry(blank(v)), z.string().trim().max(8).default(fallback))
    .catch(fallback);
const optionalCountry = lenient(z.preprocess(toCountry, z.string().trim().max(8)));
const countryList = lenientArray(
  z.preprocess(toCountry, z.string().trim().min(1).max(8)),
).transform((codes) => [...new Set(codes)]);

const DOMAINS = ["Air", "Land", "Sea", "Multi"] as const;
const domain = z
  .preprocess((v) => {
    if (typeof v !== "string" || !v.trim()) return undefined;
    const t = v.trim().toLowerCase();
    return DOMAINS.find((d) => d.toLowerCase() === t);
  }, z.enum(DOMAINS).optional())
  .catch(undefined);

/**
 * Model keys arrive as free text: "Range", "speedMax", even "target_capability'," with the quote
 * that birthed it sitting in a live dossier. Canonical form is lowercase snake_case so variant
 * spellings merge into one spec and punctuation noise cannot fork a key. A key that reduces to
 * nothing keeps its original text rather than dropping the fact.
 */
const normalizeSpecKey = (v: unknown) => {
  if (typeof v !== "string") return v;
  const cleaned = v
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || v.trim();
};

export const ExtractedSpecSchema = z.preprocess(
  // `label` is display text; a model that gives only `key` has still reported the fact.
  (v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return v;
    const spec = { ...(v as Record<string, unknown>) };
    if (!spec["label"]) spec["label"] = spec["key"];
    spec["key"] = normalizeSpecKey(spec["key"]);
    return spec;
  },
  z.object({
    key: z.string().trim().min(1).max(100),
    label: z.string().trim().min(1).max(160),
    value: z.union([z.string().max(2_000), z.number().finite()]),
    unit: optionalText,
    semantic: optionalText,
    raw: optionalText,
    evidence: lenient(z.string().trim().min(1).max(1_000)),
  }),
);

export const SupplyComponentSchema = z.object({
  part: z.string().trim().min(1).max(200),
  manufacturer: z.preprocess(blank, z.string().trim().max(200).default("Unknown")),
  origin: country("??"),
  category: optionalText,
  model: optionalText,
  evidence: lenient(z.string().trim().min(1).max(1_000)),
  confidence: lenient(confidence),
});

export const PayloadObservationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  category: optionalText,
  quantity: lenient(z.coerce.number().int().positive()),
  weightKg: lenient(z.coerce.number().finite().positive()),
  evidence: lenient(z.string().trim().min(1).max(1_000)),
  confidence: lenient(confidence),
});

const SENSOR_CATEGORIES = ["camera", "eo", "ir", "thermal", "radar", "lidar", "other"] as const;

export const SensorObservationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  category: z
    .preprocess(
      (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
      z.enum(SENSOR_CATEGORIES),
    )
    .catch("other"),
  model: optionalText,
  manufacturer: optionalText,
  quantity: lenient(z.coerce.number().int().positive()),
  evidence: lenient(z.string().trim().min(1).max(1_000)),
  confidence: lenient(confidence),
});

export const DetectedSystemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  matchId: optionalText,
  variantOf: optionalText,
});

/** A bare string in systems[] is a system name. */
const detectedSystem = z.preprocess(
  (v) => (typeof v === "string" ? { name: v } : v),
  DetectedSystemSchema,
);

export const SystemExtractionSchema = DetectedSystemSchema.extend({
  aliases: textList(200),
  domain,
  origin: optionalCountry,
  manufacturer: lenient(z.string().trim().max(200)),
  operators: countryList,
  propulsion: lenient(z.string().trim().max(200)),
  installation: lenient(z.string().trim().max(200)),
  guidance: textList(120),
  specs: lenientArray(ExtractedSpecSchema),
  rfBands: textList(160),
  components: lenientArray(SupplyComponentSchema),
  payloads: lenientArray(PayloadObservationSchema),
  sensors: lenientArray(SensorObservationSchema),
  confidence: z.preprocess(blank, confidence.default(0)),
  rationale: lenient(z.string().max(2_000)),
});

export const AIExtractionSchema = z.object({
  name: lenient(z.string().trim().min(1).max(200)),
  aliases: textList(200),
  domain,
  origin: optionalCountry,
  manufacturer: lenient(z.string().trim().max(200)),
  operators: countryList,
  propulsion: lenient(z.string().trim().max(200)),
  installation: lenient(z.string().trim().max(200)),
  guidance: textList(120),
  specs: lenientArray(ExtractedSpecSchema),
  rfBands: textList(160),
  systems: lenientArray(detectedSystem),
  systemExtractions: lenientArray(SystemExtractionSchema),
  components: lenientArray(SupplyComponentSchema),
  payloads: lenientArray(PayloadObservationSchema),
  sensors: lenientArray(SensorObservationSchema),
  matchId: lenient(z.string().trim().min(1).max(200)),
  confidence: z.preprocess(blank, confidence.default(0)),
  rationale: z.preprocess(blank, z.string().max(2_000).default("")).catch(""),
});

export const EXTRACTION_SCHEMA_VERSION = 2;
export const EXTRACTION_PROMPT_VERSION = extractionPrompt.version;

export const ProcurementExtractionSchema = z.object({
  company: z.string().trim().min(1).max(200),
  country: country(""),
  amount: optionalText,
  currency: optionalText,
  program: optionalText,
  product: optionalText,
  customer: optionalText,
  announcedAt: optionalText,
  notes: lenient(z.string().trim().max(2_000)),
});
