/**
 * A recorded source label is a feed name, a bare URL, or "Feed name · URL". Split it so the name
 * can be the link text: shown raw, the URL half filled a line on its own.
 */
export function splitSourceLabel(label: string): { name: string; url?: string } {
  const m = label.match(/^(.*?)\s*·\s*(https?:\/\/\S+)\s*$/);
  if (m) return { name: m[1]!.trim() || m[2]!, url: m[2]! };
  const s = label.trim();
  return /^https?:\/\//i.test(s) ? { name: s, url: s } : { name: s };
}
