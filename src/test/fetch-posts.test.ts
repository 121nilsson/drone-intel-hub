import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchOne } from "@/shared/infra/fetch-posts";

const ok = (body: string, status = 200) => Promise.resolve(new Response(body, { status }));

afterEach(() => vi.unstubAllGlobals());

describe("fetchOne", () => {
  it("rejects X without a network call", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const r = await fetchOne({ platform: "X", handle: "someone" });
    expect(r.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects a non-https URL without a network call", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const r = await fetchOne({ platform: "Web", handle: "http://example.com" });
    expect(r).toEqual({ ok: false, error: "URL must start with https://" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects a malformed Telegram handle without a network call", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const r = await fetchOne({ platform: "Telegram", handle: "@no" });
    expect(r.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("unwraps CDATA before stripping tags", async () => {
    // Regression: CDATA wrappers used to be eaten by the tag-stripping regex, so every
    // CDATA-wrapped feed (the common RSS shape) returned zero posts.
    const xml = `<?xml version="1.0"?><rss><channel>
      <item>
        <title><![CDATA[Shahed-136 strike on Odesa]]></title>
        <link>https://x.test/cdata</link>
        <guid isPermaLink="true">https://x.test/cdata</guid>
        <description><![CDATA[A long enough report body about the drone attack to pass the filter.]]></description>
      </item>
    </channel></rss>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => ok(xml)),
    );
    const r = await fetchOne({ platform: "RSS", handle: "https://x.test/feed" });
    if (!r.ok) throw new Error(r.error);
    expect(r.posts).toHaveLength(1);
    expect(r.posts[0]?.text).toContain("Shahed-136 strike on Odesa");
    expect(r.posts[0]?.text).toContain("long enough report body");
    expect(r.posts[0]?.text).not.toContain("CDATA");
  });

  it("parses RSS items and skips short bodies", async () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item><title>Shahed drone strike</title><description>A long enough report body about the drone attack that passes the length filter.</description><link>https://x.test/a</link><pubDate>Mon, 06 Oct 2026 10:00:00 GMT</pubDate></item>
      <item><title>tiny</title><description>short</description><link>https://x.test/b</link></item>
    </channel></rss>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => ok(xml)),
    );
    const r = await fetchOne({ platform: "RSS", handle: "https://x.test/feed" });
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.posts).toHaveLength(1);
    expect(r.posts[0]?.url).toBe("https://x.test/a");
    expect(r.posts[0]?.id).toMatch(/^rss:/);
    expect(r.posts[0]?.text).toContain("Shahed");
  });

  it("auto-detects a feed served under the Web platform", async () => {
    const xml = `<feed><entry><title>Geran-2 deployment noted</title><summary>A sufficiently long summary about the Geran-2 interceptor to pass filtering.</summary></entry></feed>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => ok(xml)),
    );
    const r = await fetchOne({ platform: "Web", handle: "https://x.test/atom" });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.posts[0]?.text).toContain("Geran-2");
  });

  it("extracts anchor text from a plain page", async () => {
    const html = `<html><body>
      <a href="/story">This is a headline long enough to be considered a real post here</a>
      <a href="/tiny">short</a>
    </body></html>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => ok(html)),
    );
    const r = await fetchOne({ platform: "Web", handle: "https://x.test/news" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.posts).toHaveLength(1);
    expect(r.posts[0]?.url).toBe("https://x.test/story");
  });

  it("parses Telegram message widgets", async () => {
    const html = `<div class="tgme_widget_message_wrap" data-post="chan/12">
        <div class="tgme_widget_message_text">A drone related message that is definitely long enough</div>
        <time datetime="2026-10-06T09:00:00+00:00"></time>
      </div>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => ok(html)),
    );
    const r = await fetchOne({ platform: "Telegram", handle: "@chan" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.posts[0]?.id).toBe("tg:chan/12");
    expect(r.posts[0]?.url).toBe("https://t.me/chan/12");
  });

  it("surfaces a non-OK status as an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => ok("", 503)),
    );
    const r = await fetchOne({ platform: "RSS", handle: "https://x.test/feed" });
    expect(r).toEqual({ ok: false, error: "HTTP 503" });
  });

  it("converts a thrown fetch into an error result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );
    const r = await fetchOne({ platform: "RSS", handle: "https://x.test/feed" });
    expect(r).toEqual({ ok: false, error: "network down" });
  });
});

