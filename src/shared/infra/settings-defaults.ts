import type { AIProviderSettings } from "@/shared/contracts/ai";

/**
 * Built-in defaults. Kept in its own module so server-side jobs can read them without
 *  importing services.tsx (which pulls in React).
 *
 * These defaults align with the tiered provider configuration in ai-providers.ts:
 * - tier1 (screening): Groq with mixtral-8x7b-32768 (fast, cheap)
 * - tier2 (reasoning): NVIDIA with meta/llama-3.1-8b-instruct (accurate)
 *
 * When multiple providers are configured via environment variables, the tiered
 * fallback system (getTier1Providers/getTier2Providers) will be used automatically.
 */
export const DEFAULT_SETTINGS: AIProviderSettings = {
  baseUrl: "https://api.groq.com/openai/v1",
  apiKey: "",
  tier1Model: "mixtral-8x7b-32768",
  tier2Model: "meta/llama-3.1-8b-instruct",
  translateModel: "nvidia/riva-translate-4b-instruct-v2",
  escalationThreshold: 0.6,
  autoMergeThreshold: 0.85,
  autoPromoteThreshold: 0.9,
  autoDiscardThreshold: 0.25,
  heuristicFirst: true,
};
