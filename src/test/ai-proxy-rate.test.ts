import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ChatInput } from "@/shared/infra/ai-proxy.server";

const INPUT: ChatInput = {
  baseUrl: "https://example.test/v1",
  apiKey: "test-key",
  model: "test-model",
  system: "sys",
  prompt: "prompt",
  json: false,
};

interface Stubbed {
  status: number;
  body: string;
  headers?: Record<string, string>;
}

const ok = (content: string): Stubbed => ({
  status: 200,
  body: JSON.stringify({ choices: [{ message: { content } }] }),
});

/** Provider responses returned in order; the last one repeats once exhausted. */
function stubFetch(responses: Stubbed[]) {
  let i = 0;
  const fn = vi.fn(async () => {
    const r = responses[Math.min(i, responses.length - 1)]!;
    i++;
    return new Response(r.body, { status: r.status, headers: r.headers ?? {} });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** Records the wall-clock time of each request start, for pacing assertions. */
function stubFetchTiming(responses: Stubbed[]) {
  const starts: number[] = [];
  let i = 0;
  const fn = vi.fn(async () => {
    starts.push(Date.now());
    const r = responses[Math.min(i, responses.length - 1)]!;
    i++;
    return new Response(r.body, { status: r.status, headers: r.headers ?? {} });
  });
  vi.stubGlobal("fetch", fn);
  return { fn, starts };
}

/**
 * Fresh module per test so the pacing slot and the RPM-derived spacing start clean.
 * Pacing is off by default here unless a test cares; retry tests are not slowed by it.
 */
async function loadTransport(rpm?: string) {
  vi.resetModules();
  if (rpm === undefined) delete process.env["PROVIDER_RPM"];
  else process.env["PROVIDER_RPM"] = rpm;
  const mod = await import("@/shared/infra/ai-proxy.server");
  return mod.chatCompletionOnce;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env["PROVIDER_RPM"];
});

describe("chatCompletionOnce retry", () => {
  it("retries a 429 and returns the eventual success", async () => {
    const fetchMock = stubFetch([{ status: 429, body: "rate limited" }, ok("recovered")]);
    const chat = await loadTransport("0");

    const p = chat(INPUT);
    await vi.advanceTimersByTimeAsync(60_000);
    const res = await p;

    expect(res).toEqual({ ok: true, content: "recovered" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("honours Retry-After instead of guessing", async () => {
    const { fn, starts } = stubFetchTiming([
      { status: 429, body: "slow down", headers: { "retry-after": "20" } },
      ok("recovered"),
    ]);
    const chat = await loadTransport("0");

    const p = chat(INPUT);
    await vi.advanceTimersByTimeAsync(60_000);
    await p;

    // Our own backoff for the first attempt is <= 1s, so only Retry-After can explain a
    // gap this large - it is the floor the wait was raised to.
    expect(fn).toHaveBeenCalledTimes(2);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(20_000);
  });

  it("reads Retry-After given as an HTTP date", async () => {
    const { starts } = stubFetchTiming([
      {
        status: 429,
        body: "slow down",
        headers: { "retry-after": new Date(Date.now() + 15_000).toUTCString() },
      },
      ok("recovered"),
    ]);
    const chat = await loadTransport("0");

    const p = chat(INPUT);
    await vi.advanceTimersByTimeAsync(60_000);
    await p;

    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(14_000);
  });

  it("gives up after a bounded number of attempts and reports the last error", async () => {
    const fetchMock = stubFetch([{ status: 429, body: "still limited" }]);
    const chat = await loadTransport("0");

    const p = chat(INPUT);
    await vi.advanceTimersByTimeAsync(120_000);
    const res = await p;

    expect(res.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    if (!res.ok) expect(res.error).toContain("429");
  });

  it("retries 5xx", async () => {
    const fetchMock = stubFetch([{ status: 503, body: "unavailable" }, ok("recovered")]);
    const chat = await loadTransport("0");

    const p = chat(INPUT);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await p).toEqual({ ok: true, content: "recovered" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a network-level failure", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new TypeError("fetch failed");
      return new Response(ok("recovered").body, { status: 200 });
    });
    vi.stubGlobal("fetch", fn);
    const chat = await loadTransport("0");

    const p = chat(INPUT);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await p).toEqual({ ok: true, content: "recovered" });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-retryable status", async () => {
    const fetchMock = stubFetch([{ status: 400, body: "bad request" }]);
    const chat = await loadTransport("0");

    const p = chat(INPUT);
    await vi.advanceTimersByTimeAsync(60_000);
    const res = await p;

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("400");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry an auth failure", async () => {
    const fetchMock = stubFetch([{ status: 401, body: "bad key" }]);
    const chat = await loadTransport("0");

    const p = chat(INPUT);
    await vi.advanceTimersByTimeAsync(60_000);
    await p;

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("chatCompletionOnce pacing", () => {
  it("spaces request starts so overlapping callers share the rate budget", async () => {
    const { fn, starts } = stubFetchTiming([ok("x")]);
    // 600 rpm => 100ms minimum spacing between starts.
    const chat = await loadTransport("600");

    const p = Promise.all([chat(INPUT), chat(INPUT), chat(INPUT)]);
    await vi.advanceTimersByTimeAsync(10_000);
    await p;

    expect(fn).toHaveBeenCalledTimes(3);
    // Concurrent callers each get their own slot rather than all firing at once.
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(100);
    }
  });

  it("pauses every caller sharing the key after a 429, not just the one that got it", async () => {
    const { fn, starts } = stubFetchTiming([
      { status: 429, body: "slow down", headers: { "retry-after": "20" } },
      ok("x"),
    ]);
    const chat = await loadTransport("0");

    const first = chat(INPUT);
    // Let the first request land and receive its 429 before the second caller arrives.
    await vi.advanceTimersByTimeAsync(1);
    const second = chat(INPUT);
    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.all([first, second]);

    expect(fn).toHaveBeenCalledTimes(3);
    // The second caller never got a 429 itself, yet waits out the provider's Retry-After.
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(20_000);
  });

  it("does not pace when disabled", async () => {
    const { starts } = stubFetchTiming([ok("x")]);
    const chat = await loadTransport("0");

    const p = Promise.all([chat(INPUT), chat(INPUT), chat(INPUT)]);
    await vi.advanceTimersByTimeAsync(1_000);
    await p;

    expect(starts.every((s) => s === starts[0])).toBe(true);
  });

  it("defaults to a spacing under the provider cap", async () => {
    const { starts } = stubFetchTiming([ok("x")]);
    const chat = await loadTransport(); // no override: default applies

    const p = Promise.all([chat(INPUT), chat(INPUT)]);
    await vi.advanceTimersByTimeAsync(60_000);
    await p;

    const gap = starts[1]! - starts[0]!;
    expect(gap).toBeGreaterThanOrEqual(1500); // >= the 35 rpm default
  });
});

describe("chatCompletionOnce request handling", () => {
  it("still rejects a non-https base url before any request", async () => {
    const fetchMock = stubFetch([ok("x")]);
    const chat = await loadTransport("0");

    await expect(chat({ ...INPUT, baseUrl: "http://example.test/v1" })).rejects.toThrow("https");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to reasoning_content when content is null", async () => {
    stubFetch([
      {
        status: 200,
        body: JSON.stringify({
          choices: [{ message: { content: null, reasoning_content: "from reasoning" } }],
        }),
      },
    ]);
    const chat = await loadTransport("0");

    const p = chat(INPUT);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await p).toEqual({ ok: true, content: "from reasoning" });
  });

  // Regression: the provider body was embedded verbatim in the error string, which lands in
  // dispatch `error` fields and the sources page - a place an upstream payload should not reach.
  it("does not echo the provider response body into the error", async () => {
    const secret = "sk-leaked-key-and-prompt-echo";
    stubFetch([{ status: 401, body: JSON.stringify({ detail: `invalid key ${secret}` }) }]);
    const chat = await loadTransport("0");

    const p = chat(INPUT);
    await vi.advanceTimersByTimeAsync(60_000);
    const res = await p;

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("401");
      expect(res.error).not.toContain(secret);
    }
  });

  it("sends an abort signal so a hung provider cannot stall the pass", async () => {
    const fn = vi.fn(async () => new Response(ok("x").body, { status: 200 }));
    vi.stubGlobal("fetch", fn);
    const chat = await loadTransport("0");

    const p = chat(INPUT);
    await vi.advanceTimersByTimeAsync(60_000);
    await p;

    const init = (fn.mock.calls[0] as unknown[] | undefined)?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("retries a timed-out request", async () => {
    const fn = vi.fn(async () => {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    });
    vi.stubGlobal("fetch", fn);
    const chat = await loadTransport("0");

    const p = chat(INPUT);
    await vi.advanceTimersByTimeAsync(120_000);
    const res = await p;

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Provider timeout");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
