import { describe, expect, it } from "vitest";
import { canonicalUrl, samePost } from "@/entities/dispatch/url-key";

describe("canonicalUrl", () => {
  it("returns a bare host for a root path", () => {
    expect(canonicalUrl("https://www.bellingcat.com/")).toBe("bellingcat.com/");
  });

  it("agrees across the spellings one article's URL arrives in", () => {
    const canonical = canonicalUrl("https://www.bellingcat.com/news/2026/09/16/drone-strike/");
    expect(canonicalUrl("https://bellingcat.com/news/2026/09/16/drone-strike")).toBe(canonical);
    expect(canonicalUrl("http://www.bellingcat.com/news/2026/09/16/drone-strike")).toBe(canonical);
    expect(canonicalUrl("https://www.bellingcat.com/news/2026/09/16/drone-strike/#comments")).toBe(
      canonical,
    );
  });

  it("keeps distinct articles apart", () => {
    const a = canonicalUrl("https://example.test/news/one");
    expect(canonicalUrl("https://example.test/news/two")).not.toBe(a);
  });

  // A subdomain is a different site, and its paths must not collide with the apex.
  it("distinguishes subdomains from the apex domain", () => {
    expect(canonicalUrl("https://news.example.test/a")).not.toBe(
      canonicalUrl("https://example.test/a"),
    );
  });

  it("ignores tracking parameters but keeps ones that select content", () => {
    expect(canonicalUrl("https://example.test/a?utm_source=rss&id=7")).toBe(
      canonicalUrl("https://example.test/a?id=7"),
    );
    expect(canonicalUrl("https://example.test/a?id=7")).not.toBe(
      canonicalUrl("https://example.test/a?id=8"),
    );
  });

  it("does not depend on query parameter order", () => {
    expect(canonicalUrl("https://example.test/a?b=2&a=1")).toBe(
      canonicalUrl("https://example.test/a?a=1&b=2"),
    );
  });

  it("collapses duplicate slashes", () => {
    expect(canonicalUrl("https://example.test//news//a")).toBe(
      canonicalUrl("https://example.test/news/a"),
    );
  });

  // Non-http URLs and junk cannot identify an article; the caller must fall back to text dedupe.
  it("returns empty for anything that is not an http(s) article URL", () => {
    expect(canonicalUrl("")).toBe("");
    expect(canonicalUrl(undefined)).toBe("");
    expect(canonicalUrl("mailto:a@b.test")).toBe("");
    expect(canonicalUrl("not a url")).toBe("");
    expect(canonicalUrl("@rybar")).toBe("");
  });

  // A Telegram post link is a real URL and must key normally, so a channel's posts dedupe too.
  it("keys a Telegram permalink", () => {
    expect(canonicalUrl("https://t.me/rybar/83817")).toBe("t.me/rybar/83817");
  });
});

describe("samePost", () => {
  it("is true for two spellings of one article", () => {
    expect(samePost("https://www.bellingcat.com/news/x/", "https://bellingcat.com/news/x")).toBe(
      true,
    );
  });

  it("is false for different articles", () => {
    expect(samePost("https://example.test/a", "https://example.test/b")).toBe(false);
  });

  // Two unkeyable URLs must never be reported as the same post.
  it("is false when either side has no key", () => {
    expect(samePost("", "https://example.test/a")).toBe(false);
    expect(samePost("https://example.test/a", "")).toBe(false);
    expect(samePost("", "")).toBe(false);
  });
});
