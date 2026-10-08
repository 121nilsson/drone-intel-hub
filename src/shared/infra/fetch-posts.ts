import { mapWithConcurrency } from "./pool";
import type { MonitoredSource } from "@/entities/source/types";

export interface FetchedPost {
  id: string;
  text: string;
  url: string;
  date?: string | undefined;
}
export type FetchResult = { ok: true; posts: FetchedPost[] } | { ok: false; error: string };

// CDATA must be unwrapped BEFORE tag stripping: `<![CDATA[text]]>` otherwise matches the
// tag regex as one giant "tag" and the entire value is discarded. Nearly every RSS <title>
// and <description> is CDATA-wrapped, so this ordering silently yields zero posts per feed.
const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();

const UA = { "User-Agent": "Mozilla/5.0 (compatible; DroneINT/1.0)" };

/**
 * Deadline for every request one source costs. Exists to bound a hang, not to police latency - a
 * slow RSS host is legitimate, a dead one must not hold a whole sync pass open. Server callers can
 * override it (or pass 0 to disable) through FetchOptions; see FETCH_TIMEOUT_MS in
 * fetch-posts.server.ts, which mirrors the PROVIDER_TIMEOUT_MS convention in the README.
 */
export const FETCH_TIMEOUT_MS = 15_000;

/** Lanes the collection pool runs in. ~79 sources at 6 is ~13 rounds of the slowest host. */
export const FETCH_CONCURRENCY = 6;

/**
 * Host a source's requests actually hit, so the collection pool can serialise sources that share
 * one (five GitHub release atoms, for instance) without throttling the rest.
 */
export function sourceHost(s: Pick<MonitoredSource, "platform" | "handle">): string {
  if (s.platform === "Telegram") return "t.me";
  try {
    return new URL(s.handle).hostname;
  } catch {
    return "unknown";
  }
}

function parseTelegram(html: string, chan: string): FetchedPost[] {
  const out: FetchedPost[] = [];
  const blocks = html.split('class="tgme_widget_message_wrap').slice(1);
  for (const b of blocks) {
    const post = b.match(/data-post="([^"]+)"/)?.[1];
    const txt = b.match(/class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1];
    const date = b.match(/datetime="([^"]+)"/)?.[1];
    if (!post || !txt) continue;
    const text = decode(txt);
    if (text.length < 40) continue;
    out.push({ id: `tg:${post}`, text, url: `https://t.me/${post}`, date });
  }
  return out.reverse().slice(0, 20);
}

function parseRss(xml: string): FetchedPost[] {
  const items = xml.split(/<item[\s>]|<entry[\s>]/).slice(1);
  return items
    .slice(0, 20)
    .map((it) => {
      const title = decode(it.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? "");
      const desc = decode(
        it.match(
          /<(?:description|summary|content:encoded|content)[^>]*>([\s\S]*?)<\/(?:description|summary|content:encoded|content)>/,
        )?.[1] ?? "",
      );
      const link =
        it.match(/<link[^>]*>([^<]+)<\/link>/)?.[1] ??
        it.match(/<link[^>]*href="([^"]+)"/)?.[1] ??
        "";
      const guid = it.match(/<(?:guid|id)[^>]+>([^<]+)</)?.[1] ?? link ?? title;
      const date = it.match(/<(?:pubDate|published|updated)>([^<]+)</)?.[1];
      return {
        id: `rss:${guid.trim()}`,
        text: `${title}. ${desc}`.slice(0, 3000),
        url: link.trim(),
        date,
      };
    })
    .filter((p) => p.text.length > 40);
}

function parseWeb(html: string, url: string): FetchedPost[] {
  const out: FetchedPost[] = [];
  const re = /<a[^>]+href="([^"#]+)"[^>]*>([\s\S]{25,300}?)<\/a>/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 25) {
    const text = decode(m[2] ?? "");
    if (text.split(" ").length < 5 || seen.has(text)) continue;
    seen.add(text);
    const href = new URL(m[1] ?? "", url).toString();
    out.push({ id: `web:${href}`, text, url: href });
  }
  return out;
}