// ---------------------------------------------------------------- fetch options

const ARTICLE_HTML = `<!doctype html><html><head><title>Shahed strike</title></head><body>
  <nav><a href="/a">Home</a><a href="/b">About us</a><a href="/c">Contact page</a></nav>
  <article>
    <h1>Shahed strike on Odesa</h1>
    <p>${"A long report on the strike with plenty of technical detail for the reader to read. ".repeat(12)}</p>
    <p>${"The following paragraph continues the report about the drone strike in this article. ".repeat(12)}</p>
  </article>
  <footer><a href="/x">Privacy</a></footer>
</body></html>`;

const INDEX_HTML = `<html><body>
  <a href="/story-1">First headline about a drone strike in Odesa region yesterday</a>
  <a href="/story-2">Second headline about new loitering munitions delivered to front line</a>
  <a href="/story-3">Third headline about interceptor drones engaging enemy reconnaissance UAVs</a>
  <a href="/story-4">Fourth headline about electronic warfare units reporting jammed frequencies</a>
</body></html>`;

const bodyOf = (n: number) =>
  `${"Detailed article body text describing the events in full detail here. ".repeat(n)}`;

/**
 * Extractor stub keyed by URL: a body for article pages, null for anything else. Without this, an
 * index page looks like an article and the anchor path never runs, which is exactly the branch most
 * of these cases are about.
 */
const bodiesByUrl = (bodies: Record<string, string>) => async (_html: string, url: string) =>
  bodies[url] ?? null;

