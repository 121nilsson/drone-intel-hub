/**
 * One-off repair: give the systems promoted before ids were transliterated (fba98aa) a readable
 * id. The old id builder dropped every non-Latin letter, so "Панцирь" became "-c232" and its page
 * /systems/-c232. The new id is the name's slug plus the old suffix: "pantsir-c232".
 *
 * The id is the key other documents point at, so every reference moves with it, in one
 * transaction: the entry itself, typed relations and legacy links on other entries, candidates'
 * match ids, resolvedInto and variantOf, archived posts' droneIds, audit rows and ledger targets.
 * Composite strings that embed an id (a relation's own id, an llmBrief provenance line) are
 * rewritten too; free prose is not.
 *
 *   npx tsx --env-file=.env.local scripts/rename-legacy-system-ids.ts           # dry run
 *   npx tsx --env-file=.env.local scripts/rename-legacy-system-ids.ts --apply   # write
 *
 * Idempotent: a second run finds no legacy ids and changes nothing. Reload open tabs afterwards;
 * a stale tab's write to an old id is refused as a conflict, never re-created.
 */
import postgres from "postgres";
import { systemSlug } from "@/entities/drone/name-key";

const apply = process.argv.includes("--apply");
const sql = postgres(
  process.env.DATABASE_URL || "postgres://droneint:droneint@127.0.0.1:5435/droneint",
);

/** Paths whose strings embed an id among other text, rewritten at token boundaries. */
const COMPOSITE = /\.relations\[\]\.id$|\.llmBrief\.provenance\[\]$/;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");

function rewrite(
  value: unknown,
  renames: Map<string, string>,
  token: RegExp,
  path: string,
  hits: Map<string, number>,
): unknown {
  if (typeof value === "string") {
    const exact = renames.get(value);
    if (exact) {
      hits.set(path, (hits.get(path) ?? 0) + 1);
      return exact;
    }
    if (COMPOSITE.test(path) && token.test(value)) {
      hits.set(`${path} (embedded)`, (hits.get(`${path} (embedded)`) ?? 0) + 1);
      return value.replace(token, (m, pre: string, id: string) => pre + renames.get(id)!);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => rewrite(v, renames, token, `${path}[]`, hits));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, rewrite(v, renames, token, `${path}.${k}`, hits)]),
    );
  return value;
}

async function main() {
  const legacy = await sql<{ id: string; name: string }[]>`
    select id, name from drones where id ~ '^-' order by name`;
  if (!legacy.length) {
    console.log("No legacy ids: nothing to do.");
    return;
  }
  const existing = new Set((await sql<{ id: string }[]>`select id from drones`).map((r) => r.id));
  const renames = new Map<string, string>();
  for (const { id, name } of legacy) {
    const next = `${systemSlug(name)}${id}`;
    if (existing.has(next) || [...renames.values()].includes(next))
      throw new Error(`${id} (${name}) would become ${next}, which is taken`);
    renames.set(id, next);
  }
  for (const { id, name } of legacy)
    console.log(`${id.padEnd(8)} → ${renames.get(id)!.padEnd(26)} ${name}`);

  const token = new RegExp(
    `(^|[^a-z0-9])(${[...renames.keys()].map(escape).join("|")})(?![a-z0-9])`,
    "g",
  );
  const hits = new Map<string, number>();

  await sql
    .begin(async (tx) => {
      for (const table of ["drones", "candidates", "dispatches", "procurements"] as const) {
        const rows = await tx.unsafe<{ id: string; data: unknown }[]>(
          `select id, data from ${table}`,
        );
        for (const row of rows) {
          const before = JSON.stringify(row.data);
          const data = rewrite(row.data, renames, token, table, hits);
          const newId = table === "drones" ? (renames.get(row.id) ?? row.id) : row.id;
          if (JSON.stringify(data) === before && newId === row.id) continue;
          if (!apply) continue;
          if (newId !== row.id) {
            // A new row under the new key; the old one goes. rev moves on, so a tab holding the old
            // document gets a conflict instead of overwriting.
            await tx`insert into drones (id, name, domain, origin, data, updated_at, rev)
            select ${newId}, name, domain, origin, ${tx.json(data as never)}, now(), rev + 1
              from drones where id = ${row.id}`;
            await tx`delete from drones where id = ${row.id}`;
          } else {
            // tx.json(), not JSON.stringify: a string parameter for a jsonb column is encoded a
            // second time and stored as a JSON string (see migrations/022).
            await tx.unsafe(`update ${table} set data = $1, rev = rev + 1 where id = $2`, [
              tx.json(data as never) as never,
              row.id,
            ]);
          }
        }
      }
      for (const [from, to] of renames) {
        const a = await tx`update verification_audit set drone_id = ${to} where drone_id = ${from}`;
        const l = await tx`update autonomy_events set target_id = ${to}
        where target_collection = 'drones' and target_id = ${from}`;
        if (a.count)
          hits.set(
            "verification_audit.drone_id",
            (hits.get("verification_audit.drone_id") ?? 0) + a.count,
          );
        if (l.count)
          hits.set(
            "autonomy_events.target_id",
            (hits.get("autonomy_events.target_id") ?? 0) + l.count,
          );
      }
      if (!apply) throw new DryRun();
    })
    .catch((e) => {
      if (!(e instanceof DryRun)) throw e;
    });

  console.log(`\nReferences ${apply ? "rewritten" : "that would be rewritten"}:`);
  for (const [path, n] of [...hits].sort()) console.log(`  ${String(n).padStart(4)}  ${path}`);
  console.log(apply ? "\nApplied." : "\nDry run: nothing written. Re-run with --apply.");
}

class DryRun extends Error {}

await main().finally(() => sql.end());