/** Ceiling on follow-up requests per source, so one source cannot cost a dozen fetches. */
const MAX_FOLLOWS = 3;
const FOLLOW_CONCURRENCY = 3;
/** Below this, Readability has found chrome rather than an article, so the anchor text stays. */
const MIN_ARTICLE_CHARS = 400;
/** Above this a body is truncated: dispatches are stored, and the store caps a document. */
const MAX_ARTICLE_CHARS = 8000;
/** RSS items shorter than this are usually a teaser, and are worth following to the article. */
const RSS_TEASER_CHARS = 200;

type TextResult =
  { ok: true; body: string; status: number } | { ok: false; error: string; status: number };

async function getText(url: string, timeoutMs: number): Promise<TextResult> {
  const signal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
  try {
    const r = await fetch(url, { headers: UA, ...(signal ? { signal } : {}) });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}`, status: r.status };
    return { ok: true, body: await r.text(), status: r.status };
  } catch (e) {
    // AbortSignal.timeout rejects with a TimeoutError whose message is platform-specific, so it is
    // classified here (the same way transportError() does for provider calls).
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError")
      return { ok: false, error: "Fetch timeout", status: 0 };
    return { ok: false, error: e instanceof Error ? e.message : "Fetch failed", status: 0 };
  }
}

const capped = (text: string) =>
  text.length > MAX_ARTICLE_CHARS ? text.slice(0, MAX_ARTICLE_CHARS) : text;

/** Fetch `url` and extract its article body, or null if either step fails. */
async function articleAt(
  url: string,
  timeoutMs: number,
  extract: NonNullable<FetchOptions["articleText"]>,
) {
  const r = await getText(url, timeoutMs);
  if (!r.ok) return null;
  const body = await extract(r.body, url);
  return body && body.length >= MIN_ARTICLE_CHARS ? capped(body) : null;
}

export interface FetchOptions {
  /** Deadline for the source page and any follow-up request. 0 disables. */
  timeoutMs?: number;
  /**
   * Article body extraction, injected by the server (it needs a DOM, so jsdom is imported
   * server-side only). Absent in the browser, where sources are fetched through the server
   * function - which is also why this is a parameter and not an import.
   */
  articleText?: (html: string, url: string) => Promise<string | null>;
  /** Links whose bodies are fetched, on top of the source page. */
  maxFollows?: number;
  /** Total requests this source may cost, the page itself included. */
  maxRequests?: number;
  /** Operator-supplied RSS bridge base URL for X/Twitter. Env-controlled, never a source field. */
  xBridgeBase?: string;
}

/**
 * A Web source is either an article page or an index of links.
 *
 * Try the article body first: for a page that *is* an article, the body is strictly better than the
 * headline the anchor parser would have returned. When the page is an index, keep every headline
 * (they are the posts, and dropping them loses coverage) but replace the top few with their bodies
 * - the richest ones reach the pipeline instead of 25 link labels.
 *
 * Post ids stay the URL throughout, so re-collecting a source still dedupes on the external id.
 */
async function webPosts(html: string, pageUrl: string, opts: FetchOptions): Promise<FetchedPost[]> {
  const extract = opts.articleText;
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  if (extract) {
    // The page is already in hand: extracting here must not fetch it a second time.
    const body = await extract(html, pageUrl);
    if (body && body.length >= MIN_ARTICLE_CHARS)
      return [{ id: `web:${pageUrl}`, text: capped(body), url: pageUrl }];
  }

  const links = parseWeb(html, pageUrl);
  const follow = Math.min(opts.maxFollows ?? MAX_FOLLOWS, MAX_FOLLOWS);
  const budget = Math.max(0, (opts.maxRequests ?? follow + 1) - 1); // the page itself cost one
  const top = links.slice(0, budget);
  if (!extract || top.length === 0) return links;

  const bodies = await mapWithConcurrency(top, FOLLOW_CONCURRENCY, (link) =>
    articleAt(link.url, timeoutMs, extract),
  );
  for (let i = 0; i < top.length; i++) {
    const settled = bodies[i];
    const body = settled?.status === "fulfilled" ? settled.value : null;
    // Degradation is per post: a failed or too-short body keeps the anchor text.
    if (body) Object.assign(top[i]!, { text: body });
  }
  return links;
}

/** Follow the items that are only a teaser ("read more") to the article behind them. */
async function rssPosts(xml: string, opts: FetchOptions): Promise<FetchedPost[]> {
  const posts = parseRss(xml);
  const extract = opts.articleText;
  if (!extract) return posts;
  const follow = Math.min(opts.maxFollows ?? MAX_FOLLOWS, MAX_FOLLOWS);
  const teasers = posts.filter((p) => p.url && p.text.length < RSS_TEASER_CHARS).slice(0, follow);
  if (teasers.length === 0) return posts;

  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const bodies = await mapWithConcurrency(teasers, FOLLOW_CONCURRENCY, (p) =>
    articleAt(p.url, timeoutMs, extract),
  );
  for (let i = 0; i < teasers.length; i++) {
    const settled = bodies[i];
    const body = settled?.status === "fulfilled" ? settled.value : null;
    // Only the text is replaced: the `rss:` id and the URL keep dedupe and archive links stable.
    if (body && body.length > teasers[i]!.text.length) {
      Object.assign(teasers[i]!, { text: body });
    }
  }
  return posts;
}

/**
 * Fetches recent public posts for one monitored source. Pure transport logic with no
 * TanStack or database imports, so the browser button, the scheduled task, and unit tests
 * all share it. X has no first-party path without a paid API; a bridge can be supplied.
 */
export async function fetchOne(
  source: Pick<MonitoredSource, "platform" | "handle">,
  opts: FetchOptions = {},
): Promise<FetchResult> {
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  try {
    if (source.platform === "X") {
      // The bridge base is operator-controlled (env), not a source field, so this cannot be turned
      // into an SSRF primitive by someone who can add a source.
      if (!opts.xBridgeBase)
        return { ok: false, error: "X/Twitter needs a paid API or an RSS bridge (X_BRIDGE_BASE)" };
      if (!/^https:\/\//.test(opts.xBridgeBase))
        return { ok: false, error: "X_BRIDGE_BASE must start with https://" };
      const handle = source.handle.replace(/^@/, "").trim();
      if (!/^[A-Za-z0-9_]{1,64}$/.test(handle)) return { ok: false, error: "Invalid X handle" };
      const r = await getText(`${opts.xBridgeBase.replace(/\/$/, "")}/${handle}`, timeoutMs);
      if (!r.ok) return { ok: false, error: r.status ? `X ${r.status}` : r.error };
      return { ok: true, posts: parseRss(r.body) };
    }
    if (source.platform === "Telegram") {
      const chan = source.handle.replace(/^@|^https?:\/\/t\.me\/(s\/)?/, "").split("/")[0] ?? "";
      if (!/^[A-Za-z0-9_]{3,64}$/.test(chan))
        return { ok: false, error: "Invalid Telegram handle" };
      const r = await getText(`https://t.me/s/${chan}`, timeoutMs);
      // An HTTP status keeps its wording; a transport failure keeps its own message.
      if (!r.ok) return { ok: false, error: r.status ? `Telegram ${r.status}` : r.error };
      return { ok: true, posts: parseTelegram(r.body, chan) };
    }
    if (!/^https:\/\//.test(source.handle))
      return { ok: false, error: "URL must start with https://" };
    const r = await getText(source.handle, timeoutMs);
    if (!r.ok) return { ok: false, error: r.error };
    const isFeed = source.platform === "RSS" || /<rss|<feed/i.test(r.body.slice(0, 500));
    return {
      ok: true,
      posts: isFeed ? await rssPosts(r.body, opts) : await webPosts(r.body, source.handle, opts),
    };
  } catch (e) {
    // parseWeb/parseRss can throw on malformed markup; a parser failure must fail this source only.
    return { ok: false, error: e instanceof Error ? e.message : "Fetch failed" };
  }
}
