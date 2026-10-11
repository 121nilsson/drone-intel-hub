import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Imported dynamically after the pacing environment is set: `MIN_SPACING_MS` is a module-level
 * constant read at import, so a beforeEach is too late and every call would sleep ~1.7s.
 */
process.env["PROVIDER_RPM"] = "0";
process.env["PROVIDER_TIMEOUT_MS"] = "0";
const { chatCompletionOnce, resetProviderState } = await import("@/shared/infra/ai-proxy.server");

/**
 * Provider error diagnostics.
 *
 * The reason a call failed is in the provider's response body, and throwing it away is what made
 * a chain failure read as "bad request (400)" with nothing to act on. These pin both halves of
 * the fix: that the explanation survives, and that a body which has echoed something sensitive
 * does not.
 */

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
];
const saved: Record<string, string | undefined> = {};

function setup() {
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env["NVIDIA_BASE_URL"] = "https://integrate.api.nvidia.com/v1";
  process.env["NVIDIA_API_KEY"] = "nv-secret-key-value-0123456789";
  process.env["GROQ_API_KEY"] = "gq-secret-key-value-9876543210";
}
function restore() {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

/** Collects what the transport logged, so the log content itself is under test. */
async function captureLogs(fn: () => Promise<unknown>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (...a: unknown[]) => {
    lines.push(a.map(String).join(" "));
  };
  try {
    await fn();
  } finally {
    console.warn = original;
  }
  return lines;
}

function stubFetch(
  respond: (host: string) => { status: number; statusText: string; body: string },
): void {
  void respond;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = new URL(String(url));
      const r = respond(u.host);
      return new Response(r.body, { status: r.status, statusText: r.statusText });
    }),
  );
}

