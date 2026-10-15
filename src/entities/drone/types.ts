import type { Money, MoneyRange } from "@/entities/normalization/currency";
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
  extractionEngine?: string;
  model?: string;
  date: string; // ISO
  /**
   * Set when the deep model was asked which report behind a contested spec this one supports
   * (features/intake/contradictions.ts). An "outlier" verdict never removes or rewrites the
   * claim - the report said what it said - it records what the check concluded, so a reader
   * sees an adjudicated disagreement instead of an unresolved one.
   */
  adjudication?: {
    verdict: "supported" | "outlier";
    confidence: number;
    at: string;
    reason?: string;
  };
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
  /**
   * When the deep model last checked this spec's disagreement. Keeps the check one-shot: a
   * claim dated after it re-opens the question, otherwise the spec is not asked again.
   */
  contradictionCheckedAt?: string;
}

export type RFRole =
  "uplink" | "downlink" | "video" | "gnss" | "antijam" | "telemetry" | "tether" | "unknown";
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
  category?: string;
  model?: string;
  evidence?: string;
  confidence?: number;
  sourceId?: string;
}

export interface PayloadObservation {
  name: string;
  category?: string;
  quantity?: number;
  weightKg?: number;
  evidence?: string;
  confidence?: number;
  sourceId?: string;
}

export interface SensorObservation {
  name: string;
  category: "camera" | "eo" | "ir" | "thermal" | "radar" | "lidar" | "other";
  model?: string;
  manufacturer?: string;
  quantity?: number;
  evidence?: string;
  confidence?: number;
  sourceId?: string;
}

export type EvolutionKind = "frequency" | "motor" | "payload" | "airframe" | "mention" | "other";
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
  /**
   * Figures from the article's infobox or specification section, plus Wikidata quantities the
   * article lacks. Each carries the template line it was read from as evidence.
   */
  specs?: ExtractedSpec[];
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
  /** Cached English translation of a non-English source-language summary. */
  summaryEnglish?: string;
  specs: SpecAttribute[];
  rf: RFLink[];
  components: SupplyComponent[];
  payloads?: PayloadObservation[];
  sensors?: SensorObservation[];
  evolution: EvolutionEvent[];
  counterpartIds: string[];
  /** Explicit family relationship. Variants are not counterparts. */
  variantOfId?: string;
  variantIds?: string[];
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
  moneyRange?: MoneyRange;
  /** Verbatim clause supporting this observation. */
  evidence?: string;
}

export interface DetectedSystem {
  name: string;
  matchId?: string;
  variantOf?: string;
}

export interface SystemExtraction extends DetectedSystem {
  aliases?: string[];
  domain?: Domain;
  origin?: string;
  manufacturer?: string;
  operators?: string[];
  propulsion?: string;
  installation?: string;
  guidance?: string[];
  specs: ExtractedSpec[];
  rfBands: string[];
  components?: SupplyComponent[];
  payloads?: PayloadObservation[];
  sensors?: SensorObservation[];
  confidence: number;
  rationale?: string;
}

export interface ExtractionMetadata {
  schemaVersion: number;
  engine: "heuristic" | "ai" | "combined";
  model?: string;
  promptVersion?: string;
  escalationReasons?: string[];
  analyzedAt: string;
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
  /** Per-system results prevent facts from a multi-system report being cross-attributed. */
  systemExtractions?: SystemExtraction[];
  components?: SupplyComponent[];
  payloads?: PayloadObservation[];
  sensors?: SensorObservation[];
  guidance?: string[];
  matchId?: string;
  confidence: number; // 0..1
  rationale: string;
  metadata?: ExtractionMetadata;
}

export type CandidateStatus = "pending" | "promoted" | "merged" | "discarded";
export interface CandidateQuality {
  /** Model/system quality score used for triage. */
  confidence: number;
  /** Number of extracted specs retained for this candidate. */
  specCount: number;
  /** Specs whose evidence text was actually retained after the autonomy brake. */
  evidenceSpecCount: number;
  /** Systems the extraction attributed this candidate/text to. */
  systemNames: string[];
  /** Candidate quality risks that keep it in review. */
  risks: string[];
  /** Runtime triage outcome this candidate reached. */
  decision?: "auto-merged" | "auto-promoted" | "queued" | "auto-discarded";
}

export interface Candidate {
  id: string;
  raw: string;
  source: string;
  createdAt: string;
  tier: 1 | 2;
  extraction: Extraction;
  status: CandidateStatus;
  resolvedInto?: string;
  supersededBy?: string;
  /** Who resolved it; absent on candidates resolved before auto-triage existed. */
  resolvedBy?: "auto" | "analyst";
  /** When the deep model was asked whether this is its matched catalog entry; asked once. */
  adjudicatedAt?: string;
  /** Explainability snapshot captured at ingest time. */
  quality?: CandidateQuality;
}

/** Plain-text country code; rendered flags live in `CountryBadge` (flag-icons). */
export const flag = (c: string) => c.trim().toUpperCase();
