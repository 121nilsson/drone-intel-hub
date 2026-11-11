import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchOne } from "@/shared/infra/sources/fetch-posts";

const RSS = `<rss><channel><item><title>Shahed strike</title><link>https://x.test/a</link>
  <description>A long enough report body about the drone attack that passes the length filter.</description>
</item></channel></rss>`;

const SOURCE = { platform: "RSS" as const, handle: "https://x.test/feed" };

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("source fetch retry", () => {
  it("retries once after a 503 and returns the posts from the second try", async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response(RSS, { status: 200 }));
    vi.stubGlobal("fetch", fn);

    const result = fetchOne(SOURCE);
    await vi.runAllTimersAsync();
    const r = await result;

    expect(fn).toHaveBeenCalledTimes(2);
    if (!r.ok) throw new Error(r.error);
    expect(r.posts).toHaveLength(1);
  });

  it("does not retry a 404, since the source has answered", async () => {
    const fn = vi.fn(() => Promise.resolve(new Response("", { status: 404 })));
    vi.stubGlobal("fetch", fn);

    const result = fetchOne(SOURCE);
    await vi.runAllTimersAsync();
    const r = await result;

    expect(fn).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ ok: false, error: "HTTP 404" });
  });

  it("makes one retry after two timeouts, then reports the timeout", async () => {
    const fn = vi.fn(() => {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      return Promise.reject(err);
    });
    vi.stubGlobal("fetch", fn);

    const result = fetchOne(SOURCE);
    await vi.runAllTimersAsync();
    const r = await result;

    expect(fn).toHaveBeenCalledTimes(2);
    expect(r).toEqual({ ok: false, error: "Fetch timeout" });
  });
});
