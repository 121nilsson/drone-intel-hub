import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What happens when providers run out: a non-JSON reply moves on to the next provider, a 429
 * falls through at once and parks that provider, a config error (a model the provider does not
 * have) parks that model rather than being re-paid on every document, a chain where everyone is
 * refusing reports an outage (so a queue keeps the post pending), and the server's key never
 * follows a base URL the caller chose.
 *
 * Pacing and the timeout are module constants read at import, hence the dynamic import below.
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
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  resetProviderState();
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env["NVIDIA_BASE_URL"] = "https://integrate.api.nvidia.com/v1";
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Reply = {
  status: number;
  content?: string;
  headers?: Record<string, string>;
  /** The provider's own `error.message`, for tests about what a failure explanation says. */
  message?: string;
};

/** Answers per host; records host and Authorization header of every request. */
function stubHosts(byHost: Record<string, Reply>) {
  const seen: { host: string; auth: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: { headers?: Record<string, string> }) => {
      const host = new URL(String(url)).host;
      seen.push({ host, auth: init?.headers?.["Authorization"] ?? "" });
      const r = byHost[host] ?? { status: 200, content: '{"ok":true}' };
      const body =
        r.status === 200
          ? JSON.stringify({ choices: [{ message: { content: r.content ?? "" } }] })
          : JSON.stringify({ error: { message: r.message ?? `status ${r.status}` } });
      return new Response(body, { status: r.status, headers: r.headers ?? {} });
    }),
  );
  return seen;
}

const call = (over: Record<string, unknown> = {}) =>
  chatCompletionOnce({
    model: "nvidia/nemotron-3-super-120b-a12b",
    tier: "tier1",
    system: "s",
    prompt: "p",
    json: true,
    ...over,
  });

describe("the server key never follows a caller-chosen base URL", () => {
  it("ignores baseUrl when the server supplies the key (single provider)", async () => {
    process.env["NVIDIA_API_KEY"] = "k-nv";
    const seen = stubHosts({});

    await call({ baseUrl: "https://attacker.example/v1" });

    expect(seen.map((s) => s.host)).toEqual(["integrate.api.nvidia.com"]);
  });

  it("ignores baseUrl on a pinned provider too", async () => {
    process.env["NVIDIA_API_KEY"] = "k-nv";
    process.env["GROQ_API_KEY"] = "k-gq";
    const seen = stubHosts({});

    await call({ provider: "groq", baseUrl: "https://attacker.example/v1" });

    expect(seen.map((s) => s.host)).toEqual(["api.groq.com"]);
  });

  it("still honours baseUrl together with the caller's own key", async () => {
    const seen = stubHosts({});

    await call({ apiKey: "browser-key", baseUrl: "https://self-hosted.example/v1" });

    expect(seen).toEqual([{ host: "self-hosted.example", auth: "Bearer browser-key" }]);
  });
});

describe("an unusable reply falls through to the next provider", () => {
  it("moves on when a 200 carries no JSON object", async () => {
    process.env["NVIDIA_API_KEY"] = "k-nv";
    process.env["GROQ_API_KEY"] = "k-gq";
    const seen = stubHosts({
      "integrate.api.nvidia.com": { status: 200, content: "I cannot help with that." },
    });

    const r = await call();

    expect(r).toMatchObject({ ok: true, provider: "groq" });
    expect(seen.map((s) => s.host)).toEqual(["integrate.api.nvidia.com", "api.groq.com"]);
  });

  it("returns clean JSON from a fenced reply with a think block", async () => {
    process.env["NVIDIA_API_KEY"] = "k-nv";
    stubHosts({
      "integrate.api.nvidia.com": {
        status: 200,
        content: '<think>the user wants {json}</think>\n```json\n{"name":"Geran-2"}\n```',
      },
    });

    const r = await call();

    expect(r).toEqual({
      ok: true,
      content: '{"name":"Geran-2"}',
      model: "nvidia/nemotron-3-super-120b-a12b",
    });
  });

  it("is not an outage when the only failure was the reply", async () => {
    process.env["NVIDIA_API_KEY"] = "k-nv";
    process.env["GROQ_API_KEY"] = "k-gq";
    stubHosts({
      "integrate.api.nvidia.com": { status: 429 },
      "api.groq.com": { status: 400 },
    });

    const r = await call();

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.outage).toBe(false);
  });
});

