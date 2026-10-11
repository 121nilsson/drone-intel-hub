import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readProviderEnvConfig, readProviderRouting } from "@/shared/infra/provider-env.server";

/**
 * The Settings page renders whatever this returns, so two properties matter and neither is
 * obvious from the types: it must never carry a secret, and it must describe the providers the
 * server actually resolved rather than the ones the build shipped.
 *
 * ai-providers.ts reads process.env at call time, so each test sets the environment explicitly
 * instead of relying on whatever the machine happens to have.
 */

const KEYS = [
  "NVIDIA_API_KEY",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "MISTRAL_API_KEY",
  "NVIDIA_BASE_URL",
  "GROQ_BASE_URL",
  // vite.config.ts loads .env into process.env, so these are set on this machine whether or not
  // the test wants them. They must be cleared too or the "unset" cases see the developer's config.
  "NVIDIA_TIER1_MODEL",
  "NVIDIA_TIER2_MODEL",
  "NVIDIA_TRANSLATE_MODEL",
  // Set by a test below; must not leak into the next.
  "GROQ_TIER1_MODEL",
  "GROQ_TIER2_MODEL",
  "GROQ_TRANSLATE_MODEL",
  "AI_PROVIDER_STRATEGY",
  "AI_TIER1_PRIMARY",
  "AI_TIER2_PRIMARY",
  "AI_TIER1_FALLBACKS",
  "AI_TIER2_FALLBACKS",
];

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("readProviderRouting", () => {
  it("lists every enabled provider even when none has a key", async () => {
    const r = await readProviderRouting();
    expect(r).toBeDefined();
    expect(r!.providers.map((p) => p.name)).toEqual(["nvidia", "groq", "openrouter", "mistral"]);
    expect(r!.available).toEqual([]);
    expect(r!.multiProvider).toBe(false);
  });

  it("reports a provider as available only once its key exists", async () => {
    process.env["NVIDIA_API_KEY"] = "secret-nv";
    process.env["GROQ_API_KEY"] = "secret-gq";
    const r = await readProviderRouting();
    expect(r!.available).toEqual(["nvidia", "groq"]);
    expect(r!.multiProvider).toBe(true);
    expect(r!.providers.find((p) => p.name === "nvidia")!.hasKey).toBe(true);
    expect(r!.providers.find((p) => p.name === "mistral")!.hasKey).toBe(false);
  });

  // The whole point of routing this to the browser: an operator must be able to see which env
  // var to set, without this object being a way to read one back out.
  it("never carries a key value", async () => {
    process.env["NVIDIA_API_KEY"] = "sk-super-secret-value";
    process.env["GROQ_API_KEY"] = "gsk-super-secret-value";
    const r = await readProviderRouting();
    const serialised = JSON.stringify(r);
    expect(serialised).not.toContain("super-secret");
    // ...but it does name the variable, which is what makes the panel actionable.
    expect(r!.providers.find((p) => p.name === "nvidia")!.keyEnv).toBe("NVIDIA_API_KEY");
  });

  it("resolves the base URL override per provider", async () => {
    process.env["NVIDIA_BASE_URL"] = "https://integrate.api.nvidia.com/v1";
    process.env["GROQ_BASE_URL"] = "https://proxy.internal/groq/v1";
    const r = await readProviderRouting();
    expect(r!.providers.find((p) => p.name === "nvidia")!.baseUrl).toBe(
      "https://integrate.api.nvidia.com/v1",
    );
    expect(r!.providers.find((p) => p.name === "groq")!.baseUrl).toBe(
      "https://proxy.internal/groq/v1",
    );
    // No override, so the built-in stands.
    expect(r!.providers.find((p) => p.name === "mistral")!.baseUrl).toBe(
      "https://api.mistral.ai/v1",
    );
  });

  it("carries each provider's default model and priority order", async () => {
    const r = await readProviderRouting();
    const byName = Object.fromEntries(r!.providers.map((p) => [p.name, p]));
    expect(byName["groq"]!.defaultModel).toBe("openai/gpt-oss-20b");
    expect(byName["openrouter"]!.defaultModel).toBe("openrouter/free");
    expect(r!.providers.map((p) => p.priority)).toEqual([10, 20, 30, 40]);
  });

  // The panel answers "what happens to my tier if that provider goes down?" from these fields,
  // so they must be the RESOLVED model, not the raw optional one - otherwise the browser would
  // have to reimplement the env -> field -> default precedence to be correct.
  it("resolves a model for every provider and every tier", async () => {
    const r = await readProviderRouting();
    for (const p of r!.providers) {
      for (const field of ["tier1Model", "tier2Model"] as const) {
        expect(p[field], `${p.name} ${field}`).toBeTruthy();
      }
      // Undeclared tiers fall back to the provider's own default.
      expect(p.tier1Model).toBe(p.defaultModel);
      expect(p.tier2Model).toBe(p.defaultModel);
    }
  });

  it("never resolves two providers to the same model", async () => {
    const r = await readProviderRouting();
    // Distinct ids per provider is what makes a fallback a real attempt rather than a replay.
    expect(new Set(r!.providers.map((p) => p.tier1Model)).size).toBe(r!.providers.length);
    expect(new Set(r!.providers.map((p) => p.tier2Model)).size).toBe(r!.providers.length);
  });

  it("applies a per-provider tier override to the resolved model", async () => {
    process.env["GROQ_TIER1_MODEL"] = "llama-3.3-70b-versatile";
    const r = await readProviderRouting();
    const groq = r!.providers.find((p) => p.name === "groq")!;
    expect(groq.tier1Model).toBe("llama-3.3-70b-versatile");
    // Only the overridden tier moves.
    expect(groq.tier2Model).toBe(groq.defaultModel);
  });

  it("reports the configured tier routes", async () => {
    const r = await readProviderRouting();
    expect(r!.routes.map((x) => x.tier)).toEqual(["tier1", "tier2"]);
    // Asserted as shape rather than as specific provider names: DEFAULT_TIER_CONFIG is operator-
    // editable configuration, and a test that pins it fails every time it is retuned without
    // anything having broken. What must hold is that every name resolves and the cap is respected.
    const known = new Set(r!.providers.map((p) => p.name));
    for (const route of r!.routes) {
      expect(known.has(route.primary), `${route.tier} primary "${route.primary}"`).toBe(true);
      expect(route.fallbacks.length).toBeLessThanOrEqual(2);
      for (const f of route.fallbacks)
        expect(known.has(f), `${route.tier} fallback "${f}"`).toBe(true);
      expect(route.fallbacks).not.toContain(route.primary);
    }
  });

  it("honours the tier route environment overrides", async () => {
    process.env["AI_TIER1_PRIMARY"] = "mistral";
    process.env["AI_TIER1_FALLBACKS"] = "groq, nvidia , openrouter";
    const r = await readProviderRouting();
    const t1 = r!.routes.find((x) => x.tier === "tier1")!;
    expect(t1.primary).toBe("mistral");
    // Trimmed, and capped at the two the config allows.
    expect(t1.fallbacks).toEqual(["groq", "nvidia"]);
  });

  it("reads the strategy", async () => {
    process.env["AI_PROVIDER_STRATEGY"] = "round-robin";
    expect((await readProviderRouting())!.strategy).toBe("round-robin");
    process.env["AI_PROVIDER_STRATEGY"] = "nonsense";
    expect((await readProviderRouting())!.strategy).toBe("priority");
  });
});

