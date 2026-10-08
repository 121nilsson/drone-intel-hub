import type { Collection, CollectionMap, DocumentStore } from "@/shared/contracts/store";

/** True when the server has Lovable Cloud credentials. */
export function cloudConfigured() {
  return !!process.env["SUPABASE_URL"] && !!process.env["SUPABASE_SERVICE_ROLE_KEY"];
}

async function client() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Tables are generic document tables; the typed client adds nothing here.
  return supabaseAdmin as unknown as {
    from(t: string): any; // eslint-disable-line @typescript-eslint/no-explicit-any
    rpc(f: string, a: Record<string, unknown>): any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
}

const ORDER: Record<Collection, { col: string; asc: boolean; limit?: number }> = {
  drones: { col: "name", asc: true },
  candidates: { col: "created_at", asc: false },
  sources: { col: "position", asc: false },
  dispatches: { col: "created_at", asc: false, limit: 3000 },
  procurements: { col: "created_at", asc: false },
};

function check<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

/** Hot columns mirrored from the document, same layout as /migrations. */
function row<C extends Collection>(c: C, doc: CollectionMap[C]): Record<string, unknown> {
  const d = doc as never as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  switch (c) {
    case "drones":
      return { id: d.id, name: d.name, domain: d.domain, origin: d.origin, data: doc, updated_at: new Date().toISOString() };
    case "candidates":
      return { id: d.id, status: d.status, tier: d.tier, created_at: d.createdAt, data: doc };
    case "dispatches":
      // Lease columns deliberately omitted - only claim/release touch them.
      return { id: d.id, source_id: d.sourceId, status: d.status, created_at: d.createdAt, processed_at: d.processedAt ?? null, data: doc };
    case "procurements":
      return {
        id: d.id, company: d.company, country: d.country ?? "", amount: d.amount ?? null, currency: d.currency ?? null,
        program: d.program ?? null, product: d.product ?? null, customer: d.customer ?? null, announced_at: d.announcedAt ?? null,
        source: d.source, source_url: d.sourceUrl ?? null, notes: d.notes ?? null, created_at: d.createdAt, data: doc,
      };
    default:
      return { id: d.id, platform: d.platform, handle: d.handle, data: doc };
  }
}

/** Lovable Cloud implementation of the DocumentStore contract (server-only). */
export class CloudStore implements DocumentStore {
  async load<C extends Collection>(c: C) {
    const db = await client();
    const o = ORDER[c];
    let q = db.from(c).select("data").order(o.col, { ascending: o.asc });
    if (o.limit) q = q.limit(o.limit);
    const rows = check<{ data: CollectionMap[C] }[]>(await q);
    if (rows.length === 0) {
      const meta = check<unknown[]>(await db.from("collection_meta").select("name").eq("name", c));
      if (!meta.length) return null;
    }
    return rows.map((r) => r.data);
  }

  async seed<C extends Collection>(c: C, items: CollectionMap[C][]) {
    const db = await client();
    // Claim the seed slot first; a concurrent seeder loses the insert and stops.
    const r = await db.from("collection_meta").insert({ name: c });
    if (r.error) return;
    const rows = [...items].reverse().map((d) => row(c, d));
    for (let i = 0; i < rows.length; i += 200) check(await db.from(c).upsert(rows.slice(i, i + 200)));
  }

  async put<C extends Collection>(c: C, doc: CollectionMap[C]) {
    const db = await client();
    check(await db.from(c).upsert(row(c, doc)));
    await db.from("collection_meta").upsert({ name: c }, { ignoreDuplicates: true });
  }

  async remove(c: Collection, id: string) {
    check(await (await client()).from(c).delete().eq("id", id));
  }

  async claim(c: Collection, opts: { limit: number; leaseMs: number; owner: string }) {
    if (c !== "dispatches") return null;
    const r = await (await client()).rpc("claim_dispatches", {
      p_limit: opts.limit, p_lease_ms: opts.leaseMs, p_owner: opts.owner,
    });
    if (r.error) return null;
    return (r.data as (string | { claim_dispatches: string })[]).map((x) => (typeof x === "string" ? x : x.claim_dispatches));
  }

  async release(c: Collection, ids: string[], owner: string) {
    if (c !== "dispatches" || !ids.length) return;
    await (await client()).rpc("release_dispatches", { p_ids: ids, p_owner: owner });
  }
}