describe("a provider out of quota is skipped, not retried on every call", () => {
  it("falls through after a single 429 and parks that provider", async () => {
    process.env["NVIDIA_API_KEY"] = "k-nv";
    process.env["GROQ_API_KEY"] = "k-gq";
    const seen = stubHosts({ "integrate.api.nvidia.com": { status: 429 } });

    const first = await call();
    const second = await call();

    expect(first).toMatchObject({ ok: true, provider: "groq" });
    expect(second).toMatchObject({ ok: true, provider: "groq" });
    // One NVIDIA request in total: no retries while Groq was waiting, none while cooling down.
    expect(seen.map((s) => s.host)).toEqual([
      "integrate.api.nvidia.com",
      "api.groq.com",
      "api.groq.com",
    ]);
  });

  it("asks the fallback for its own model while the primary cools down", async () => {
    process.env["NVIDIA_API_KEY"] = "k-nv";
    process.env["GROQ_API_KEY"] = "k-gq";
    const models: string[] = [];
    stubHosts({ "integrate.api.nvidia.com": { status: 402 } });
    const inner = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string | URL, init?: { body?: string; headers?: Record<string, string> }) => {
          models.push((JSON.parse(init?.body ?? "{}") as { model: string }).model);
          return inner(url, init as RequestInit);
        },
      ),
    );

    await call();
    await call();

    expect(models).toEqual([
      "nvidia/nemotron-3-super-120b-a12b",
      "openai/gpt-oss-20b",
      "openai/gpt-oss-20b",
    ]);
  });

  it("reports an outage when every provider refuses, then answers without a request", async () => {
    process.env["NVIDIA_API_KEY"] = "k-nv";
    process.env["GROQ_API_KEY"] = "k-gq";
    const seen = stubHosts({
      "integrate.api.nvidia.com": { status: 429, headers: { "retry-after": "3600" } },
      "api.groq.com": { status: 402 },
    });

    const first = await call();
    const second = await call();

    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.outage).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.outage).toBe(true);
      expect(second.error).toContain("Cooling down");
    }
    expect(seen).toHaveLength(2);
  });
});

describe("cooldown scope", () => {
  it("parks only the model that hit a 429, not the provider's other models", async () => {
    process.env["GROQ_API_KEY"] = "k-gq";
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL, init?: { body?: string }) => {
        calls++;
        const model = (JSON.parse(init?.body ?? "{}") as { model: string }).model;
        return model === "qwen/qwen3.8-27b"
          ? new Response("{}", { status: 429, headers: { "retry-after": "0" } })
          : new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
      }),
    );
    // Groq alone is single-provider mode, so the 429 is retried before giving up.
    vi.useFakeTimers();
    const limited = call({ model: "qwen/qwen3.8-27b" });
    await vi.advanceTimersByTimeAsync(120_000);
    expect((await limited).ok).toBe(false);
    vi.useRealTimers();

    const before = calls;
    expect(await call({ model: "qwen/qwen3.8-27b" })).toMatchObject({ ok: false, outage: true });
    expect(calls).toBe(before);
    expect(await call({ model: "openai/gpt-oss-120b" })).toMatchObject({ ok: true });
  });

  it("parks the whole provider when its key is rejected", async () => {
    process.env["GROQ_API_KEY"] = "k-gq";
    stubHosts({ "api.groq.com": { status: 401 } });
    await call({ model: "qwen/qwen3.8-27b" });
    expect(await call({ model: "openai/gpt-oss-120b" })).toMatchObject({ ok: false, outage: true });
  });

  it("parks the model after a 404, since a missing model id never becomes right", async () => {
    process.env["NVIDIA_API_KEY"] = "k-nv";
    process.env["GROQ_API_KEY"] = "k-gq";
    const seen = stubHosts({ "integrate.api.nvidia.com": { status: 404 } });

    expect(await call()).toMatchObject({ ok: true, provider: "groq" });
    expect(await call()).toMatchObject({ ok: true, provider: "groq" });

    // One NVIDIA request in total: the 404 is a config error, not something the next post fixes.
    expect(seen.map((s) => s.host)).toEqual([
      "integrate.api.nvidia.com",
      "api.groq.com",
      "api.groq.com",
    ]);
  });

  it("parks the model when a 400's own message names the missing model", async () => {
    process.env["NVIDIA_API_KEY"] = "k-nv";
    process.env["GROQ_API_KEY"] = "k-gq";
    const seen = stubHosts({
      "integrate.api.nvidia.com": {
        status: 400,
        message: "The model `nvidia/retil-70b` does not exist",
      },
    });

    expect(await call()).toMatchObject({ ok: true, provider: "groq" });
    expect(await call()).toMatchObject({ ok: true, provider: "groq" });

    expect(seen.map((s) => s.host)).toEqual([
      "integrate.api.nvidia.com",
      "api.groq.com",
      "api.groq.com",
    ]);
  });

  it("leaves a 400 about this request alone, since the next document may be fine", async () => {
    process.env["NVIDIA_API_KEY"] = "k-nv";
    process.env["GROQ_API_KEY"] = "k-gq";
    const seen = stubHosts({
      "integrate.api.nvidia.com": {
        status: 400,
        message: "'messages' must contain the word 'json' to use response_format",
      },
    });

    await call();
    await call();

    // NVIDIA is asked both times: one request the provider refused did not condemn a model.
    expect(seen.map((s) => s.host)).toEqual([
      "integrate.api.nvidia.com",
      "api.groq.com",
      "integrate.api.nvidia.com",
      "api.groq.com",
    ]);
  });
});
