/**
 * Article body extraction. Server-only.
 *
 * It needs a DOM, so `jsdom` is imported lazily inside the function and the browser never loads it:
 * `fetch-posts.ts` (which the client imports the `FetchedPost` type from) reaches this through the
 * injected `articleText` callback rather than an import.
 *
 * Readability is the same library Firefox Reader View uses. It strips navigation, related-story
 * blocks and boilerplate, which is exactly what the old anchor-text parser was serving up as posts.
 */

/** Below this, Readability has found chrome rather than an article, so the caller keeps its fallback. */
const MIN_CHARS = 400;
/** Dispatch text is stored, and a document is size-capped; a long report is truncated, not kept whole. */
const MAX_CHARS = 8000;

export async function extractArticleText(html: string, url: string): Promise<string | null> {
  try {
    const [{ JSDOM }, { Readability }] = await Promise.all([
      import("jsdom"),
      import("@mozilla/readability"),
    ]);
    // `url` lets Readability resolve relative links and drop ones that point off-site.
    const document = new JSDOM(html, { url, contentType: "text/html" }).window.document;
    const article = new Readability(document).parse();
    if (!article) return null;
    const content = article.content ?? "";
    // A real article has paragraphs. A page that is a navigation list, a category index or a
    // redirect stub has text but almost no `<p>` elements, and returning it would replace the
    // headline posts the page actually contains - so it counts as "nothing found" and the caller
    // keeps its anchor-text fallback.
    if ((content.match(/<p[\s>]/gi)?.length ?? 0) < 2) return null;

    // Paragraphs are recovered from the markup, not from textContent: Readability's text flattens
    // block elements together, and the archive and the extraction prompt both read better with
    // the original paragraph breaks than with one run-on line.
    const body = new JSDOM(content, { contentType: "text/html" }).window.document;
    // The headline leads, the way an RSS item is stored - a dispatch that begins with it reads
    // better in the archive and gives the extractor a free signal. Readability's `title` comes from
    // <title> or og:title, which on a news page is usually the site name, so the heading inside
    // the article wins when there is one.
    const title =
      body.querySelector("h1, h2")?.textContent?.replace(/\s+/g, " ").trim() ||
      (article.title ?? "").replace(/\s+/g, " ").trim();
    const text = [
      title,
      ...[...body.querySelectorAll("p")].map((p) =>
        (p.textContent ?? "").replace(/\s+/g, " ").trim(),
      ),
    ]
      .filter(Boolean)
      .join("\n\n");
    if (text.length < MIN_CHARS) return null;
    return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
  } catch {
    // A parser crash must fail the one link it belongs to, never the source that contains it.
    return null;
  }
}
