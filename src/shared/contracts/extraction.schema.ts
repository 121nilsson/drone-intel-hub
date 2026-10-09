import { z } from "zod";
import extractionPrompt from "./extraction-prompt.json";

const confidence = z.coerce.number().finite().min(0).max(1);
const optionalText = z.string().trim().min(1).optional();

export const ExtractedSpecSchema = z.object({
  key: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(160),
  value: z.union([z.string().max(2_000), z.number().finite()]),
  unit: optionalText,
  semantic: optionalText,
  raw: optionalText,
  evidence: z.string().trim().min(1).max(1_000).optional(),
});

export const SupplyComponentSchema = z.object({
  part: z.string().trim().min(1).max(200),
  manufacturer: z.string().trim().max(200).default("Unknown"),
  origin: z.string().trim().max(8).default("??"),
  category: optionalText,
  model: optionalText,
  evidence: z.string().trim().min(1).max(1_000).optional(),
  confidence: confidence.optional(),
});

export const PayloadObservationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  category: optionalText,
  quantity: z.coerce.number().int().positive().optional(),
  weightKg: z.coerce.number().finite().positive().optional(),
  evidence: z.string().trim().min(1).max(1_000).optional(),
  confidence: confidence.optional(),
});

export const SensorObservationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.enum(["camera", "eo", "ir", "thermal", "radar", "lidar", "other"]),
  model: optionalText,
  manufacturer: optionalText,
  quantity: z.coerce.number().int().positive().optional(),
  evidence: z.string().trim().min(1).max(1_000).optional(),
  confidence: confidence.optional(),
});

export const DetectedSystemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  matchId: optionalText,
  variantOf: optionalText,
});

export const SystemExtractionSchema = DetectedSystemSchema.extend({
  aliases: z.array(z.string().trim().min(1).max(200)).default([]),
  domain: z.enum(["Air", "Land", "Sea", "Multi"]).optional(),
  origin: optionalText,
  manufacturer: optionalText,
  operators: z.array(z.string().trim().min(1).max(8)).default([]),
  propulsion: optionalText,
  installation: optionalText,
  guidance: z.array(z.string().trim().min(1).max(120)).default([]),
  specs: z.array(ExtractedSpecSchema).default([]),
  rfBands: z.array(z.string().trim().min(1).max(160)).default([]),
  components: z.array(SupplyComponentSchema).default([]),
  payloads: z.array(PayloadObservationSchema).default([]),
  sensors: z.array(SensorObservationSchema).default([]),
  confidence: confidence.default(0),
  rationale: z.string().max(2_000).optional(),
});

/** Tolerant at the boundary: partial model output is useful, invalid primitives are not. */
export const AIExtractionSchema = z.object({
  name: z.string().trim().min(1).max(200).nullish(),
  aliases: z.array(z.string().trim().min(1).max(200)).default([]),
  domain: z.enum(["Air", "Land", "Sea", "Multi"]).nullish(),
  origin: z.string().trim().max(8).nullish(),
  manufacturer: z.string().trim().max(200).nullish(),
  operators: z.array(z.string().trim().min(1).max(8)).default([]),
  propulsion: z.string().trim().max(200).nullish(),
  installation: z.string().trim().max(200).nullish(),
  guidance: z.array(z.string().trim().min(1).max(120)).default([]),
  specs: z.array(ExtractedSpecSchema).default([]),
  rfBands: z.array(z.string().trim().min(1).max(160)).default([]),
  systems: z.array(DetectedSystemSchema).default([]),
  systemExtractions: z.array(SystemExtractionSchema).default([]),
  components: z.array(SupplyComponentSchema).default([]),
  payloads: z.array(PayloadObservationSchema).default([]),
  sensors: z.array(SensorObservationSchema).default([]),
  matchId: z.string().trim().min(1).max(200).nullish(),
  confidence: confidence.default(0),
  rationale: z.string().max(2_000).default(""),
});

export const EXTRACTION_SCHEMA_VERSION = 2;
export const EXTRACTION_PROMPT_VERSION = extractionPrompt.version;

export const ProcurementExtractionSchema = z.object({
  company: z.string().trim().min(1).max(200),
  country: z.string().trim().max(8).default(""),
  amount: optionalText.nullish(),
  currency: optionalText.nullish(),
  program: optionalText.nullish(),
  product: optionalText.nullish(),
  customer: optionalText.nullish(),
  announcedAt: optionalText.nullish(),
  notes: z.string().trim().max(2_000).nullish(),
});
