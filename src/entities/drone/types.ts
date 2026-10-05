export type Domain = "Air" | "Land" | "Sea" | "Multi";
export const DOMAINS: Domain[] = ["Air", "Land", "Sea", "Multi"];

export interface SpecClaim {
  value: number | string;
  source: string;
  date: string; // ISO
}

/** Schema-less attribute: any key may be discovered by AI or analysts. */
export interface SpecAttribute {
  key: string;
  label: string;
  unit?: string;
  claims: SpecClaim[];
  discoveredBy: "seed" | "ai" | "analyst";
}

export type RFRole = "uplink" | "downlink" | "video" | "gnss" | "antijam";
export interface RFLink {
  role: RFRole;
  band: string; // e.g. "L", "S", "900MHz ISM"
  freqMHz?: [number, number];
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

export interface Drone {
  id: string;
  name: string;
  cyrillic?: string;
  aliases: string[];
  domain: Domain;
  origin: string; // country of origin code
  operators: string[]; // battlefield operator codes
  propulsion: string;
  summary: string;
  specs: SpecAttribute[];
  rf: RFLink[];
  components: SupplyComponent[];
  evolution: EvolutionEvent[];
  counterpartIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ExtractedSpec {
  key: string;
  label: string;
  value: number | string;
  unit?: string;
}

export interface Extraction {
  name?: string;
  aliases: string[];
  domain?: Domain;
  origin?: string;
  operators: string[];
  propulsion?: string;
  specs: ExtractedSpec[];
  rfBands: string[];
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
}

export const FLAGS: Record<string, string> = {
  RU: "🇷🇺", UA: "🇺🇦", IR: "🇮🇷", CN: "🇨🇳", US: "🇺🇸", TW: "🇹🇼", KP: "🇰🇵", TR: "🇹🇷", DE: "🇩🇪", PL: "🇵🇱",
};
export const flag = (c: string) => `${FLAGS[c] ?? "🏳"} ${c}`;
