import type { ProviderEnvConfig } from "@/shared/contracts/ai";

const env = (key: string) => {
  const v = process.env[key]?.trim();
  return v ? v : undefined;
};

/** Runtime provider settings from the server environment (.env / .env.local). */
export function readProviderEnvConfig(): ProviderEnvConfig {
  const baseUrl = env("NVIDIA_BASE_URL");
  const tier1Model = env("NVIDIA_TIER1_MODEL");
  const tier2Model = env("NVIDIA_TIER2_MODEL");
  const translateModel = env("NVIDIA_TRANSLATE_MODEL");
  return {
    hasKey: !!env("NVIDIA_API_KEY"),
    ...(baseUrl ? { baseUrl } : {}),
    ...(tier1Model ? { tier1Model } : {}),
    ...(tier2Model ? { tier2Model } : {}),
    ...(translateModel ? { translateModel } : {}),
  };
}