describe("readProviderEnvConfig", () => {
  it("keeps the fields the Settings form already edits", async () => {
    process.env["NVIDIA_BASE_URL"] = "https://integrate.api.nvidia.com/v1";
    process.env["NVIDIA_TIER1_MODEL"] = "nvidia/nemotron-3-super-120b-a12b";
    process.env["NVIDIA_API_KEY"] = "k";
    const cfg = await readProviderEnvConfig();
    expect(cfg.hasKey).toBe(true);
    expect(cfg.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
    expect(cfg.tier1Model).toBe("nvidia/nemotron-3-super-120b-a12b");
    expect(cfg.routing?.providers).toHaveLength(4);
  });

  it("counts any provider's key, and reports that provider's URL and models", async () => {
    // A Groq-only deployment used to read as "no key" everywhere and ran heuristics only.
    process.env["GROQ_API_KEY"] = "k";
    const cfg = await readProviderEnvConfig();
    expect(cfg.hasKey).toBe(true);
    expect(cfg.baseUrl).toBe("https://api.groq.com/openai/v1");
    expect(cfg.tier1Model).toBe("openai/gpt-oss-20b");
    // Groq has no dedicated translation model, so its tier-1 model translates.
    expect(cfg.translateModel).toBe("openai/gpt-oss-20b");
  });

  it("uses NVIDIA's own translation model when NVIDIA is first", async () => {
    process.env["NVIDIA_API_KEY"] = "k";
    process.env["GROQ_API_KEY"] = "k";
    const cfg = await readProviderEnvConfig();
    expect(cfg.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
    expect(cfg.translateModel).toBe("nvidia/riva-translate-4b-instruct-v2");
  });

  it("omits fields the environment does not set rather than sending empty strings", async () => {
    const cfg = await readProviderEnvConfig();
    expect(cfg.hasKey).toBe(false);
    expect(cfg.baseUrl).toBeUndefined();
    expect(cfg.tier1Model).toBeUndefined();
  });
});
