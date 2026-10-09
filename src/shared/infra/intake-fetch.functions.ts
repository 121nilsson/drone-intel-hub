import { createServerFn } from "@tanstack/react-start";

/**
 * Quick-paste intake: when the analyst pastes a bare link, the button dereferences it
 * server-side and runs the two-tier pipeline on the article body instead of on the URL
 * string (a URL alone is noise and used to be auto-discarded at low confidence).
 *
 * The article extractor is imported lazily and stays server-only, mirroring
 * source-fetch.functions.ts: linkedom/readability never reach the browser bundle.
 */

/** True when the whole input is one http(s) link — the only URL shape we dereference. */
export const isBareUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim());

interface Input {
  url: string;
}

export type IntakeFetchResult = { ok: true; text: string } | { ok: false; error: string };

const FETCH_TIMEOUT_MS = Number(process.env["FETCH_TIMEOUT_MS"] ?? 15_000);
/** Guard against reading a huge page into memory; article extraction caps at 8k chars anyway. */
const MAX_BYTES = Number(process.env["FETCH_MAX_BYTES"] ?? 2_000_000);
/**
 * Cap what is fed to the extractors for quick-paste articles. The reasoning model used at
 * tier 2 is slow on very long prompts (an 8k-char article can exceed the provider timeout,
 * especially while the auto-sync cron shares the key). The head of an article carries the
 * headline and the first regular paragraphs, which is where system names appear; the full
 * text is still stored on the candidate for the analyst. Raise for a self-hosted provider.
 */
const MAX_ARTICLE_CHARS = Number(process.env["FETCH_ARTICLE_MAX_CHARS"] ?? 4_000);

export const fetchIntakeArticle = createServerFn({ method: "POST" })
  .validator((d: Input) => {
    if (!d || typeof d.url !== "string") throw new Error("Invalid input");
    const url = d.url.trim();
    // Only plain http(s) links. Anything else (schemes, embedded text, control chars)
    // is rejected so the server never fetches a non-URL or an internal scheme.
    if (url.length > 2000 || url.length < 8 || !isBareUrl(url))
      throw new Error("Only bare http(s) links are supported");
    return { url };
  })
  .handler(async ({ data }) => {
    try {
      const res = await fetch(data.url, {
        redirect: "follow",
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; DroneIntelHub/1.0)",
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9,text/*;q=0.8",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok)
        return { ok: false as const, error: `HTTP ${res.status} (${new URL(data.url).host})` };
      const type = (res.headers.get("content-type") ?? "").toLowerCase();
      if (!type.includes("html") && !type.startsWith("text/"))
        return {
          ok: false as const,
          error: `Unsupported content type${type ? `: "${type}"` : ""}`,
        };
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > MAX_BYTES)
        return { ok: false as const, error: "The page is too large to read" };
      let html = await res.text();
      if (html.length > MAX_BYTES) html = html.slice(0, MAX_BYTES);
      const { extractArticleText } = await import("./article.server");
      const text = await extractArticleText(html, data.url);
      if (!text)
        return {
          ok: false as const,
          error: `No readable article found at the link (${new URL(data.url).host})`,
        };
      return { ok: true as const, text: text.slice(0, MAX_ARTICLE_CHARS) };
    } catch (e) {
      return {
        ok: false as const,
        error: `Could not fetch the link${(e as Error).message ? `: ${(e as Error).message}` : ""}`,
      };
    }
  });
