import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The behaviour asked for: when the first provider's model fails, the next provider in line is
 * sent a model it actually serves, for the same tier.
 *
 * `fetch` is stubbed rather than mocked at the module boundary, so the real pacing, retry and
 * status-error paths run - only the network stops. That is deliberate: the bug this guards against
 * was never in model selection, it was in which model reached the wire.
 *
 * The transport is imported dynamically, AFTER the pacing environment is set. `MIN_SPACING_MS`,
 * `rpm` and `timeoutMs` are module-level constants read at import, so setting them in a
 * beforeEach is too late - the module would keep the developer's 35 RPM and every test would sleep
 * for a second and a half per call. ai-providers.ts reads its own environment per call, which is
 * why the keys below can still be controlled per test.
 */
process.env["PROVIDER_RPM"] = "0";
process.env["PROVIDER_TIMEOUT_MS"] = "0";
const { chatCompletionOnce, resetProviderState } = await import("@/shared/infra/ai-proxy.server");

const ENV = [
  "NVIDIA_API_KEY",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "MISTRAL_API_KEY",
  "NVIDIA_BASE_URL",
  "AI_TIER1_PRIMARY",
  "AI_TIER2_PRIMARY",
  "AI_TIER1_FALLBACKS",
  "AI_TIER2_FALLBACKS",
  // Per-provider tier overrides, which a test below sets and which must not leak into the next.
  "NVIDIA_TIER1_MODEL",
  "NVIDIA_TIER2_MODEL",
  "GROQ_TIER1_MODEL",
  "GROQ_TIER2_MODEL",
  "OPENROUTER_TIER1_MODEL",
  "MISTRAL_TIER1_MODEL",
  "MISTRAL_TIER2_MODEL",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  resetProviderState();
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  // Pinned so the host assertions below do not depend on the built-in default, which is a
  // different hostname from the one this deployment actually uses.
  process.env["NVIDIA_BASE_URL"] = "https://integrate.api.nvidia.com/v1";
});

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Records what each provider was actually asked for, and fails the ones we want to fail. */
function stubFetch(fail: (host: string, model: string) => boolean) {
  const seen: { host: string; model: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: { headers?: Record<string, string>; body?: string }) => {
      const u = new URL(String(url));
      const body = JSON.parse(init?.body ?? "{}") as { model: string };
      seen.push({ host: u.host, model: body.model });

      if (fail(u.host, body.model)) {
        // 404 is terminal (not retryable), so the chain moves on immediately rather than
        // burning three attempts - which is exactly the shape of the old bug.
        return new Response("no such model", { status: 404, statusText: "Not Found" });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return seen;
}

describe("fallback chain sends each provider its own model", () => {
  it("gives the first provider the configured model, then per-provider models", async () => {
    process.env["NVIDIA_API_KEY"] = "k-nv";
    process.env["GROQ_API_KEY"] = "k-gq";
    process.env["OPENROUTER_API_KEY"] = "k-or";

    // NVIDIA fails for the namespaced id it was configured with; everything else answers.
    const seen = stubFetch((host) => host === "integrate.api.nvidia.com");

    const r = await chatCompletionOnce({
      model: "nvidia/nemotron-3-super-120b-a12b",
      tier: "tier1",
      system: "s",
      prompt: "p",
      json: true,
    });

    expect(r.ok).toBe(true);
    expect(r.provider).toBe("groq");
    // The result names what answered: the fallback's own model, not the configured NVIDIA id.
    expect(r).toMatchObject({ model: "openai/gpt-oss-20b" });
    expect(seen.map((s) => `${s.host}|${s.model}`)).toEqual([
      // First: exactly what the operator configured, unchanged.
      "integrate.api.nvidia.com|nvidia/nemotron-3-super-120b-a12b",
      // Fallback: Groq's own tier-1 model, NOT the NVIDIA id that just failed.
      "api.groq.com|openai/gpt-oss-20b",
    ]);
  });

  it("keeps the tier distinct: a tier-2 fallback asks for a tier-2 model", async () => {
    process.env["NVIDIA_API_KEY"] = "k-nv";
    process.env["MISTRAL_API_KEY"] = "k-ms";

    const seen = stubFetch((host) => host === "integrate.api.nvidia.com");

    const r = await chatCompletionOnce({
      model: "meta/muse-glimmer-30b",
      tier: "tier2",
      system: "s",
      prompt: "p",
      json: false,
    });

    expect(r.ok).toBe(true);
    expect(seen[1]).toEqual({ host: "api.mistral.ai", model: "ministral-14b-2512" });
  });

  it("honours a per-provider tier override from the environment", async () => {
    process.env["NVIDIA_API_KEY"] = "k-nv";
    process.env["GROQ_API_KEY"] = "k-gq";
    process.env["GROQ_TIER1_MODEL"] = "llama-3.3-70b-versatile";

    const seen = stubFetch((host) => host === "integrate.api.nvidia.com");

    await chatCompletionOnce({
      model: "nvidia/nemotron-3-super-120b-a12b",
      tier: "tier1",
      system: "s",
      prompt: "p",
      json: true,
    });

    expect(seen[1]).toEqual({ host: "api.groq.com", model: "llama-3.3-70b-versatile" });
  });

  it("walks the whole chain and reports every model it tried", async () => {
    process.env["NVIDIA_API_KEY"] = "k-nv";
    process.env["GROQ_API_KEY"] = "k-gq";
    process.env["OPENROUTER_API_KEY"] = "k-or";
    process.env["MISTRAL_API_KEY"] = "k-ms";

    // Everything fails: a total outage is the case the old code was worst at.
    stubFetch(() => true);

    const r = await chatCompletionOnce({
      model: "nvidia/nemotron-3-super-120b-a12b",
      tier: "tier1",
      system: "s",
      prompt: "p",
      json: true,
    });

    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected every provider to fail");
    // The error names provider AND model, so a wired-wrong chain is diagnosable from the log.
    expect(r.error).toContain("nvidia:nvidia/nemotron-3-super-120b-a12b");
    expect(r.error).toContain("groq:openai/gpt-oss-20b");
    expect(r.error).toContain("openrouter:openrouter/free");
    expect(r.error).toContain("mistral:ministral-14b-2512");
  });

  it("uses a single provider unchanged when only one key is configured", async () => {
    process.env["NVIDIA_API_KEY"] = "k-nv";
    const seen = stubFetch(() => false);

    const r = await chatCompletionOnce({
      model: "nvidia/nemotron-3-super-120b-a12b",
      tier: "tier1",
      system: "s",
      prompt: "p",
      json: true,
    });

    expect(r.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.model).toBe("nvidia/nemotron-3-super-120b-a12b");
  });

  it("routes tier 1 to NVIDIA, not to the tier-1 route primary", async () => {
    // DEFAULT_TIER_CONFIG names groq as the tier-1 primary, from when tier 1 was expected to be
    // served by Groq. Honouring it would move tier-1 extraction off the configured model, so the
    // chain is priority order and the routes stay configuration only. With NVIDIA healthy the
    // chain must therefore stop there - a groq-first route would show up as a groq call.
    process.env["NVIDIA_API_KEY"] = "k-nv";
    process.env["GROQ_API_KEY"] = "k-gq";
    const seen = stubFetch(() => false);

    await chatCompletionOnce({
      model: "nvidia/nemotron-3-super-120b-a12b",
      tier: "tier1",
      system: "s",
      prompt: "p",
      json: true,
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.host).toBe("integrate.api.nvidia.com");
    expect(seen[0]!.model).toBe("nvidia/nemotron-3-super-120b-a12b");
  });

  it("does not reorder when a caller pins a specific provider", async () => {
    process.env["NVIDIA_API_KEY"] = "k-nv";
    process.env["GROQ_API_KEY"] = "k-gq";
    const seen = stubFetch((host) => host === "api.groq.com");

    const r = await chatCompletionOnce({
      provider: "groq",
      model: "nvidia/nemotron-3-super-120b-a12b",
      tier: "tier1",
      system: "s",
      prompt: "p",
      json: true,
    });

    // A pinned provider that fails must not silently fall through to another one.
    expect(r.ok).toBe(false);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.host).toBe("api.groq.com");
  });
});

describe("a provider that cannot be reached is left after one attempt", () => {
  it("falls through on a transport failure instead of spending the retry budget on a dead socket", async () => {
    process.env["NVIDIA_API_KEY"] = "k-nv";
    process.env["GROQ_API_KEY"] = "k-gq";
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const host = new URL(String(url)).host;
        seen.push(host);
        if (host === "integrate.api.nvidia.com") throw new TypeError("fetch failed");
        return new Response(
          JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }),
    );

    const r = await chatCompletionOnce({
      model: "nvidia/nemotron-3-super-120b-a12b",
      tier: "tier1",
      system: "s",
      prompt: "p",
      json: true,
    });

    expect(r).toMatchObject({ ok: true, provider: "groq" });
    // One attempt against the unreachable host, not three: a refuted socket is not worth
    // retrying while the next provider waits.
    expect(seen).toEqual(["integrate.api.nvidia.com", "api.groq.com"]);
  });
});

