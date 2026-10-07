import { createServerFn } from "@tanstack/react-start";
import type { Collection } from "@/shared/contracts/store";
import { MAX_LEASE_MS } from "@/features/sources/auto-ingest";

const COLLECTIONS: Collection[] = [
  "drones",
  "candidates",
  "sources",
  "dispatches",
  "procurements",
];
const checkCollection = (c: unknown): Collection => {
  if (!COLLECTIONS.includes(c as Collection)) throw new Error("Invalid collection");
  return c as Collection;
};
const checkDoc = (d: unknown) => {
  if (!d || typeof d !== "object" || typeof (d as { id?: unknown }).id !== "string")
    throw new Error("Invalid document");
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
  .validator((d: { c: Collection }) => ({ c: checkCollection(d?.c) }))
  .handler(async ({ data }) => JSON.stringify(await (await store()).load(data.c)));

export const storeSeed = createServerFn({ method: "POST" })
  .validator((d: { c: Collection; items: unknown[] }) => {
    if (!Array.isArray(d?.items)) throw new Error("Invalid items");
    return { c: checkCollection(d.c), items: d.items.map(checkDoc) };
  })
  .handler(async ({ data }) => {
    await (await store()).seed(data.c, data.items as never);
    return { ok: true };
  });

export const storePut = createServerFn({ method: "POST" })
  .validator((d: { c: Collection; doc: unknown }) => ({
    c: checkCollection(d?.c),
    doc: checkDoc(d?.doc),
  }))
  .handler(async ({ data }) => {
    await (await store()).put(data.c, data.doc as never);
    return { ok: true };
  });

export const storeRemove = createServerFn({ method: "POST" })
  .validator((d: { c: Collection; id: string }) => {
    if (typeof d?.id !== "string") throw new Error("Invalid id");
    return { c: checkCollection(d.c), id: d.id };
  })
  .handler(async ({ data }) => {
    await (await store()).remove(data.c, data.id);
    return { ok: true };
  });

const MAX_CLAIM = 200;

/** Exclusive lease on pending documents. See DocumentStore.claim. */
export const storeClaim = createServerFn({ method: "POST" })
  .validator((d: { c: Collection; limit: number; leaseMs: number; owner: string }) => {
    if (typeof d?.owner !== "string" || d.owner.length > 80) throw new Error("Invalid owner");
    const limit = Math.floor(Number(d.limit));
    const leaseMs = Math.floor(Number(d.leaseMs));
    if (!Number.isFinite(limit) || limit < 1) throw new Error("Invalid limit");
    if (!Number.isFinite(leaseMs) || leaseMs < 1_000) throw new Error("Invalid lease");
    return {
      c: checkCollection(d.c),
      limit: Math.min(limit, MAX_CLAIM),
      // Clamped server-side so a caller cannot pin rows indefinitely. The ceiling must
      // accommodate the largest real batch (120 items => 30 min) with headroom.
      leaseMs: Math.min(leaseMs, MAX_LEASE_MS),
      owner: d.owner,
    };
  })
  .handler(async ({ data }): Promise<{ ids: string[]; ok: boolean }> => {
    const s = await store();
    // A store without claim support (or a collection that is not the queue) must not look
    // like "claimed everything" - signal the caller to fall back.
    if (!s.claim) return { ids: [], ok: false };
    return { ids: await s.claim(data.c, data), ok: true };
  });

export const storeRelease = createServerFn({ method: "POST" })
  .validator((d: { c: Collection; ids: string[]; owner: string }) => {
    if (!Array.isArray(d?.ids) || d.ids.length > MAX_CLAIM) throw new Error("Invalid ids");
    if (!d.ids.every((i) => typeof i === "string")) throw new Error("Invalid ids");
    if (typeof d?.owner !== "string" || d.owner.length > 80) throw new Error("Invalid owner");
    return { c: checkCollection(d.c), ids: d.ids, owner: d.owner };
  })
  .handler(async ({ data }) => {
    const s = await store();
    await s.release?.(data.c, data.ids, data.owner);
    return { ok: true };
  });
