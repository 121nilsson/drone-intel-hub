/**
 * Multi-provider AI configuration and fallback system.
 * 
 * Supports multiple OpenAI-compatible providers with automatic fallback
 * when one fails or times out. Providers are tried in order until one succeeds.
 */

/** Provider configuration */
export interface AIProvider {
  /** Provider name for logging and identification */
  name: string;
  /** Base URL for the API endpoint */
  baseUrl: string;
  /** API key environment variable name */
  apiKeyEnv: string;
  /** Default model for this provider */
  defaultModel: string;
  /** Priority (lower = tried first) */
  priority: number;
  /** Whether this provider is enabled */
  enabled: boolean;
}

/** Built-in provider configurations */
export const BUILTIN_PROVIDERS: AIProvider[] = [
  {
    name: "nvidia",
    baseUrl: "https://api.nvidia.com/v1",
    apiKeyEnv: "NVIDIA_API_KEY",
    defaultModel: "meta/llama-3.1-8b-instruct",
    priority: 10,
    enabled: true,
  },
  {
    name: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
    defaultModel: "mixtral-8x7b-32768",
    priority: 20,
    enabled: true,
  },
  {
    name: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    defaultModel: "openai/gpt-4o-mini",
    priority: 30,
    enabled: true,
  },
  {
    name: "mistral",
    baseUrl: "https://api.mistral.ai/v1",
    apiKeyEnv: "MISTRAL_API_KEY",
    defaultModel: "mistral-small",
    priority: 40,
    enabled: true,
  },
];

/**
 * Get enabled providers sorted by priority (lowest first)
 */
export function getEnabledProviders(): AIProvider[] {
  return [...BUILTIN_PROVIDERS]
    .filter(p => p.enabled)
    .sort((a, b) => a.priority - b.priority);
}

/**
 * Get a provider by name
 */
export function getProvider(name: string): AIProvider | undefined {
  return BUILTIN_PROVIDERS.find(p => p.name.toLowerCase() === name.toLowerCase());
}

/**
 * Get the API key for a provider from environment
 */
export function getProviderApiKey(provider: AIProvider): string | undefined {
  return process.env[provider.apiKeyEnv]?.trim();
}

/**
 * Check if a provider has a valid API key configured
 */
export function hasProviderApiKey(provider: AIProvider): boolean {
  const key = getProviderApiKey(provider);
  return !!key && key.length > 0;
}

/**
 * Get the base URL for a provider
 */
export function getProviderBaseUrl(provider: AIProvider): string {
  return process.env[`${provider.name.toUpperCase()}_BASE_URL`]?.trim() || provider.baseUrl;
}

/**
 * Get all providers that have valid API keys configured
 */
export function getAvailableProviders(): AIProvider[] {
  return getEnabledProviders().filter(hasProviderApiKey);
}

/**
 * Provider selection strategy
 */
export type ProviderStrategy = "round-robin" | "priority" | "random";

/**
 * Get the current provider strategy from environment
 */
export function getProviderStrategy(): ProviderStrategy {
  const strategy = process.env["AI_PROVIDER_STRATEGY"]?.toLowerCase();
  if (strategy === "round-robin" || strategy === "random") {
    return strategy;
  }
  return "priority"; // Default
}

/**
 * Round-robin state for provider selection
 */
let roundRobinIndex = 0;

/**
 * Get the next provider to use based on strategy
 */
export function getNextProvider(exclude?: AIProvider[]): AIProvider | undefined {
  const available = getAvailableProviders();
  if (available.length === 0) return undefined;
  
  const strategy = getProviderStrategy();
  
  switch (strategy) {
    case "round-robin":
      // Simple round-robin: just cycle through available providers
      const current = available[roundRobinIndex % available.length];
      roundRobinIndex++;
      
      // Skip excluded providers
      if (exclude && exclude.some(p => p.name === current.name)) {
        return getNextProvider([...exclude, current]);
      }
      return current;
    
    case "random":
      // Random selection from available providers
      const filtered = exclude 
        ? available.filter(p => !exclude.some(e => e.name === p.name))
        : available;
      if (filtered.length === 0) return undefined;
      return filtered[Math.floor(Math.random() * filtered.length)];
    
    case "priority":
    default:
      // Default: use priority order, but skip excluded
      const sorted = [...available].sort((a, b) => a.priority - b.priority);
      return sorted.find(p => !exclude || !exclude.some(e => e.name === p.name));
  }
}

/**
 * Reset round-robin index (useful for testing)
 */
export function resetRoundRobin(): void {
  roundRobinIndex = 0;
}

/**
 * Get all available models from all providers
 */
export function getAvailableModels(): { provider: string; model: string }[] {
  return getAvailableProviders().map(p => ({
    provider: p.name,
    model: p.defaultModel,
  }));
}

/**
 * Check if multi-provider mode is enabled
 */
export function isMultiProviderEnabled(): boolean {
  return getAvailableProviders().length > 1;
}
