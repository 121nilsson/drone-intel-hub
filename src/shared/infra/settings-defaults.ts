import type { AIProviderSettings } from "@/shared/contracts/ai";

/** Built-in defaults. Kept in its own module so server-side jobs can read them without
 *  importing services.tsx (which pulls in React). */
export const DEFAULT_SETTINGS: AIProviderSettings = {
  baseUrl: "https://integrate.api.nvidia.com/v1",
  apiKey: "",
  tier1Model: "meta/llama-3.1-8b-instruct",
  tier2Model: "deepseek-ai/deepseek-r1",
  translateModel: "nvidia/riva-translate-4b-instruct-v2",
  escalationThreshold: 0.6,
  autoMergeThreshold: 0.85,
};
