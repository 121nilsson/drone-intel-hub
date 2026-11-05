import type { Candidate } from "@/entities/drone/types";

/**
 * Picks which posts an evaluation run scores: stratified by platform and outcome so one common
 * source cannot fill the sample, and deterministic per seed so a run can be reproduced.
 */

/**
 * The platform a candidate's report came from, for stratification. Candidates carry only their
 * source line - "Outlet · https://t.me/outlet/1" today, "outlet|tg:handle/1" or "tg:handle/1"
 * in older rows - so the platform is read from the post's host, then from a scheme prefix.
 * Reading the leading word instead, as this once did, made almost every row "web" (current
 * format) or the outlet's own name (legacy format), and the sample was stratified on outcome alone.
 */
export function platformOf(source: string): string {
  const s = source.trim();
  if (/(?:^|[|\s])(?:tg|telegram):/i.test(s)) return "telegram";
  const host = /https?:\/\/(?:www\.)?([^/\s?#]+)/i.exec(s)?.[1]?.toLowerCase();
  if (host) {
    if (/^(?:t|telegram)\.me$/.test(host)) return "telegram";
    if (/^(?:x|twitter|mobile\.twitter)\.com$|^nitter\./.test(host)) return "x";
    if (/^(?:www\.)?bsky\.app$/.test(host)) return "bluesky";
    if (/(?:^|\.)reddit\.com$/.test(host)) return "reddit";
    if (/(?:^|\.)youtube\.com$|^youtu\.be$/.test(host)) return "youtube";
    return "web";
  }
  const scheme = /^([a-z]+):/i.exec(s)?.[1];
  return scheme ? scheme.toLowerCase() : "other";
}

export const outcomeOf = (c: Candidate) => c.quality?.decision ?? c.status;
export const epochOf = (c: Candidate) => c.extraction.metadata?.promptVersion ?? "legacy";

/** Deterministic PRNG so the same seed gives the same sample. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

/** Stratified (by platform × outcome) round-robin sample. */
export function stratifiedSample(cands: Candidate[], n: number, seed = 1): Candidate[] {
  const rand = rng(seed);
  const buckets = new Map<string, Candidate[]>();
  for (const c of cands) {
    const k = `${platformOf(c.source)}|${outcomeOf(c)}`;
    const b = buckets.get(k) ?? [];
    b.push(c);
    buckets.set(k, b);
  }
  for (const b of buckets.values()) {
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = b[i]!;
      b[i] = b[j]!;
      b[j] = t;
    }
  }
  const lists = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, b]) => b);
  const out: Candidate[] = [];
  for (let i = 0; out.length < n; i++) {
    let any = false;
    for (const l of lists) {
      if (i < l.length && out.length < n) {
        out.push(l[i]!);
        any = true;
      }
    }
    if (!any) break;
  }
  return out;
}