/** One URL -> one response, so follow-ups can be stubbed per link. */
function stubRoutes(routes: Record<string, () => Response>) {
  const fn = vi.fn((url: string) => {
    const r = routes[url];
    if (!r) return Promise.resolve(new Response("not found", { status: 404 }));
    return Promise.resolve(r());
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("fetchOne fetch options", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends an abort signal so a hung source cannot stall a pass", async () => {
    const fn = vi.fn(() => Promise.resolve(new Response("<rss></rss>", { status: 200 })));
    vi.stubGlobal("fetch", fn);
    await fetchOne({ platform: "RSS", handle: "https://x.test/feed" }, { timeoutMs: 5000 });

    const init = (fn.mock.calls[0] as unknown[] | undefined)?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("classifies a timeout as a fetch timeout, not the platform's wording", async () => {
    vi.stubGlobal("fetch", () => {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      return Promise.reject(err);
    });
    const r = await fetchOne({ platform: "RSS", handle: "https://x.test/feed" });
    expect(r).toEqual({ ok: false, error: "Fetch timeout" });
  });

  it("still surfaces a network failure verbatim", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    const r = await fetchOne({ platform: "Web", handle: "https://x.test/page" });
    expect(r).toEqual({ ok: false, error: "fetch failed" });
  });

  it("omits the signal entirely when the timeout is disabled", async () => {
    const fn = vi.fn(() => Promise.resolve(new Response("<rss></rss>", { status: 200 })));
    vi.stubGlobal("fetch", fn);
    await fetchOne({ platform: "RSS", handle: "https://x.test/feed" }, { timeoutMs: 0 });

    const init = (fn.mock.calls[0] as unknown[] | undefined)?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeUndefined();
  });

  it("keeps the Telegram status wording and its transport message", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("", { status: 503 })));
    const http = await fetchOne({ platform: "Telegram", handle: "@chan" });
    expect(http).toEqual({ ok: false, error: "Telegram 503" });

    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    const transport = await fetchOne({ platform: "Telegram", handle: "@chan" });
    expect(transport).toEqual({ ok: false, error: "fetch failed" });
  });

  it("returns the article body for a page that is one", async () => {
    stubRoutes({ "https://x.test/story": () => new Response(ARTICLE_HTML, { status: 200 }) });
    const r = await fetchOne(
      { platform: "Web", handle: "https://x.test/story" },
      { articleText: async () => bodyOf(20) },
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.posts).toHaveLength(1);
    expect(r.posts[0]!.id).toBe("web:https://x.test/story");
    expect(r.posts[0]!.text).toBe(bodyOf(20));
    expect(r.posts[0]!.text.length).toBeGreaterThan(400);
  });

  it("keeps every headline on an index page and enriches the first few", async () => {
    stubRoutes({
      "https://x.test/news": () => new Response(INDEX_HTML, { status: 200 }),
      "https://x.test/story-1": () => new Response("<article>1</article>", { status: 200 }),
      "https://x.test/story-2": () => new Response("<article>2</article>", { status: 200 }),
      "https://x.test/story-3": () => new Response("<article>3</article>", { status: 200 }),
      "https://x.test/story-4": () => new Response("<article>4</article>", { status: 200 }),
    });
    const r = await fetchOne(
      { platform: "Web", handle: "https://x.test/news" },
      {
        articleText: bodiesByUrl({
          "https://x.test/story-1": bodyOf(20),
          "https://x.test/story-2": bodyOf(20),
          "https://x.test/story-3": bodyOf(20),
        }),
      },
    );
    if (!r.ok) throw new Error(r.error);

    expect(r.posts).toHaveLength(4);
    // The first three got their bodies, keyed by their own URL, so ids still dedupe.
    expect(r.posts[0]!.id).toBe("web:https://x.test/story-1");
    expect(r.posts[0]!.text.length).toBeGreaterThan(400);
    expect(r.posts[2]!.text.length).toBeGreaterThan(400);
    // The fourth stayed a headline - the budget is a cap, not a promise.
    expect(r.posts[3]!.text).toContain("Fourth headline");
  });

  it("falls back to the anchor text when a followed link fails", async () => {
    stubRoutes({
      "https://x.test/news": () => new Response(INDEX_HTML, { status: 200 }),
      "https://x.test/story-1": () => new Response("", { status: 503 }),
      "https://x.test/story-2": () => new Response("<article>2</article>", { status: 200 }),
      "https://x.test/story-3": () => new Response("<article>3</article>", { status: 200 }),
    });
    const r = await fetchOne(
      { platform: "Web", handle: "https://x.test/news" },
      {
        articleText: bodiesByUrl({
          "https://x.test/story-1": bodyOf(20),
          "https://x.test/story-2": bodyOf(20),
          "https://x.test/story-3": bodyOf(20),
        }),
      },
    );
    if (!r.ok) throw new Error(r.error);

    // Degradation is per post, never per source.
    expect(r.posts[0]!.text).toContain("First headline");
    expect(r.posts[1]!.text.length).toBeGreaterThan(400);
    expect(r.posts[2]!.text.length).toBeGreaterThan(400);
  });

  it("ignores a body that turned out to be page chrome", async () => {
    stubRoutes({
      "https://x.test/news": () => new Response(INDEX_HTML, { status: 200 }),
      "https://x.test/story-1": () => new Response("<article>1</article>", { status: 200 }),
      "https://x.test/story-2": () => new Response("<article>2</article>", { status: 200 }),
      "https://x.test/story-3": () => new Response("<article>3</article>", { status: 200 }),
    });
    const r = await fetchOne(
      { platform: "Web", handle: "https://x.test/news" },
      // too short to be an article: Readability found a cookie banner, not a report
      { articleText: async () => "Cookie notice" },
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.posts[0]!.text).toContain("First headline");
  });

  it("reproduces today's output with no extractor injected (the browser path)", async () => {
    // This is the regression guard for the DI default: whatever the server does, a transport with
    // no articleText must keep returning the anchor-text posts the archive has always held.
    stubRoutes({ "https://x.test/news": () => new Response(INDEX_HTML, { status: 200 }) });
    const r = await fetchOne({ platform: "Web", handle: "https://x.test/news" });
    if (!r.ok) throw new Error(r.error);

    expect(r.posts).toEqual([
      {
        id: "web:https://x.test/story-1",
        text: "First headline about a drone strike in Odesa region yesterday",
        url: "https://x.test/story-1",
        date: undefined,
      },
      {
        id: "web:https://x.test/story-2",
        text: "Second headline about new loitering munitions delivered to front line",
        url: "https://x.test/story-2",
        date: undefined,
      },
      {
        id: "web:https://x.test/story-3",
        text: "Third headline about interceptor drones engaging enemy reconnaissance UAVs",
        url: "https://x.test/story-3",
        date: undefined,
      },
      {
        id: "web:https://x.test/story-4",
        text: "Fourth headline about electronic warfare units reporting jammed frequencies",
        url: "https://x.test/story-4",
        date: undefined,
      },
    ]);
  });

  it("does not follow anything when maxFollows is 0", async () => {
    const fn = stubRoutes({
      "https://x.test/news": () => new Response(INDEX_HTML, { status: 200 }),
      "https://x.test/story-1": () => new Response("<article>1</article>", { status: 200 }),
    });
    const r = await fetchOne(
      { platform: "Web", handle: "https://x.test/news" },
      { articleText: bodiesByUrl({ "https://x.test/story-1": bodyOf(20) }), maxFollows: 0 },
    );
    if (!r.ok) throw new Error(r.error);
    // Only the source page itself was requested.
    expect(fn).toHaveBeenCalledTimes(1);
    expect(r.posts[0]!.text).toContain("First headline");
  });

  it("follows RSS items that are only a teaser", async () => {
    const xml = `<rss><channel>
      <item><title>Shahed downed</title><link>https://x.test/a</link><description>A short teaser of the full report about the strike, cut off by the feed itself.</description></item>
      <item><title>Geran launch</title><link>https://x.test/b</link><description>Another short teaser, truncated before the part that would be interesting.</description></item>
    </channel></rss>`;
    stubRoutes({
      "https://x.test/feed": () => new Response(xml, { status: 200 }),
      "https://x.test/a": () => new Response("<article>a</article>", { status: 200 }),
      "https://x.test/b": () => new Response("<article>b</article>", { status: 200 }),
    });
    const r = await fetchOne(
      { platform: "RSS", handle: "https://x.test/feed" },
      {
        articleText: bodiesByUrl({
          "https://x.test/a": bodyOf(20),
          "https://x.test/b": bodyOf(20),
        }),
      },
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.posts).toHaveLength(2);
    expect(r.posts[0]!.text.length).toBeGreaterThan(200);
    // ids and urls unchanged, so dedupe and archive links stay stable
    expect(r.posts[0]!.id).toMatch(/^rss:/);
    expect(r.posts[0]!.url).toBe("https://x.test/a");
  });
});

