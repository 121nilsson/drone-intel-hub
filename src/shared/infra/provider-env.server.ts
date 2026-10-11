import type { ProviderEnvConfig, ProviderRouting } from "@/shared/contracts/ai";

const env = (key: string) => {
  const v = process.env[key]?.trim();
  return v ? v : undefined;
};

/**
 * The multi-provider layer as the server resolved it.
 *
 * ai-providers.ts reads process.env directly, so it is server-only and reached through here rather
 * than imported by a component. Nothing secret is returned: a provider contributes its name, its
 * resolved base URL, its default model, and whether a key exists - plus the NAME of the env var,
 * so an operator can see what to set without this object being a credential.
 *
 * A failure here is reported as `undefined` rather than thrown. The routing panel is diagnostics;
 * a settings page that refuses to render because the provider table could not be read would be a
 * worse outcome than one that shows a single provider and a note.
 */
export async function readProviderRouting(): Promise<ProviderRouting | undefined> {
  try {
    const {
      getAvailableProviders,
      getEnabledProviders,
      getProviderBaseUrl,
      getProviderModel,
      getProviderStrategy,
      getTierConfig,
      isMultiProviderEnabled,
    } = await import("./ai-providers");

    return {
      providers: getEnabledProviders().map((p) => ({
        name: p.name,
        baseUrl: getProviderBaseUrl(p),
        defaultModel: p.defaultModel,
        // Resolved per tier, because the fallback chain asks each provider for its own model.
        tier1Model: getProviderModel(p, "tier1"),
        tier2Model: getProviderModel(p, "tier2"),
        priority: p.priority,
        hasKey: !!env(p.apiKeyEnv),
        keyEnv: p.apiKeyEnv,
      })),
      available: getAvailableProviders().map((p) => p.name),
      multiProvider: isMultiProviderEnabled(),
      strategy: getProviderStrategy(),
      routes: (["tier1", "tier2"] as const).map((tier) => {
        const cfg = getTierConfig()[tier];
        return { tier, primary: cfg.primary, fallbacks: cfg.fallbacks };
      }),
    };
  } catch (e) {
    console.error("[provider-env] could not read the provider layer", e);
    return undefined;
  }
}

/** The provider a call reaches first, or undefined when no provider has a key. */
async function firstAvailableProvider() {
  try {
    const { getAvailableProviders } = await import("./ai-providers");
    return getAvailableProviders()[0];
  } catch (e) {
    console.error("[provider-env] could not read the provider layer", e);
    return undefined;
  }
}

/**
 * Runtime provider settings from the server environment (.env / .env.local).
 *
 * `hasKey` means ANY provider has a key, and the URL and models are those of the provider the
 * chain tries first - the one that receives the configured model (see callWithProviders). Keying
 * this on NVIDIA alone sent a Groq-only deployment to the heuristic engine everywhere.
 */
export async function readProviderEnvConfig(): Promise<ProviderEnvConfig> {
  const routing = await readProviderRouting();
  const primary = await firstAvailableProvider();
  if (primary) {
    const { getProviderBaseUrl, getProviderModel, getProviderTranslateModel } =
      await import("./ai-providers");
    return {
      hasKey: true,
      baseUrl: getProviderBaseUrl(primary),
      tier1Model: getProviderModel(primary, "tier1"),
      tier2Model: getProviderModel(primary, "tier2"),
      translateModel: getProviderTranslateModel(primary),
      ...(routing ? { routing } : {}),
    };
  }

  // No server key: report only what the environment sets, for a key saved in the browser.
  const baseUrl = env("NVIDIA_BASE_URL");
  const tier1Model = env("NVIDIA_TIER1_MODEL");
  const tier2Model = env("NVIDIA_TIER2_MODEL");
  const translateModel = env("NVIDIA_TRANSLATE_MODEL");
  return {
    hasKey: false,
    ...(baseUrl ? { baseUrl } : {}),
    ...(tier1Model ? { tier1Model } : {}),
    ...(tier2Model ? { tier2Model } : {}),
    ...(translateModel ? { translateModel } : {}),
    ...(routing ? { routing } : {}),
  };
}
