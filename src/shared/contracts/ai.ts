import type { Drone, Extraction } from "@/entities/drone/types";

/** Inference contract — any engine (heuristic, NIM, OpenAI-compatible) can implement it. */
export interface IntelExtractor {
  readonly tier: 1 | 2;
  readonly label: string;
  extract(raw: string, catalog: Drone[]): Promise<Extraction>;
}

export interface BriefingSummarizer {
  summarize(context: string): Promise<string>;
}

export interface AIProviderSettings {
  baseUrl: string;
  apiKey: string;
  tier1Model: string;
  tier2Model: string;
  escalationThreshold: number;
  autoMergeThreshold: number;
}
