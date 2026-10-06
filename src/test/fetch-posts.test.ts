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
