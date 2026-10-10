/**
 * Multi-provider AI configuration and fallback system.
 * 
 * Supports multiple OpenAI-compatible providers with automatic fallback
 * when one fails or times out. Providers are tried in order until one succeeds.
 * 
 * Tier structure:
 * - tier1: Fast, cheap screening models (max 2 fallbacks)
 * - tier2: Slower, more accurate reasoning models (max 2 fallbacks)
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

/** Tier configuration with primary and fallback providers */
export interface TierConfig {
  /** Tier name (tier1 or tier2) */
  tier: "tier1" | "tier2";
  /** Primary provider for this tier */
  primary: string;
  /** Fallback providers (max 2) */
  fallbacks: string[];
}

/** Complete multi-tier, multi-provider configuration */
export interface MultiProviderConfig {
  /** Tier1 configuration (screening) */
  tier1: TierConfig;
  /** Tier2 configuration (reasoning) */
  tier2: TierConfig;
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
    defaultModel: "openrouter/free",
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
 * Default tier configuration with fallbacks
 * Each tier has 1 primary + up to 2 fallbacks
 */
export const DEFAULT_TIER_CONFIG: MultiProviderConfig = {
  tier1: {
    tier: "tier1",
    primary: "groq",
    fallbacks: ["nvidia", "openrouter"],
  },
  tier2: {
    tier: "tier2",
    primary: "nvidia",
    fallbacks: ["groq", "openrouter"],
  },
};

/**
 * Get tier configuration from environment or use defaults
 * 
 * Environment variables:
 * - AI_TIER1_PRIMARY: Primary tier1 provider name
 * - AI_TIER1_FALLBACKS: Comma-separated fallback provider names
 * - AI_TIER2_PRIMARY: Primary tier2 provider name  
 * - AI_TIER2_FALLBACKS: Comma-separated fallback provider names
 */
export function getTierConfig(): MultiProviderConfig {
  const tier1Primary = process.env["AI_TIER1_PRIMARY"]?.trim() || DEFAULT_TIER_CONFIG.tier1.primary;
  const tier1Fallbacks = process.env["AI_TIER1_FALLBACKS"]?.split(",").map(s => s.trim()).filter(Boolean) 
    || DEFAULT_TIER_CONFIG.tier1.fallbacks;
  
  const tier2Primary = process.env["AI_TIER2_PRIMARY"]?.trim() || DEFAULT_TIER_CONFIG.tier2.primary;
  const tier2Fallbacks = process.env["AI_TIER2_FALLBACKS"]?.split(",").map(s => s.trim()).filter(Boolean)
    || DEFAULT_TIER_CONFIG.tier2.fallbacks;
  
  return {
    tier1: {
      tier: "tier1",
      primary: tier1Primary,
      fallbacks: tier1Fallbacks.slice(0, 2), // Max 2 fallbacks
    },
    tier2: {
      tier: "tier2",
      primary: tier2Primary,
      fallbacks: tier2Fallbacks.slice(0, 2), // Max 2 fallbacks
    },
  };
}

/**
 * Get providers for a specific tier (primary + fallbacks)
 */
export function getTierProviders(tier: "tier1" | "tier2"): AIProvider[] {
  const config = getTierConfig();
  const tierConfig = config[tier];
  
  const providers: AIProvider[] = [];
  
  // Add primary
  const primary = getProvider(tierConfig.primary);
  if (primary && hasProviderApiKey(primary)) {
    providers.push(primary);
  }
  
  // Add fallbacks
  for (const fallbackName of tierConfig.fallbacks) {
    const fallback = getProvider(fallbackName);
    if (fallback && hasProviderApiKey(fallback) && !providers.some(p => p.name === fallback.name)) {
      providers.push(fallback);
    }
  }
  
  return providers;
}

/**
 * Get all providers for tier1 (primary + up to 2 fallbacks)
 */
export function getTier1Providers(): AIProvider[] {
  return getTierProviders("tier1");
}

/**
 * Get all providers for tier2 (primary + up to 2 fallbacks)
 */
export function getTier2Providers(): AIProvider[] {
  return getTierProviders("tier2");
}

/**
 * Get the next provider in a tier's sequence
 */
export function getNextTierProvider(
  tier: "tier1" | "tier2",
  exclude: AIProvider[] = []
): AIProvider | undefined {
  const providers = getTierProviders(tier);
  const excludedNames = new Set(exclude.map(p => p.name));
  
  for (const provider of providers) {
    if (!excludedNames.has(provider.name)) {
      return provider;
    }
  }
  
  return undefined;
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
