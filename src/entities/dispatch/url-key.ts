/**
 * Canonical post identity.
 *
 * Two monitored sources routinely carry the same article: a site-wide feed and its category feed,
 * or the same story reachable from an index page and from the article's own permalink. The
 * dispatch primary key is `${sourceId}|${externalId}`, so those copies land under different ids
 * and both reach the pipeline - one story, two extractions, two claim sources on the same spec.
 *
 * SimHash catches that by comparing text, but it is a *probabilistic* near-match: it can be fooled
 * by a reworded repost and it is blind to two copies whose text happens to differ enough. URL
 * identity is deterministic and free. This module produces the key that makes it a first-class
 * check rather than a coincidence.
 *
 * The rules are deliberately conservative. A key must be stable across the ways one article's URL
 * gets written, and must NOT collapse two genuinely different articles. Where a transformation
 * could do either - lowercasing a path that may be case-sensitive, dropping a query string that
 * may select content - the safer error is kept.
 */

/**
 * Normalise a post URL into a comparable identity.
 *
 * Returns "" for anything that cannot be reduced to a trustworthy key (empty input, a bare host
 * with no path, an unparseable string), so callers treat "no key" as "cannot dedupe" and fall
 * back to text similarity rather than inventing a collision.
 */
export function canonicalUrl(raw: string | undefined | null): string {
  if (!raw) return "";
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return "";
  }
  // Only http(s) identifies an article; anything else (mailto:, data:, javascript:) is not one.
  if (u.protocol !== "http:" && u.protocol !== "https:") return "";

  // Host: lowercase, and drop a leading "www." so the same site under both spellings agrees.
  // The rest of the host is preserved - "news.bellingcat.com" is not "bellingcat.com".
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (!host) return "";

  // Path: collapse duplicate and trailing slashes, and decode nothing. Percent-encoding is left
  // alone because `%2F` and `/` are different paths, and Cyrillic slugs are compared as written.
  let path = u.pathname.replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  if (!path) path = "/";

  // Query: kept, minus the tracking parameters that differ between a feed's copy of a link and
  // the canonical one. Anything else may select content, so it stays and keeps two variants apart.
  const params = u.searchParams;
  const drop = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "utm_id",
    "fbclid",
    "gclid",
    "ref_src",
    "ref_url",
    "mc_cid",
    "mc_eid",
  ];
  for (const p of drop) params.delete(p);
  params.sort();
  const query = params.toString();

  // Fragment: a `#section` anchor is the same article.
  return `${host}${path}${query ? `?${query}` : ""}`;
}

/**
 * True when two URLs identify the same article.
 *
 * Separate from `canonicalUrl` so callers read as intent ("are these the same post?") rather than
 * string comparison, and so the empty-key rule is enforced in one place.
 */
export function samePost(a: string | undefined | null, b: string | undefined | null): boolean {
  const ka = canonicalUrl(a);
  const kb = canonicalUrl(b);
  return !!ka && ka === kb;
}
