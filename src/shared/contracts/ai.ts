import type { Drone, Extraction } from "@/entities/drone/types";

/** Inference contract — any engine (heuristic, NIM, OpenAI-compatible) can implement it. */
export interface IntelExtractor {
  readonly tier: 1 | 2;
  readonly label: string;
  extract(raw: string, catalog: Drone[], context?: Extraction): Promise<Extraction>;
}

export interface BriefingSummarizer {
  summarize(context: string): Promise<string>;
}

/** Non-secret inference fields resolved from the server environment. */
export interface ProviderEnvConfig {
  hasKey: boolean;
  baseUrl?: string;
  tier1Model?: string;
  tier2Model?: string;
  translateModel?: string;
}

export interface AIProviderSettings {
  baseUrl: string;
  apiKey: string;
  tier1Model: string;
  tier2Model: string;
  translateModel: string;
  escalationThreshold: number;
  autoMergeThreshold: number;
  /** A confident, uncatalogued, uniquely named system is promoted without review. */
  autoPromoteThreshold: number;
  /** Below this a candidate is discarded as noise without review. */
  autoDiscardThreshold: number;
  /** Run deterministic extraction before spending provider quota. */
  heuristicFirst: boolean;
}
