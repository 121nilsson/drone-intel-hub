import { createServerFn } from "@tanstack/react-start";
import type { ProviderEnvConfig } from "@/shared/contracts/ai";
import { COLLECTIONS, DocumentConflictError, type Collection } from "@/shared/contracts/store";
import { MAX_LEASE_MS } from "@/shared/infra/ingest/auto-ingest";

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
/** `null` is the insert-only case; a number is the revision the caller read. */
const checkRev = (r: unknown): number | null => {
  if (r === null) return null;
  const n = Number(r);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("Invalid revision");
  return n;
};

/** DATABASE_URL (self-hosted PostgreSQL) wins; otherwise Lovable Cloud when configured. */
async function store() {
  if (process.env["DATABASE_URL"]) {
    const { PostgresStore } = await import("../postgres/postgres-store.server");
    return new PostgresStore();
  }
  const { CloudStore } = await import("../cloud/cloud-store.server");
  return new CloudStore();
}

/** Storage backend plus non-secret inference settings for the Settings UI. */
export const getStoreStatus = createServerFn({ method: "POST" }).handler(async () => {
  const postgres =
    !!process.env["DATABASE_URL"] ||
    (!!process.env["SUPABASE_URL"] && !!process.env["SUPABASE_SERVICE_ROLE_KEY"]);

  // The provider settings are optional and live in a different system from the catalog. A
  // failure to read them must not make the client think there is no server storage and switch to
  // a browser catalog - that is precisely the silent fork this status call exists to prevent.
  let provider: ProviderEnvConfig | null = null;
  let providerError: string | null = null;
  try {
    const { readProviderEnvConfig } = await import("../provider-env.server");
    provider = await readProviderEnvConfig();
  } catch (e) {
    providerError = e instanceof Error ? e.message : String(e);
    console.error("[store] provider settings unavailable", e);
  }

  return { postgres, provider, providerError };
});

/**
 * One bounded slice of a collection.
 *
 * The whole candidates collection is already over the server-function output ceiling, and the
 * dispatches cap can grow past it too. Returning the catalog as one string made a large catalog
 * look like a broken storage backend. The byte budget keeps the serialized string (including
 * JSON escaping) well below the transport limit; the doc limit bounds the database read.
 */
const LOAD_PAGE_DOCS = 200;
const LOAD_PAGE_BYTES = 4 * 1024 * 1024;

export const storeLoadPage = createServerFn({ method: "POST" })
  .validator((d: { c: Collection; offset?: unknown }) => {
    const offset = Number(d?.offset ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid offset");
    return { c: checkCollection(d?.c), offset };
  })
  .handler(async ({ data }) => {
    const s = await store();
    const page = await s.loadPage(data.c, { offset: data.offset, limit: LOAD_PAGE_DOCS });
    if (!page) return JSON.stringify({ initialized: false, items: [], hasMore: false });
    const items: unknown[] = [];
    let bytes = 0;
    for (const item of page.items) {
      const size = JSON.stringify(item).length + 1;
      if (items.length && bytes + size > LOAD_PAGE_BYTES) break;
      items.push(item);
      bytes += size;
    }
    return JSON.stringify({
      initialized: true,
      items,
      hasMore: page.hasMore || items.length < page.items.length,
    });
  });

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
  .validator((d: { c: Collection; doc: unknown; expectedRev: unknown }) => ({
    c: checkCollection(d?.c),
    doc: checkDoc(d?.doc),
    expectedRev: checkRev(d?.expectedRev),
  }))
  .handler(async ({ data }): Promise<{ ok: true; rev: number } | { ok: false }> => {
    try {
      const rev = await (await store()).put(data.c, data.doc as never, data.expectedRev);
      return { ok: true, rev };
    } catch (e) {
      // A stale revision is an expected outcome, not a server fault: the caller reloads and
      // reapplies. Anything else is a real storage failure and must surface as one.
      if (e instanceof DocumentConflictError) return { ok: false };
      throw e;
    }
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

/**
 * Archive-truth counters for the intel feed header. The dispatches load cap is a browser-cache
 * bound, not a count, and the page cannot see past it - the header otherwise shows "3000 of 3000"
 * forever on an archive that grows by hundreds a day. Null when no server backend is configured,
 * so the caller keeps its loaded-window numbers (exact whenever the archive fits the cap).
 */
export const fetchDispatchCounts = createServerFn({ method: "POST" }).handler(async () => {
  const { dispatchCounts } = await import("./dispatch-counts.server");
  return dispatchCounts();
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
    const ids = await s.claim(data.c, data);
    if (ids === null) return { ids: [], ok: false };
    return { ids, ok: true };
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
