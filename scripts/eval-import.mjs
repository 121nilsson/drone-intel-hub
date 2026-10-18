import fs from "fs";
import postgres from "postgres";
const sql = postgres(
  process.env.DATABASE_URL || "postgres://droneint:droneint@127.0.0.1:5435/droneint",
);

let imported = 0,
  skipped = 0;
for (const [file, kind] of [
  ["src/test/fixtures/eval-corpus.json", "positive"],
  ["src/test/fixtures/eval-mismatches.json", "negative"],
]) {
  if (!fs.existsSync(file)) continue;
  const arr = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const fx of arr) {
    const ex = await sql`select 1 from eval_corpus where id=${fx.id} and origin='git_import'`;
    if (ex.length) {
      skipped++;
      continue;
    }
    await sql`insert into eval_corpus (id, version, kind, fixture, status, origin, observed_at)
      values (${fx.id}, 1, ${kind}, ${sql.json(fx)}, 'approved', 'git_import', now())`;
    imported++;
  }
}
console.log(`imported ${imported}, skipped ${skipped}`);
await sql.end();
