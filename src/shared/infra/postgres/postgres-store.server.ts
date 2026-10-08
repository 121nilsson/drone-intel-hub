import type { Collection, CollectionMap, DocumentStore } from "@/shared/contracts/store";
import { db, type Sql } from "./db.server";

const ORDER: Record<Collection, string> = {
  drones: "name asc",
  candidates: "created_at desc",
  sources: "position desc",
  // Newest first; capped so the browser cache stays bounded as the archive grows.
  dispatches: "created_at desc limit 3000",
  procurements: "created_at desc",
  taxonomies: "taxonomy asc, canonical_id asc",
  taxonomy_candidates: "last_seen desc",
};

/** PostgreSQL implementation. Schema lives in /migrations (plain SQL, portable). */
export class PostgresStore implements DocumentStore {
  async load<C extends Collection>(c: C) {
    const conn = db();
    const rows = await conn.unsafe<{ data: CollectionMap[C] }[]>(
      `select data from ${c} order by ${ORDER[c]}`,
    );
    if (rows.length === 0) {
      const [meta] = await conn`select 1 from collection_meta where name = ${c}`;
      if (!meta) return null;
    }
    return rows.map((r) => r.data);
  }

  /**
   * Exclusive claim via `for update skip locked`.
   *
   * `skip locked` is what makes this safe under concurrency: two workers selecting the same
   * pending rows do not block each other, the second simply skips past whatever the first
   * has locked and takes a different batch. Combined with the `lease_until` predicate, a
   * document is either claimed by exactly one worker or not claimed at all.
   *
   * One statement, so claim-and-stamp cannot interleave. `now()` is transaction time, so every
   * row in a batch gets the same expiry.
   */
  async claim(c: Collection, opts: { limit: number; leaseMs: number; owner: string }) {
    const conn = db();
    const { limit, leaseMs, owner } = opts;
    const rows = await conn.unsafe<{ id: string }[]>(
      `update dispatches
          set lease_until = now() + ($2::int * interval '1 millisecond'),
              lease_by = $3
        where id in (
          select id from dispatches
           where status = 'pending'
             and (lease_until is null or lease_until < now())
           order by created_at asc
           limit $1
           for update skip locked
        )
        returning id`,
      [limit, leaseMs, owner],
    );
    return rows.map((r) => r.id);
  }

  async release(c: Collection, ids: string[], owner: string) {
    if (!ids.length) return;
    await db().unsafe(
      `update dispatches set lease_until = null, lease_by = null
        where id = any($1::text[]) and lease_by = $2`,
      [ids, owner],
    );
  }

  async seed<C extends Collection>(c: C, items: CollectionMap[C][]) {
    const conn = db();
    await conn.begin(async (tx) => {
      const [meta] = await tx`select 1 from collection_meta where name = ${c} for update`;
      if (meta) return;
      for (const doc of [...items].reverse()) await this.upsert(tx as unknown as Sql, c, doc);
      await tx`insert into collection_meta (name) values (${c})`;
    });
  }

  async put<C extends Collection>(c: C, doc: CollectionMap[C]) {
    const conn = db();
    await this.upsert(conn, c, doc);
    await conn`insert into collection_meta (name) values (${c}) on conflict do nothing`;
  }

  async remove(c: Collection, id: string) {
    await db().unsafe(`delete from ${c} where id = $1`, [id]);
  }

  private async upsert<C extends Collection>(db: Sql, c: C, doc: CollectionMap[C]) {
    const data = db.json(doc as never);
    if (c === "drones") {
      const d = doc as CollectionMap["drones"];
      await db`insert into drones (id, name, domain, origin, data, updated_at)
        values (${d.id}, ${d.name}, ${d.domain}, ${d.origin}, ${data}, now())
        on conflict (id) do update set name = excluded.name, domain = excluded.domain,
          origin = excluded.origin, data = excluded.data, updated_at = now()`;
    } else if (c === "candidates") {
      const d = doc as CollectionMap["candidates"];
      await db`insert into candidates (id, status, tier, created_at, data)
        values (${d.id}, ${d.status}, ${d.tier}, ${d.createdAt}, ${data})
        on conflict (id) do update set status = excluded.status, tier = excluded.tier, data = excluded.data`;
    } else if (c === "dispatches") {
      const d = doc as CollectionMap["dispatches"];
      // The lease columns are deliberately not written here. A `put` carries only document
      // data, and the caller may be holding a stale cached copy - letting it stamp lease_until
      // would either extend a dead worker's lease or clear a live one. Only claim/release
      // touch them, which is what keeps claiming exclusive.
      await db`insert into dispatches (id, source_id, status, created_at, processed_at, data)
        values (${d.id}, ${d.sourceId}, ${d.status}, ${d.createdAt}, ${d.processedAt ?? null}, ${data})
        on conflict (id) do update set status = excluded.status, processed_at = excluded.processed_at, data = excluded.data`;
    } else if (c === "procurements") {
      const d = doc as CollectionMap["procurements"];
      await db`insert into procurements (id, company, country, amount, currency, program, product, customer, announced_at, source, source_url, notes, created_at, data)
        values (${d.id}, ${d.company}, ${d.country ?? ""}, ${d.amount ?? null}, ${d.currency ?? null}, ${d.program ?? null}, ${d.product ?? null}, ${d.customer ?? null}, ${d.announcedAt ?? null}, ${d.source}, ${d.sourceUrl ?? null}, ${d.notes ?? null}, ${d.createdAt}, ${data})
        on conflict (id) do update set company = excluded.company, country = excluded.country, amount = excluded.amount, currency = excluded.currency, program = excluded.program, product = excluded.product, customer = excluded.customer, announced_at = excluded.announced_at, source = excluded.source, source_url = excluded.source_url, notes = excluded.notes, data = excluded.data`;
    } else if (c === "taxonomies") {
      const d = doc as CollectionMap["taxonomies"];
      await db`insert into taxonomies (id, taxonomy, canonical_id, label, parent_id, data, updated_at)
        values (${d.id}, ${d.taxonomy}, ${d.canonicalId}, ${d.label}, ${d.parentId ?? null}, ${data}, now())
        on conflict (id) do update set taxonomy = excluded.taxonomy, canonical_id = excluded.canonical_id,
          label = excluded.label, parent_id = excluded.parent_id, data = excluded.data, updated_at = now()`;
    } else if (c === "taxonomy_candidates") {
      const d = doc as CollectionMap["taxonomy_candidates"];
      await db`insert into taxonomy_candidates (id, taxonomy, raw_term, status, occurrences, first_seen, last_seen, data)
        values (${d.id}, ${d.taxonomy}, ${d.rawTerm}, ${d.status}, ${d.occurrences}, ${d.firstSeen}, ${d.lastSeen}, ${data})
        on conflict (id) do update set status = excluded.status, occurrences = excluded.occurrences,
          last_seen = excluded.last_seen, data = excluded.data`;
    } else if (c === "sources") {
      const d = doc as CollectionMap["sources"];
      await db`insert into sources (id, platform, handle, data)
        values (${d.id}, ${d.platform}, ${d.handle}, ${data})
        on conflict (id) do update set platform = excluded.platform, handle = excluded.handle, data = excluded.data`;
    } else {
      const _exhaustive: never = c;
      throw new Error(`No column layout for ${String(_exhaustive)}`);
    }
  }
}
