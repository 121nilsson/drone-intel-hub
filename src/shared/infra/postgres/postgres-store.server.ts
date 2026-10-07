import type { Collection, CollectionMap, DocumentStore } from "@/shared/contracts/store";
import { db, type Sql } from "./db.server";

const ORDER: Record<Collection, string> = {
  drones: "name asc",
  candidates: "created_at desc",
  sources: "position desc",
  // Newest first; capped so the browser cache stays bounded as the archive grows.
  dispatches: "created_at desc limit 3000",
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
      await db`insert into dispatches (id, source_id, status, created_at, processed_at, data)
        values (${d.id}, ${d.sourceId}, ${d.status}, ${d.createdAt}, ${d.processedAt ?? null}, ${data})
        on conflict (id) do update set status = excluded.status, processed_at = excluded.processed_at, data = excluded.data`;
    } else {
      const d = doc as CollectionMap["sources"];
      await db`insert into sources (id, platform, handle, data)
        values (${d.id}, ${d.platform}, ${d.handle}, ${data})
        on conflict (id) do update set platform = excluded.platform, handle = excluded.handle, data = excluded.data`;
    }
  }
}
