/** Display host + path compactly, e.g. "t.me/channel/123". */
export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return (u.host.replace(/^www\./, "") + u.pathname.replace(/\/$/, "")).slice(0, 80);
  } catch {
    return url;
  }
}
