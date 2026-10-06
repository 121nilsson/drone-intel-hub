import { createServerFn } from "@tanstack/react-start";
import type { Collection } from "@/shared/contracts/store";

const COLLECTIONS: Collection[] = ["drones", "candidates", "sources"];
const checkCollection = (c: unknown): Collection => {
  if (!COLLECTIONS.includes(c as Collection)) throw new Error("Invalid collection");
  return c as Collection;
};
const checkDoc = (d: unknown) => {
  if (!d || typeof d !== "object" || typeof (d as { id?: unknown }).id !== "string") throw new Error("Invalid document");
  if (JSON.stringify(d).length > 500_000) throw new Error("Document too large");
  return d;
};

async function store() {
  const { PostgresStore } = await import("./postgres/postgres-store.server");
  return new PostgresStore();
}

/** True when the server has a PostgreSQL connection configured. */
export const getStoreStatus = createServerFn({ method: "GET" }).handler(async () => ({
  postgres: !!process.env["DATABASE_URL"],
}));

export const storeLoad = createServerFn({ method: "POST" })
  .inputValidator((d: { c: Collection }) => ({ c: checkCollection(d?.c) }))
  .handler(async ({ data }) => JSON.stringify(await (await store()).load(data.c)));

export const storeSeed = createServerFn({ method: "POST" })
  .inputValidator((d: { c: Collection; items: unknown[] }) => {
    if (!Array.isArray(d?.items)) throw new Error("Invalid items");
    return { c: checkCollection(d.c), items: d.items.map(checkDoc) };
  })
  .handler(async ({ data }) => { await (await store()).seed(data.c, data.items as never); return { ok: true }; });

export const storePut = createServerFn({ method: "POST" })
  .inputValidator((d: { c: Collection; doc: unknown }) => ({ c: checkCollection(d?.c), doc: checkDoc(d?.doc) }))
  .handler(async ({ data }) => { await (await store()).put(data.c, data.doc as never); return { ok: true }; });

export const storeRemove = createServerFn({ method: "POST" })
  .inputValidator((d: { c: Collection; id: string }) => {
    if (typeof d?.id !== "string") throw new Error("Invalid id");
    return { c: checkCollection(d.c), id: d.id };
  })
  .handler(async ({ data }) => { await (await store()).remove(data.c, data.id); return { ok: true }; });
