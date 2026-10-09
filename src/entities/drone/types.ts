import type { Money } from "@/entities/normalization/currency";
import type { NormalizedRFLink } from "@/entities/normalization/rf";
import type { NormalizedQuantity } from "@/entities/normalization/units";

export type Domain = "Air" | "Land" | "Sea" | "Multi";
export const DOMAINS: Domain[] = ["Air", "Land", "Sea", "Multi"];

export interface SpecClaim {
  value: number | string;
  /** Verbatim text when the value was parsed from a string. */
  raw?: string;
  /** Parsed measurement in canonical units. Absent means not parsed. */
  normalized?: NormalizedQuantity;
  /** Deterministic parser confidence, 0..1. */
  normalizationConfidence?: number;
  source: string;
  /** RawDispatch id when this claim came from ingestion. */
  sourceId?: string;
  evidence?: string;
  extractionConfidence?: number;
  date: string; // ISO
}

/** Schema-less attribute: any key may be discovered by AI or analysts. */
export interface SpecAttribute {
  key: string;
  label: string;
  unit?: string;
  /** Canonical measurement, e.g. "range.max". Unmapped keys keep their original key. */
  semantic?: string;
  canonicalUnit?: string;
  claims: SpecClaim[];
  discoveredBy: "seed" | "ai" | "analyst";
}

export type RFRole = "uplink" | "downlink" | "video" | "gnss" | "antijam" | "telemetry" | "tether" | "unknown";
export interface RFLink {
  role: RFRole;
  /** Raw band label as written. Evidence only; bands are recomputed from freqMHz. */
  band: string;
  freqMHz?: [number, number];
  ieeeBands?: string[];
  natoBands?: string[];
  protocols?: string[];
  isFiberOptic?: boolean;
  confidence?: number;
  tacticalTag?: string;
  notes?: string;
}

export interface SupplyComponent {
  part: string;
  manufacturer: string;
  origin: string; // country code
}

export type EvolutionKind = "frequency" | "motor" | "payload" | "airframe" | "other";
export interface EvolutionEvent {
  date: string;
  kind: EvolutionKind;
  description: string;
  source: string;
}

/** Wikipedia/Wikidata identity attached by the reference import. Not a spec claim. */
export interface DroneReference {
  wikidataId: string;
  alsoIds: string[];
  lang: "en" | "ru" | "uk";
  title: string;
  revisionId: number;
  url: string;
  license: "CC BY-SA 4.0";
  importedAt: string;
}

/**
 * One Wikidata item, already resolved to catalog fields. The server returns these;
 * `applyReference` decides whether each one fills an existing drone or becomes a new card.
 */
export interface ReferenceCard {
  wikidataId: string;
  name: string;
  cyrillic?: string;
  aliases: string[];
  domain: Domain;
  origin: string;
  manufacturer?: string;
  operators: string[];
  summary: string;
  lang: "en" | "ru" | "uk";
  title: string;
  revisionId: number;
  url: string;
}

export interface Drone {
  id: string;
  name: string;
  cyrillic?: string;
  aliases: string[];
  domain: Domain;
  origin: string; // country of origin code
  manufacturer?: string; // company that designed/produces the system
  operators: string[]; // battlefield operator codes
  /** Raw propulsion text. Never replaced by the canonical id. */
  propulsion: string;
  propulsionId?: string;
  /** Raw installation / airframe text. Never replaced by the canonical id. */
  installation?: string;
  installationId?: string;
  summary: string;
  specs: SpecAttribute[];
  rf: RFLink[];
  components: SupplyComponent[];
  evolution: EvolutionEvent[];
  counterpartIds: string[];
  reference?: DroneReference;
  createdAt: string;
  updatedAt: string;
}

export interface ExtractedSpec {
  key: string;
  label: string;
  value: number | string;
  unit?: string;
  semantic?: string;
  raw?: string;
  normalized?: NormalizedQuantity;
  money?: Money;
}

export interface DetectedSystem {
  name: string;
  matchId?: string;
  variantOf?: string;
}

export interface Extraction {
  name?: string;
  aliases: string[];
  domain?: Domain;
  origin?: string;
  manufacturer?: string;
  operators: string[];
  propulsion?: string;
  propulsionId?: string;
  installation?: string;
  installationId?: string;
  specs: ExtractedSpec[];
  /** Raw band strings from the extractor. Evidence; normalization reads these. */
  rfBands: string[];
  rf?: NormalizedRFLink[];
  systems?: DetectedSystem[];
  matchId?: string;
  confidence: number; // 0..1
  rationale: string;
}

export type CandidateStatus = "pending" | "promoted" | "merged" | "discarded";
export interface Candidate {
  id: string;
  raw: string;
  source: string;
  createdAt: string;
  tier: 1 | 2;
  extraction: Extraction;
  status: CandidateStatus;
  resolvedInto?: string;
  /** Who resolved it; absent on candidates resolved before auto-triage existed. */
  resolvedBy?: "auto" | "analyst";
}

export const FLAGS: Record<string, string> = {
  RU: "🇷🇺", UA: "🇺🇦", IR: "🇮🇷", CN: "🇨🇳", US: "🇺🇸", TW: "🇹🇼", KP: "🇰🇵", TR: "🇹🇷", DE: "🇩🇪", PL: "🇵🇱",
};
export const flag = (c: string) => `${FLAGS[c] ?? "🏳"} ${c}`;
