const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "just now", "12 min ago", "3 h ago", "2 d ago", then a date ("28 Oct", "28 Oct 2025"). Lists
 * full of the same ISO day said nothing about which entry moved last; the age does.
 */
export function relativeTime(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const s = Math.round((now - t) / 1000);
  if (s < 0) return shortDate(t, now);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)} d ago`;
  return shortDate(t, now);
}

function shortDate(t: number, now: number): string {
  const d = new Date(t);
  const day = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === new Date(now).getFullYear() ? day : `${day} ${d.getFullYear()}`;
}

/** Full local date and time, for the tooltip behind a relative time. */
export function fullTime(iso: string | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
