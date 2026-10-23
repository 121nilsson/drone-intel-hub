import {
  DocumentConflictError,
  type Collection,
  type CollectionMap,
  type DocumentStore,
  type VersionedDoc,
} from "@/shared/contracts/store";
import {
  storeClaim,
  storeLoadPage,
  storePut,
  storeRelease,
  storeRemove,
  storeSeed,
} from "./store.functions";

interface LoadedPage<T> {
  initialized: boolean;
  items: VersionedDoc<T>[];
  hasMore: boolean;
}

/** Browser-side bridge to the server's DocumentStore (PostgreSQL) via server functions. */
export class RemoteStore implements DocumentStore {
  /**
   * The server returns bounded pages, never the whole collection: a large catalog used to
   * exceed the server function's serialized-output ceiling and surfaced as "catalog unavailable".
   */
  async load<C extends Collection>(c: C): Promise<VersionedDoc<CollectionMap[C]>[] | null> {
    const items: VersionedDoc<CollectionMap[C]>[] = [];
    // Inserts that land while pages are being read can shift an offset; keeping the first copy
    // of an id stops that from showing the same document twice in the adopted catalog.
    const seen = new Set<string>();
    let offset = 0;
    for (let pages = 0; pages < 10_000; pages++) {
      const page = JSON.parse(await storeLoadPage({ data: { c, offset } })) as LoadedPage<
        CollectionMap[C]
      >;
      if (!page.initialized) return null;
      for (const item of page.items) {
        if (seen.has(item.doc.id)) continue;
        seen.add(item.doc.id);
        items.push(item);
      }
      if (!page.hasMore) return items;
      if (!page.items.length) throw new Error(`Storage page for ${c} made no progress`);
      offset += page.items.length;
    }
    throw new Error(`Storage for ${c} returned too many pages`);
  }
  async seed<C extends Collection>(c: C, items: CollectionMap[C][]) {
    await storeSeed({ data: { c, items } });
  }
  async put<C extends Collection>(
    c: C,
    doc: CollectionMap[C],
    expectedRev: number | null,
  ): Promise<number> {
    const result = await storePut({ data: { c, doc, expectedRev } });
    if (!result.ok) throw new DocumentConflictError(c, doc.id);
    return result.rev;
  }
  async remove(c: Collection, id: string) {
    await storeRemove({ data: { c, id } });
  }

  /** null means the backing store cannot lease (no claim support), so the caller should
   *  fall back to plain reads rather than treating it as "nothing to do". */
  async claim(
    c: Collection,
    opts: { limit: number; leaseMs: number; owner: string },
  ): Promise<string[] | null> {
    const r = await storeClaim({ data: { c, ...opts } });
    return r.ok ? r.ids : null;
  }
  async release(c: Collection, ids: string[], owner: string) {
    if (ids.length) await storeRelease({ data: { c, ids, owner } });
  }
}
