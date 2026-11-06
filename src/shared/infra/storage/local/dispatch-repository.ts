import { isNearDuplicate } from "@/entities/dispatch/simhash";
import { canonicalUrl } from "@/entities/dispatch/url-key";
import type { RawDispatch } from "@/entities/dispatch/types";
import type { DispatchRepository } from "@/shared/contracts/repository";
import type { DocumentStore } from "@/shared/contracts/store";
import { CachedRepository } from "./cached-repository";
import { DispatchIndex } from "./dispatch-index";

/** Newest dispatches only: a duplicate almost always lands in the current or the next sync. */
const DUP_SCAN_WINDOW = 2000;

export class LocalDispatchRepository
  extends CachedRepository<"dispatches">
  implements DispatchRepository
{
  /** Fingerprint and canonical-URL indexes, kept in step with `items` by this class. */
  private index = new DispatchIndex();

  constructor() {
    super("dispatches", []);
  }
  has(id: string) {
    return this.items.some((d) => d.id === id);
  }
  add(d: RawDispatch) {
    if (this.has(d.id)) return false;
    this.items = [d, ...this.items];
    // Registering here is what catches a second copy of the same post *within one batch*:
    // duplicateOf() only sees what is already stored.
    this.index.fingerprint(d);
    this.index.indexUrl(d);
    this.save(d);
    return true;
  }
  update(id: string, patch: Partial<RawDispatch>) {
    this.items = this.items.map((x) => (x.id === id ? { ...x, ...patch } : x));
    const doc = this.items.find((x) => x.id === id);
    if (!doc) return;
    // dropped first, re-registered below if the document still has text.
    this.index.forget(id);
    this.index.fingerprint(doc);
    this.index.indexUrl(doc);
    this.save(doc, (fresh) => ({ ...fresh, ...patch }));
  }
  pending(limit: number) {
    return this.items
      .filter((d) => d.status === "pending")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit);
  }

  /**
   * Find the already-stored dispatch for this URL, ignoring the document's own id.
   *
   * `excludeId` is what makes this safe to call from `add`: the row being added is already in
   * `this.items`, so without it every dispatch would find itself.
   *
   * A document whose text has been stripped does not suppress. `irrelevant` is the case that
   * matters: the gate rejects on the text it was given, and one feed serving a teaser while
   * another serves the full body is the normal shape of an overlap. If the teaser copy is allowed
   * to suppress, the copy with the actual report in it is dropped and the article is never
   * analysed. The fingerprint path has always had this rule (see `DispatchIndex.fingerprint`), and
   * URL identity has to keep it.
   *
   * A `duplicate` stub is the exception: it has no text either, but it names the canonical post
   * that does, so resolution follows the link rather than stopping.
   */
  duplicateOfUrl(url: string | undefined | null, excludeId?: string): string | null {
    const key = canonicalUrl(url);
    if (!key) return null;
    const hit = this.index.holderOfUrl(key);
    if (hit === undefined || hit === excludeId) return null;
    const doc = this.items.find((d) => d.id === hit);
    if (!doc) return null;
    if (doc.status === "duplicate") {
      return doc.duplicateOf && doc.duplicateOf !== excludeId ? doc.duplicateOf : null;
    }
    return doc.text ? hit : null;
  }

  /**
   * Find the already-stored dispatch this fingerprint duplicates.
   *
   * Exact fingerprints win first (an identical repost or a channel forward), then the near match:
   * the newest dispatches first, because a duplicate almost always lands in the same or the next
   * sync. The scan is capped so a large archive cannot make collection O(n) per post forever.
   */
  duplicateOf(fingerprint: string): string | null {
    const exact = this.index.holderOfFingerprint(fingerprint);
    if (exact !== undefined) return exact;
    for (const d of this.items.slice(0, DUP_SCAN_WINDOW)) {
      if (!d.text) continue;
      const fp = this.index.fingerprint(d);
      if (fp && isNearDuplicate(fingerprint, fp)) return d.id;
    }
    return null;
  }

  override async attach(store: DocumentStore) {
    await super.attach(store);
    // attach() replaces the whole working set (claim() relies on that), so the index is rebuilt
    // lazily against the new one rather than trusted across the swap.
    this.index.clear();
  }
  /**
   * Delegates the exclusive claim to storage. The lease deliberately lives in the store, not
   * in this cache: the cache is a per-tab snapshot and cannot make claiming exclusive.
   */
  async claim(limit: number, leaseMs: number, owner: string) {
    if (!this.store?.claim) return null;
    const ids = await this.store.claim("dispatches", { limit, leaseMs, owner });
    if (ids === null) return null;
    // Re-read so the claimed documents come back with the values just written by any other
    // worker, rather than from a cache that may predate their change.
    await this.attach(this.store);
    // The re-read is the capped window of newest posts. A leased post older than it is still
    // pending in storage and must come back with the lease, or it is skipped and re-leased forever.
    await this.hydrate(ids);
    return ids;
  }
  /**
   * Bring the posts behind these ids into the cache when they are stored but older than the window.
   * Without it `has` answers "no" for a re-served old post, which is then inserted as new and
   * rejected by storage as a conflict.
   */
  async preload(ids: string[]) {
    await this.hydrate(ids);
  }
  async release(ids: string[], owner: string) {
    await this.store?.release?.("dispatches", ids, owner);
  }
}
