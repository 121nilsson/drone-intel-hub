/**
 * Article body extraction. Server-only.
 *
 * It needs a DOM, so the parser is imported lazily inside the function: `fetch-posts.ts` (which
 * the client imports the `FetchedPost` type from) reaches this through the injected `articleText`
 * callback rather than an import, and the browser never loads either dependency.
 *
 * Readability is the same algorithm Firefox Reader View uses. It strips navigation, related-story
 * blocks and boilerplate, which is exactly what the old anchor-text parser was serving up as posts.
 *
 * linkedom is the DOM implementation, not jsdom: jsdom pulls in tough-cookie, which needs the
 * deprecated `punycode/` builtin that this project's bundler cannot resolve, and it is an order of
 * magnitude heavier for what is a parse-and-walk.
 */

const MIN_CHARS = 400;
/** Dispatch text is stored, and a document is size-capped; a long report is truncated, not kept whole. */
const MAX_CHARS = 8000;
/** Below this many paragraphs, the page is a stub or a redirect rather than a report. */
const MIN_PARAGRAPHS = 2;

// Import content filters for post-processing
import { filterGeneralContent } from "./content-filters";

export async function extractArticleText(html: string, url: string): Promise<string | null> {
  try {
    const [{ parseHTML }, { Readability }] = await Promise.all([
      import("linkedom"),
      import("@mozilla/readability"),
    ]);
    const { document } = parseHTML(html);
    // Readability rewrites the document it is given, so anything needed from the source page has
    // to be read first.
    const heading =
      document.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() ||
      document.querySelector("title")?.textContent?.replace(/\s+/g, " ").trim() ||
      "";
    const article = new Readability(document).parse();
    if (!article) return null;

    // A real article has paragraphs. A navigation list, a category index or a redirect stub has
    // text but almost no `<p>` elements, and returning it would replace the headline posts the page
    // actually contains - so it counts as "nothing found" and the caller keeps its anchor fallback.
    const content = article.content ?? "";
    if ((content.match(/<p[\s>]/gi)?.length ?? 0) < MIN_PARAGRAPHS) return null;

    const body = parseHTML(content).document;
    // The headline leads, the way an RSS item is stored - a dispatch that begins with it reads
    // better in the archive and gives the extractor a free signal. It is taken from the source
    // page rather than from Readability's `title`, which is usually `<title>` or og:title and on a
    // news site is more often the site's name than the story's.
    // Paragraphs come from the markup, not textContent: Readability's text flattens block elements
    // together, and the archive reads better with the original paragraph breaks.
    const paragraphs = [...body.querySelectorAll("p")].map((p) =>
      (p.textContent ?? "").replace(/\s+/g, " ").trim(),
    );
    const text = [heading, ...paragraphs].filter(Boolean).join("\n\n");
    if (text.length < MIN_CHARS) return null;
    
    // Apply content filters to remove remaining noise (boilerplate, banners, etc.)
    const filteredText = filterGeneralContent(text);
    
    if (filteredText.length < MIN_CHARS) return null;
    return filteredText.length > MAX_CHARS ? filteredText.slice(0, MAX_CHARS) : filteredText;
  } catch {
    // A parser crash must fail the one link it belongs to, never the source that contains it.
    return null;
  }
}
