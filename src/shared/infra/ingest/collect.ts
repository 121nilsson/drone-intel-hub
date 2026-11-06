import type { MonitoredSource } from "@/entities/source/types";
import { MIN_CHARS_FOR_DEDUPE, simHash64 } from "@/entities/dispatch/simhash";
import type { RawDispatch } from "@/entities/dispatch/types";
import type { FetchedPost } from "@/shared/infra/sources/source-fetch.functions";
import type { DispatchRepository } from "@/shared/contracts/repository";
import type { CollectReport } from "@/shared/infra/ingest/ingest-reports";

export type Fetcher = (
  s: MonitoredSource,
) => Promise<{ ok: true; posts: FetchedPost[] } | { ok: false; error: string }>;

export const dispatchId = (sourceId: string, externalId: string) => `${sourceId}|${externalId}`;

/**
 * Stage 1 — network only. Fetch a source and store every new post as a pending dispatch.
 * No AI calls, so it is fast and never blocked by model latency or rate limits.
 *
 * A post that duplicates one already stored is written as a `duplicate` stub: same external id, so
 * it is never re-fetched, text stripped so it is never analysed, and pointing at the canonical
 * dispatch so the archive still shows which sources carried the story. Suppressing them here is
 * what stops one fact from being extracted three times over and recorded as three claim sources in
 * consensus().
 */
export async function collectSource(
  s: MonitoredSource,
  fetcher: Fetcher,
  dispatches: DispatchRepository,
): Promise<CollectReport> {
  const started = Date.now();
  const res = await fetcher(s);
  if (!res.ok)
    return {
      source: s.name,
      fetched: 0,
      stored: 0,
      duplicates: 0,
      durationMs: Date.now() - started,
      error: res.error,
    };
  const now = new Date().toISOString();
  let stored = 0;
  let duplicates = 0;
  // A feed re-serves posts older than the cache window; without this they look new, are inserted,
  // and storage rejects every one of them as a conflict.
  await dispatches.preload?.(res.posts.map((p) => dispatchId(s.id, p.id)));
  for (const p of res.posts) {
    const id = dispatchId(s.id, p.id);
    // URL identity first: the same article republished by another source is one story regardless
    // of how much text each feed served, which is not something the fingerprint below can decide.
    // Checked before the row exists, so the document's own id is not yet in the index.
    const duplicateOf =
      dispatches.duplicateOfUrl?.(p.url, id) ??
      // Only long enough posts are fingerprinted: below MIN_CHARS_FOR_DEDUPE a fingerprint is
      // noise, and short posts are cheap to re-analyse anyway.
      (p.text.length >= MIN_CHARS_FOR_DEDUPE
        ? (dispatches.duplicateOf?.(simHash64(p.text)) ?? null)
        : null);
    const fingerprint = p.text.length >= MIN_CHARS_FOR_DEDUPE ? simHash64(p.text) : undefined;

    const d: RawDispatch = duplicateOf
      ? {
          id,
          sourceId: s.id,
          sourceName: s.name,
          externalId: p.id,
          url: p.url,
          text: "",
          publishedAt: p.date,
          createdAt: now,
          status: "duplicate",
          contentHash: fingerprint,
          duplicateOf,
        }
      : {
          id,
          sourceId: s.id,
          sourceName: s.name,
          externalId: p.id,
          url: p.url,
          text: p.text,
          publishedAt: p.date,
          createdAt: now,
          status: "pending",
          contentHash: fingerprint,
        };
    // add() still dedupes on the external id, so a re-fetch of a known post stores nothing and is
    // counted in neither bucket.
    if (dispatches.add(d)) {
      if (duplicateOf) duplicates++;
      else stored++;
    }
  }
  return {
    source: s.name,
    fetched: res.posts.length,
    stored,
    duplicates,
    durationMs: Date.now() - started,
  };
}
