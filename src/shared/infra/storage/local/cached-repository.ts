import type { Subscribable } from "@/shared/contracts/repository";
import {
  DocumentConflictError,
  type Collection,
  type CollectionMap,
  type DocumentStore,
  type VersionedDoc,
} from "@/shared/contracts/store";
import { StorageProblems } from "./storage-problems";
import { WriteQueue } from "./write-queue";

export type Replay<T> = (fresh: T) => T;

/**
 * Write-through cache: synchronous reads for the UI, async persistence to any DocumentStore.
 * Swapping storage = attaching a different store; features never change.
 */
export abstract class CachedRepository<C extends Collection> implements Subscribable {
  private fns = new Set<() => void>();
  private problems = new StorageProblems();
  private queue = new WriteQueue();
  protected store: DocumentStore | null = null;
  /** Revision of each document in `items`, as last read from or written to the store. */
  protected revs = new Map<string, number>();
  constructor(
    protected collection: C,
    protected items: CollectionMap[C][],
  ) {}
  subscribe(fn: () => void) {
    this.fns.add(fn);
    return () => {
      this.fns.delete(fn);
    };
  }
  protected emit() {
    this.fns.forEach((f) => f());
  }

  /**
   * Failures the UI has to know about: a write the store refused, a conflict whose edit could
   * not be saved, or a delete that did not happen. Kept separate from `subscribe` because a
   * storage problem must survive the cache reload that follows it.
   */
  onStorageError(fn: (message: string) => void) {
    return this.problems.subscribe(fn);
  }

  /**
   * A failed write may have advanced a revision or may have landed despite the error. Reload the
   * stored truth so the cache does not keep showing an edit that was not saved; if even the
   * reload fails, the warning above is all the UI can trust.
   */
  private async recoverAfterFailure(message: string, cause: unknown) {
    this.problems.report(message, cause);
    try {
      await this.reload();
    } catch (e) {
      this.problems.report(`could not reload ${this.collection}`, e);
    }
  }

  /** Replace the cache with a store snapshot, revisions included. */
  protected adopt(loaded: VersionedDoc<CollectionMap[C]>[]) {
    this.items = loaded.map((entry) => entry.doc);
    this.revs = new Map(loaded.map((entry) => [entry.doc.id, entry.rev]));
  }

  async attach(store: DocumentStore) {
    // Load and seed before switching the pointer: a failed attach must leave the repository on
    // its previous store, never half-attached to one that cannot read or write it.
    const loaded = await store.load(this.collection);
    if (loaded === null) {
      await store.seed(this.collection, this.items);
      this.store = store;
      this.revs = new Map(this.items.map((doc) => [doc.id, 0]));
    } else {
      this.adopt(loaded);
      this.store = store;
      this.emit();
    }
  }

  /**
   * Re-read this collection. A null load is left as-is so a missing collection is not reseeded
   * the way attach() would. `apply` runs after the read so a caller can drop a snapshot that
   * went stale while the load was in flight.
   */
  async reload(apply: () => boolean = () => true) {
    if (!this.store) return;
    const loaded = await this.store.load(this.collection);
    if (!loaded || !apply()) return;
    this.adopt(loaded);
    this.emit();
  }

  /**
   * Bring stored documents the capped window left out into the cache, so `has` and `list` can see
   * them. Documents already cached are left as they are (they may carry a pending local edit);
   * the rest are appended, since the window is ordered newest first and these are older. Returns
   * the number brought in.
   */
  async hydrate(ids: string[]): Promise<number> {
    const store = this.store;
    if (!store?.loadByIds) return 0;
    const have = new Set(this.items.map((x) => x.id));
    const missing = [...new Set(ids)].filter((id) => !have.has(id));
    if (!missing.length) return 0;
    const found = await store.loadByIds(this.collection, missing);
    // Collection lanes run in parallel: another hydrate may have landed while this one waited.
    const nowHave = new Set(this.items.map((x) => x.id));
    const fresh = found.filter((entry) => !nowHave.has(entry.doc.id));
    if (!fresh.length) return 0;
    this.items = [...this.items, ...fresh.map((entry) => entry.doc)];
    for (const entry of fresh) this.revs.set(entry.doc.id, entry.rev);
    this.emit();
    return fresh.length;
  }

  /** Wait until every queued write and delete for this repository has settled. */
  async flush() {
    await this.queue.flush();
  }

  /**
   * Persist a document the caller has already placed in `items`.
   *
   * `replay` is what makes a conflict recoverable: after another writer changes the stored
   * copy, it receives the fresh document and returns the change applied to it. Callers that
   * cannot reapply their edit should omit it - the cache is then reloaded, so the user sees
   * the stored truth rather than an edit that was silently thrown away.
   */
  protected save(doc: CollectionMap[C], replay?: Replay<CollectionMap[C]>) {
    this.emit();
    const store = this.store;
    if (!store) return;
    this.track(store, doc, replay);
  }

  private track(store: DocumentStore, doc: CollectionMap[C], replay?: Replay<CollectionMap[C]>) {
    this.queue.enqueue(
      doc.id,
      () => this.persist(store, doc, replay),
      (e) => this.problems.report(`could not save ${this.collection}`, e),
    );
  }

  /**
   * Conflict loop for one write: the revision this cache last saw is sent as `expectedRev`. On a
   * conflict the cache is reloaded and `replay` reapplies the edit to the fresh copy, up to three
   * attempts; without a replay (or without the document after reload) the edit is reported as
   * lost and the stored copy stays.
   */
  private async persist(
    store: DocumentStore,
    doc: CollectionMap[C],
    replay?: Replay<CollectionMap[C]>,
  ) {
    let candidate = doc;
    for (let attempt = 0; attempt < 3; attempt++) {
      const expected = this.revs.get(candidate.id) ?? null;
      try {
        const rev = await store.put(this.collection, candidate, expected);
        this.revs.set(candidate.id, rev);
        return;
      } catch (e) {
        if (!(e instanceof DocumentConflictError)) {
          await this.recoverAfterFailure(`could not save ${this.collection}/${candidate.id}`, e);
          return;
        }
        await this.reload();
        const fresh = this.items.find((x) => x.id === candidate.id);
        if (!replay || !fresh) {
          this.problems.report(
            `${this.collection}/${candidate.id} changed in another session; your edit was reloaded, not saved`,
          );
          return;
        }
        candidate = replay(fresh);
        // Only replace the optimistic copy if it is still the one this write was based on; a
        // newer local edit belongs to the next write in the chain.
        const current = this.items.find((x) => x.id === candidate.id);
        if (current === doc || current === fresh) {
          this.items = this.items.map((x) => (x.id === candidate.id ? candidate : x));
          this.emit();
        }
      }
    }
    this.problems.report(
      `${this.collection}/${doc.id} kept changing in other sessions; the stored copy was reloaded`,
    );
    await this.reload();
  }

  protected drop(id: string) {
    this.emit();
    const store = this.store;
    if (!store) {
      this.revs.delete(id);
      return;
    }
    this.queue.enqueue(
      id,
      async () => {
        await store.remove(this.collection, id);
        // Keep the revision until the delete has actually run: a save queued before this drop
        // still has to update the existing document, and a save queued after it must insert.
        this.revs.delete(id);
      },
      (e) => this.recoverAfterFailure(`could not delete ${this.collection}/${id}`, e),
    );
  }

  list() {
    return this.items;
  }
}
