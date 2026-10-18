import fs from "fs";
import postgres from "postgres";
const sql = postgres(
  process.env.DATABASE_URL || "postgres://droneint:droneint@127.0.0.1:5435/droneint",
);

const rows =
  await sql`select id, kind, fixture from eval_corpus where status='approved' order by id`;
const positives = [];
const negatives = [];
for (const r of rows) {
  const fx = r.fixture;
  if (r.kind === "positive") positives.push(fx);
  else negatives.push(fx);
}
fs.writeFileSync("src/test/fixtures/eval-corpus.json", JSON.stringify(positives, null, 2) + "\n");
fs.writeFileSync(
  "src/test/fixtures/eval-mismatches.json",
  JSON.stringify(negatives, null, 2) + "\n",
);
console.log(`exported ${positives.length} positives, ${negatives.length} negatives`);
await sql.end();
