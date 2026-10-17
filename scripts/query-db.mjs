import postgres from "postgres";
const sql = postgres("postgres://droneint:droneint@127.0.0.1:5435/droneint");
const rows = await sql`
  SELECT s->>'key' AS key, c->>'value' AS val, c->>'unit' AS unit, c->>'raw' AS raw
  FROM drones, jsonb_array_elements(data->'specs') AS s,
       jsonb_array_elements(s->'claims') AS c
  WHERE s->>'key' IN ('range','speed','payload','endurance','wingspan','weight','warhead','altitude','engine_power','max_speed')
    AND NOT (c ? 'normalized')
  LIMIT 40
`;
for (const r of rows) console.log(r.key, "|", r.val, "|", r.unit, "|", r.raw);
await sql.end();