// ------------------------------------------------------------------ X bridge

describe("fetchOne X bridge", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is unsupported without a bridge and makes no request", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const r = await fetchOne({ platform: "X", handle: "@osinttechnical" });
    expect(r.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("reads a timeline through an operator-configured bridge", async () => {
    const xml = `<rss><channel>
      <item><title>New drone type filmed</title><link>https://x.test/t1</link>
        <description>A report long enough to pass the length filter in the RSS parser.</description></item>
    </channel></rss>`;
    const fn = stubRoutes({
      "https://bridge.test/osinttechnical": () => new Response(xml, { status: 200 }),
    });
    const r = await fetchOne(
      { platform: "X", handle: "@osinttechnical" },
      { xBridgeBase: "https://bridge.test" },
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.posts).toHaveLength(1);
    expect(r.posts[0]!.text).toContain("New drone type filmed");
    expect(fn).toHaveBeenCalledWith("https://bridge.test/osinttechnical", expect.anything());
  });

  it("rejects a non-https bridge base", async () => {
    const r = await fetchOne(
      { platform: "X", handle: "@x" },
      { xBridgeBase: "http://bridge.test" },
    );
    expect(r).toEqual({ ok: false, error: "X_BRIDGE_BASE must start with https://" });
  });

  it("rejects a malformed handle", async () => {
    const r = await fetchOne(
      { platform: "X", handle: "not a handle!" },
      { xBridgeBase: "https://b.test" },
    );
    expect(r).toEqual({ ok: false, error: "Invalid X handle" });
  });
});
