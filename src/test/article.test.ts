import { describe, expect, it } from "vitest";
import { extractArticleText } from "@/shared/infra/article.server";

const PARAGRAPH = `The report describes a strike on an energy substation in the Odesa region, with
  air defences engaging a formation of loitering munitions and transformer damage reported by the
  grid operator earlier that morning.`;

const articlePage = (paragraphs: number) =>
  `<!doctype html><html><head><title>Report</title></head><body>
    <header><nav><a href="/">Home</a> <a href="/news">News</a> <a href="/about">About</a></nav></header>
    <main><article><h1>Shahed strike on Odesa</h1>
      ${Array.from({ length: paragraphs }, () => `<p>${PARAGRAPH}</p>`).join("\n")}
    </article></main>
    <aside><h3>Related</h3><ul><li><a href="/x">Another story</a></li><li><a href="/y">And another</a></li></ul></aside>
    <footer><p>Copyright. All rights reserved. Privacy policy. Terms of use.</p></footer>
  </body></html>`;

describe("extractArticleText", () => {
  it("returns the article body without navigation or boilerplate", async () => {
    const text = await extractArticleText(articlePage(4), "https://x.test/report");
    expect(text).not.toBeNull();
    // The report itself
    expect(text).toContain("Shahed strike on Odesa");
    expect(text).toContain("Odesa region");
    // The chrome the old anchor parser was serving up
    expect(text).not.toContain("All rights reserved");
    expect(text!.length).toBeGreaterThan(400);
  });

  it("joins paragraphs with a blank line so sentences stay readable", async () => {
    const text = await extractArticleText(articlePage(3), "https://x.test/report");
    expect(text).toContain(`\n\n`);
    // Trailing whitespace per paragraph is collapsed rather than kept verbatim.
    expect(text).not.toMatch(/\s\n\s*\n/);
  });

  it("returns null for a page that is navigation, not an article", async () => {
    const chrome = `<html><body><nav>${Array.from(
      { length: 30 },
      (_, i) => `<a href="/p${i}">Navigation item ${i} with several words here</a>`,
    ).join("")}</nav></body></html>`;
    expect(await extractArticleText(chrome, "https://x.test/index")).toBeNull();
  });

  it("returns null for an empty document rather than throwing", async () => {
    expect(await extractArticleText("", "https://x.test/empty")).toBeNull();
    expect(
      await extractArticleText("<html><body></body></html>", "https://x.test/empty"),
    ).toBeNull();
  });

  it("truncates a very long article instead of failing the size cap", async () => {
    // Migration 001 documents and the document-store validator both cap a stored document, so an
    // unusually long report must be cut rather than rejected.
    const huge = articlePage(400);
    const text = await extractArticleText(huge, "https://x.test/long");
    expect(text).not.toBeNull();
    expect(text!.length).toBeLessThanOrEqual(8000);
    expect(text).toContain("Shahed strike on Odesa");
  });
});
