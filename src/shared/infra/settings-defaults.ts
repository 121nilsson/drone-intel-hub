import type { AIProviderSettings } from "@/shared/contracts/ai";

/**
 * Built-in defaults. Kept in its own module so server-side jobs can read them without
 *  importing services.tsx (which pulls in React).
 *
 * The URL and models only apply when the server has no provider key and one is saved in the
 * browser: with a server key, readProviderEnvConfig supplies the first available provider's URL
 * and models instead. So they must all exist on the default `baseUrl` (Groq) - a model id from
 * another provider's catalogue would fail on every call.
 */
export const DEFAULT_SETTINGS: AIProviderSettings = {
  baseUrl: "https://api.groq.com/openai/v1",
  apiKey: "",
  tier1Model: "openai/gpt-oss-20b",
  tier2Model: "openai/gpt-oss-120b",
  translateModel: "openai/gpt-oss-20b",
  escalationThreshold: 0.6,
  autoMergeThreshold: 0.85,
  autoPromoteThreshold: 0.9,
  autoDiscardThreshold: 0.25,
  heuristicFirst: true,
};
