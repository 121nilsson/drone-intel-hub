import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_PROVIDERS, getProviderModel, type AIProvider } from "@/shared/infra/ai-providers";

/**
 * getProviderModel is what makes a fallback chain a real fallback.
 *
 * A model id is namespaced to one provider's catalogue - `nvidia/nemotron-3-super-120b-a12b`
 * does not exist on Groq - so replaying a failed call's model against the next provider produces a
 * request that cannot succeed. That turns one provider outage into several doomed requests, each
 * with its own retry budget, before the pass gives up. These pin the resolution order.
 */

const provider = (over: Partial<AIProvider> & { name: string }): AIProvider => ({
  baseUrl: "https://example.test/v1",
  apiKeyEnv: "EXAMPLE_API_KEY",
  defaultModel: "vendor/default-model",
  priority: 10,
  enabled: true,
  ...over,
});

const ENV_KEYS = [
  "NVIDIA_TIER1_MODEL",
  "NVIDIA_TIER2_MODEL",
  "GROQ_TIER1_MODEL",
  "GROQ_TIER2_MODEL",
  "OPENROUTER_TIER1_MODEL",
  "MISTRAL_TIER2_MODEL",
];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("getProviderModel", () => {
  it("falls back to defaultModel when no tier model is set", () => {
    const p = provider({ name: "groq" });
    expect(getProviderModel(p, "tier1")).toBe("vendor/default-model");
    expect(getProviderModel(p, "tier2")).toBe("vendor/default-model");
  });

  it("uses the provider's own tier model when it declares one", () => {
    const p = provider({
      name: "groq",
      tier1Model: "openai/gpt-oss-20b",
      defaultModel: "vendor/other",
    });
    expect(getProviderModel(p, "tier1")).toBe("openai/gpt-oss-20b");
    // tier 2 is undeclared, so it must not borrow tier 1's.
    expect(getProviderModel(p, "tier2")).toBe("vendor/other");
  });

  it("keeps the two tiers independent", () => {
    const p = provider({ name: "x", tier1Model: "cheap/model", tier2Model: "big/model" });
    expect(getProviderModel(p, "tier1")).toBe("cheap/model");
    expect(getProviderModel(p, "tier2")).toBe("big/model");
  });

  it("prefers the environment override over the declared model", () => {
    const p = provider({ name: "groq", tier1Model: "openai/gpt-oss-20b" });
    process.env["GROQ_TIER1_MODEL"] = "llama-3.3-70b-versatile";
    expect(getProviderModel(p, "tier1")).toBe("llama-3.3-70b-versatile");
    // Untouched tiers still resolve normally.
    expect(getProviderModel(p, "tier2")).toBe("vendor/default-model");
  });

  it("ignores a blank override rather than sending an empty model", () => {
    const p = provider({ name: "groq", tier1Model: "openai/gpt-oss-20b" });
    process.env["GROQ_TIER1_MODEL"] = "   ";
    expect(getProviderModel(p, "tier1")).toBe("openai/gpt-oss-20b");
  });

  it("returns the default for an untiered call", () => {
    const p = provider({ name: "groq", tier1Model: "openai/gpt-oss-20b" });
    expect(getProviderModel(p)).toBe("vendor/default-model");
  });

  it("gives each built-in provider a model from its own catalogue", () => {
    // The whole point: no provider should be handed an id belonging to another. An id with a
    // namespace that does not match the provider is the exact failure being prevented.
    for (const p of BUILTIN_PROVIDERS) {
      for (const tier of ["tier1", "tier2"] as const) {
        const model = getProviderModel(p, tier);
        expect(model, `${p.name} ${tier}`).toBeTruthy();
        const namespace = model.includes("/") ? model.split("/")[0]!.toLowerCase() : null;
        // Not a hard rule for every vendor (mistral ids are bare, groq's are `openai/...`), but
        // the one that must never happen is another provider's namespace. NVIDIA's own catalogue
        // is namespaced `nvidia/`, so only the other providers are checked against it.
        if (p.name !== "nvidia")
          expect(namespace, `${p.name} ${tier} resolved to ${model}`).not.toBe("nvidia");
      }
    }
  });
});

describe("provider chain resolution", () => {
  it("gives every provider in the chain a distinct model where tier models differ", () => {
    // Mirrors the shipped configuration: NVIDIA serving a namespaced id, the fallbacks serving
    // their own. Before this change every provider received the NVIDIA id.
    const chain = ["nvidia", "groq", "openrouter", "mistral"].map((name) =>
      BUILTIN_PROVIDERS.find((p) => p.name === name)!,
    );
    const models = chain.map((p) => getProviderModel(p, "tier1"));
    expect(models).toEqual([
      "nvidia/nemotron-3-super-120b-a12b",
      "openai/gpt-oss-20b",
      "openrouter/free",
      "ministral-14b-2512",
    ]);
    expect(new Set(models).size).toBe(chain.length);
  });

  it("does not resolve two providers to the same model id", () => {
    const models = BUILTIN_PROVIDERS.map((p) => getProviderModel(p, "tier2"));
    expect(new Set(models).size).toBe(BUILTIN_PROVIDERS.length);
  });
});

// Silences an unused-import lint if the file is trimmed later.
void vi;
