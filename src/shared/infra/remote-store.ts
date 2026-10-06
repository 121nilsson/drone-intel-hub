import type { Collection, CollectionMap, DocumentStore } from "@/shared/contracts/store";
import { storeLoad, storePut, storeRemove, storeSeed } from "./store.functions";

/** Browser-side bridge to the server's DocumentStore (PostgreSQL) via server functions. */
export class RemoteStore implements DocumentStore {
  async load<C extends Collection>(c: C) {
    return JSON.parse(await storeLoad({ data: { c } })) as CollectionMap[C][] | null;
  }
  async seed<C extends Collection>(c: C, items: CollectionMap[C][]) { await storeSeed({ data: { c, items } }); }
  async put<C extends Collection>(c: C, doc: CollectionMap[C]) { await storePut({ data: { c, doc } }); }
  async remove(c: Collection, id: string) { await storeRemove({ data: { c, id } }); }
}