// A 401 or 429 parks the provider for minutes; each test starts with every provider available.
beforeEach(() => {
  setup();
  resetProviderState();
});
afterEach(() => {
  restore();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const call = () =>
  chatCompletionOnce({
    model: "nvidia/nemotron-3-super-120b-a12b",
    tier: "tier1",
    system: "s",
    prompt: "p",
    json: true,
  });

describe("failure diagnostics", () => {
  it("logs which provider, host, model and tier was attempted", async () => {
    stubFetch(() => ({ status: 404, statusText: "Not Found", body: "{}" }));
    const logs = await captureLogs(call);

    const line = logs.find((l) => l.includes("gave up"))!;
    expect(line).toContain("nvidia");
    expect(line).toContain("integrate.api.nvidia.com");
    expect(line).toContain("model=nvidia/nemotron-3-super-120b-a12b");
    expect(line).toContain("tier=tier1");
  });

  it("surfaces the provider's own explanation", async () => {
    stubFetch(() => ({
      status: 400,
      statusText: "Bad Request",
      body: JSON.stringify({
        error: {
          message: "'messages' must contain the word 'json' to use response_format",
          type: "invalid_request_error",
        },
      }),
    }));
    const logs = await captureLogs(call);

    const line = logs.find((l) => l.includes("gave up"))!;
    expect(line).toContain("400");
    expect(line).toContain("must contain the word 'json'");
  });

  it("adds a hint about the usual cause of the status", async () => {
    stubFetch(() => ({ status: 400, statusText: "Bad Request", body: "{}" }));
    const logs = await captureLogs(call);

    expect(logs.some((l) => l.includes("model id is not on this provider"))).toBe(true);
  });

  it("logs the fall-through and the model the next provider will use", async () => {
    stubFetch((host) =>
      host === "integrate.api.nvidia.com"
        ? { status: 404, statusText: "Not Found", body: "{}" }
        : {
            status: 200,
            statusText: "OK",
            body: JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
          },
    );
    const logs = await captureLogs(call);

    const fall = logs.find((l) => l.includes("falling through"))!;
    expect(fall).toContain("nvidia failed");
    expect(fall).toContain("next: groq");
    // The whole point: the next provider is not handed the failed provider's model.
    expect(fall).toContain("openai/gpt-oss-20b");
    expect(fall).not.toContain("nemotron");
  });

  it("says which model the next provider will use", async () => {
    stubFetch((host) =>
      host === "integrate.api.nvidia.com"
        ? { status: 404, statusText: "Not Found", body: "{}" }
        : {
            status: 200,
            statusText: "OK",
            body: JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
          },
    );
    const logs = await captureLogs(call);

    const fall = logs.find((l) => l.includes("falling through"))!;
    // Every provider after the first gets its own model, so the line says so and names it.
    expect(fall).toContain("next: groq with its own tier1 model (openai/gpt-oss-20b)");
  });
});

describe("diagnostics never leak a credential", () => {
  const bodies = [
    JSON.stringify({ error: { message: "bad key sk-abcdefghijklmnopqrstuvwxyz012345" } }),
    JSON.stringify({ error: { message: "auth failed for Bearer gsk_ABCDEFGHIJKLMNOPQRSTUV" } }),
    JSON.stringify({ error: { message: "rejected nvapi-0123456789abcdefghijklmnopqrstuvwxyz" } }),
    // The provider echoing the key it was actually sent.
    JSON.stringify({ error: { message: "invalid api key: gq-secret-key-value-9876543210" } }),
    JSON.stringify({ error: { message: "token nv-secret-key-value-0123456789 rejected" } }),
  ];

  it("redacts vendor key shapes, bearer tokens and the configured keys themselves", async () => {
    for (const body of bodies) {
      resetProviderState();
      stubFetch(() => ({ status: 401, statusText: "Unauthorized", body }));
      const logs = await captureLogs(call);
      const line = logs.find((l) => l.includes("gave up"))!;

      expect(line).toContain("[redacted]");
      expect(line).not.toContain("abcdefghijklmnopqrstuvwxyz012345");
      expect(line).not.toContain("gq-secret-key-value");
      expect(line).not.toContain("nv-secret-key-value");
    }
  });

  it("redacts a long opaque run that is not a known key shape", async () => {
    stubFetch(() => ({
      status: 400,
      statusText: "Bad Request",
      body: JSON.stringify({
        error: { message: "context 7f3a9c1e5b2d8f4a6c0e2b9d7f1a3c5e8b2d4f6a0c is too long" },
      }),
    }));
    const logs = await captureLogs(call);
    const line = logs.find((l) => l.includes("gave up"))!;

    expect(line).toContain("[redacted]");
    expect(line).not.toContain("7f3a9c1e5b2d8f4a6c0e2b9d7f1a3c5e8b2d4f6a0c");
  });

  it("keeps the human part of a message while dropping the secret", async () => {
    stubFetch(() => ({
      status: 401,
      statusText: "Unauthorized",
      body: JSON.stringify({
        error: { message: "invalid api key gsk_ABCDEFGHIJKLMNOPQRSTUV for this project" },
      }),
    }));
    const logs = await captureLogs(call);
    const line = logs.find((l) => l.includes("gave up"))!;

    expect(line).toContain("for this project");
    expect(line).toContain("[redacted]");
  });

  it("caps an enormous provider message", async () => {
    stubFetch(() => ({
      status: 400,
      statusText: "Bad Request",
      body: JSON.stringify({ error: { message: "x".repeat(5000) } }),
    }));
    const logs = await captureLogs(call);
    const line = logs.find((l) => l.includes("gave up"))!;

    expect(line.length).toBeLessThan(500);
  });

  it("falls back cleanly when the body is not JSON", async () => {
    // 502 is retryable, so this pays the real backoff before giving up - which is the point:
    // an HTML error page from a gateway is the common non-JSON case.
    stubFetch(() => ({
      status: 502,
      statusText: "Bad Gateway",
      body: "<html><body>upstream error</body></html>",
    }));
    const logs = await captureLogs(call);

    const line = logs.find((l) => l.includes("gave up"))!;
    expect(line).toContain("502");
    // Markup is not worth surfacing, and must not be dumped raw.
    expect(line).not.toContain("<html>");
  }, 20000);
});