/**
 * The quick-paste path end to end: OpenAICompatibleExtractor -> the shared transport -> the
 * chain. The browser reaches the transport through the `chatCompletion` server function, whose
 * handler is `chatCompletionOnce`, so passing the transport directly exercises the same code with
 * the same environment - which is what makes this worth asserting rather than assuming.
 */
describe("the extractor declares its tier, so a fallback serves a tier-appropriate model", () => {
  it("sends the tier-2 model and falls back with a tier-2 provider model", async () => {
    process.env["NVIDIA_API_KEY"] = "k-nv";
    process.env["GROQ_API_KEY"] = "k-gq";
    const seen = stubFetch((host) => host === "integrate.api.nvidia.com");

    const { OpenAICompatibleExtractor } = await import("@/shared/infra/openai-compatible-ai");
    const extractor = new OpenAICompatibleExtractor(
      2,
      {
        baseUrl: "https://integrate.api.nvidia.com/v1",
        apiKey: "",
        tier1Model: "nvidia/nemotron-3-super-120b-a12b",
        tier2Model: "meta/muse-glimmer-30b",
        translateModel: "",
        escalationThreshold: 0.6,
        autoMergeThreshold: 0.85,
        autoPromoteThreshold: 0.9,
        autoDiscardThreshold: 0.25,
        heuristicFirst: true,
      },
      chatCompletionOnce,
    );

    // Whatever the model says, the assertion is about what went on the wire.
    await extractor.extract("a report", []).catch(() => undefined);

    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual({ host: "integrate.api.nvidia.com", model: "meta/muse-glimmer-30b" });
    expect(seen[1]).toEqual({ host: "api.groq.com", model: "openai/gpt-oss-20b" });
  });

  it("records the model that actually served, not the configured one, in the metadata", async () => {
    process.env["NVIDIA_API_KEY"] = "k-nv";
    process.env["GROQ_API_KEY"] = "k-gq";
    stubFetch((host) => host === "integrate.api.nvidia.com");

    const { OpenAICompatibleExtractor } = await import("@/shared/infra/openai-compatible-ai");
    const extractor = new OpenAICompatibleExtractor(
      1,
      {
        baseUrl: "https://integrate.api.nvidia.com/v1",
        apiKey: "",
        tier1Model: "nvidia/nemotron-3-super-120b-a12b",
        tier2Model: "meta/muse-glimmer-30b",
        translateModel: "",
        escalationThreshold: 0.6,
        autoMergeThreshold: 0.85,
        autoPromoteThreshold: 0.9,
        autoDiscardThreshold: 0.25,
        heuristicFirst: true,
      },
      chatCompletionOnce,
    );

    const result = await extractor.extract("a report", []);

    // Provenance: NVIDIA 404'd, Groq answered - the extraction is Groq's, not NVIDIA's.
    expect(result.metadata?.model).toBe("openai/gpt-oss-20b");
  });
});
