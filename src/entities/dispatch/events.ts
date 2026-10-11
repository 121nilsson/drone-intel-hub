import { canonicalUrl } from "./url-key";
import type { RawDispatch } from "./types";

/**
 * Event correlation across outlets - the analysis-side counterpart of collection's dedupe.
 *
 * Collection already stubs near-identical copies (simhash.ts, DUPLICATE_TOLERANCE): one story
 * forwarded verbatim never reaches the queue twice, and the pipeline deliberately analyses what
 * survives separately, because per-outlet extraction is what gives every claim its own source.
 * So correlation runs after that analysis, over the archive: it links processed dispatches that
 * carry the *same article* into one cluster with a stable id, so the feed reads as "one story,
 * six outlets" rather than six unrelated posts.
 *
 * URL identity only, and that is a measured decision, not a shortcut. An outlet's rewrite of one
 * story measures 19 bits from the original on the SimHash in simhash.ts, while a *different*
 * event written in the same vocabulary (same systems, same region) measures 20 - one bit apart,
 * so no single tolerance separates same-event coverage from a real second event. Text proximity
 * is therefore not used here; the deterministic link (url-key.ts) is exact, and both limitations
 * the collection stub has (cross-language copies do not match) apply unchanged.
 */
export function clusterEvents(dispatches: readonly RawDispatch[]): Map<string, string> {
  const processed = dispatches
    .filter((d) => d.status === "processed")
    .slice()
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  if (processed.length < 2) return new Map();

  // One canonical URL is one story, whatever its age: two outlets carrying the same permalink
  // are one article whether they were posted hours or weeks apart.
  const byUrl = new Map<string, RawDispatch[]>();
  for (const d of processed) {
    const key = canonicalUrl(d.url);
    if (!key) continue;
    const group = byUrl.get(key) ?? [];
    group.push(d);
    byUrl.set(key, group);
  }

  const out = new Map<string, string>();
  for (const group of byUrl.values()) {
    // A cluster needs at least two dispatches; one post is not an event. The id is the oldest
    // member's: stable while the earliest report stands, so a re-run is idempotent rather than
    // churning ids on every sync.
    if (group.length < 2) continue;
    const eventId = `evt:${group[0]!.id}`;
    for (const d of group) out.set(d.id, eventId);
  }
  return out;
}
