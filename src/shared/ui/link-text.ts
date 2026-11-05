/** Display host + path compactly, e.g. "t.me/channel/123". */
export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return (u.host.replace(/^www\./, "") + u.pathname.replace(/\/$/, "")).slice(0, 80);
  } catch {
    return url;
  }
}

/** Append a unit unless the value already ends with it ("60 km" + "km" → "60 km"). */
export function withUnit(value: unknown, unit?: string): string {
  const v = String(value ?? "").trim();
  const u = (unit ?? "").trim();
  if (!u) return v;
  return v.toLowerCase().endsWith(u.toLowerCase()) ? v : `${v} ${u}`;
}
