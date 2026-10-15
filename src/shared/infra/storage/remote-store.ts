import type { Collection, CollectionMap, DocumentStore } from "@/shared/contracts/store";
import {
  storeClaim,
  storeLoad,
  storePut,
  storeRelease,
  storeRemove,
  storeSeed,
} from "./store.functions";

/** Browser-side bridge to the server's DocumentStore (PostgreSQL) via server functions. */
export class RemoteStore implements DocumentStore {
  async load<C extends Collection>(c: C) {
    return JSON.parse(await storeLoad({ data: { c } })) as CollectionMap[C][] | null;
  }
  async seed<C extends Collection>(c: C, items: CollectionMap[C][]) {
    await storeSeed({ data: { c, items } });
  }
  async put<C extends Collection>(c: C, doc: CollectionMap[C]) {
    await storePut({ data: { c, doc } });
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
