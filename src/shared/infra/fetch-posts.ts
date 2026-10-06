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
      const guid = it.match(/<(?:guid|id)[^>]*>([^<]+)</)?.[1] ?? link ?? title;
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

/**
 * Fetches recent public posts for one monitored source. Pure transport logic with no
 * TanStack or database imports, so the browser button, the scheduled task, and unit tests
 * all share it. X requires a paid API, so it is unsupported.
 */
export async function fetchOne(
  source: Pick<MonitoredSource, "platform" | "handle">,
): Promise<FetchResult> {
  try {
    if (source.platform === "X")
      return { ok: false, error: "X/Twitter needs a paid API — not supported yet" };
    if (source.platform === "Telegram") {
      const chan = source.handle.replace(/^@|^https?:\/\/t\.me\/(s\/)?/, "").split("/")[0] ?? "";
      if (!/^[A-Za-z0-9_]{3,64}$/.test(chan))
        return { ok: false, error: "Invalid Telegram handle" };
      const r = await fetch(`https://t.me/s/${chan}`, { headers: UA });
      if (!r.ok) return { ok: false, error: `Telegram ${r.status}` };
      return { ok: true, posts: parseTelegram(await r.text(), chan) };
    }
    if (!/^https:\/\//.test(source.handle))
      return { ok: false, error: "URL must start with https://" };
    const r = await fetch(source.handle, { headers: UA });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    const body = await r.text();
    const isFeed = source.platform === "RSS" || /<rss|<feed/i.test(body.slice(0, 500));
    return { ok: true, posts: isFeed ? parseRss(body) : parseWeb(body, source.handle) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Fetch failed" };
  }
}
