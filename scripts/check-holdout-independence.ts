/**
 * V4 gate (package 3): is a new language holdout independent of the consumed one?
 *
 * Accepted only if the new module imports and re-exports nothing, and neither its row ids nor its
 * canonical text hashes (method in `HOLDOUT_TEXT_HASH_METHOD`) overlap the consumed holdout's. It
 * fails safe: anything it cannot read or verify means "not accepted" (exit 2).
 *
 * Prints counts, reasons, the hash method and the modules' file hashes only. It never prints a
 * text, an excerpt or a text hash. It does not run the detector, so it is not an evaluation.
 *
 *   npx tsx scripts/check-holdout-independence.ts --new v2 --consumed v1
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  HOLDOUT_TEXT_HASH_METHOD,
  holdoutFixtureFor,
  holdoutIndependence,
  holdoutModuleSpecifier,
} from "../src/entities/normalization/language-holdout";
import { sha256Hex } from "../src/entities/normalization/sha256";

function refuse(message: string): never {
  process.stderr.write(`not accepted: ${message}\n`);
  process.exit(2);
}

const args = process.argv.slice(2);
const idFor = (flag: string): string => {
  if (args.filter((a) => a === flag).length !== 1) refuse(`give ${flag} <id> exactly once`);
  const v = args[args.indexOf(flag) + 1];
  if (v === undefined || v.startsWith("--")) refuse(`${flag} needs a holdout id`);
  return v;
};
const newId = idFor("--new");
const consumedId = idFor("--consumed");
if (newId === consumedId) refuse("--new and --consumed name the same holdout");

async function load(id: string): Promise<{ rows: unknown; source: string; fileSha256: string }> {
  const fixture = holdoutFixtureFor(id);
  if (fixture === undefined) refuse(`invalid holdout id "${id}"`);
  const url = new URL(holdoutModuleSpecifier(fixture), import.meta.url);
  const source = readFileSync(fileURLToPath(url), "utf8");
  const mod = (await import(url.href)) as { LANGUAGE_DETECT_HOLDOUT?: unknown };
  return { rows: mod.LANGUAGE_DETECT_HOLDOUT, source, fileSha256: sha256Hex(source) };
}

let fresh: Awaited<ReturnType<typeof load>>;
let consumed: Awaited<ReturnType<typeof load>>;
try {
  fresh = await load(newId);
  consumed = await load(consumedId);
} catch (e) {
  refuse(`cannot read a holdout module (${(e as Error).message.split("\n")[0]})`);
}

const result = holdoutIndependence({
  sha256: sha256Hex,
  newRows: fresh.rows,
  newSource: fresh.source,
  consumedRows: consumed.rows,
});
let commit = "unknown";
try {
  commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
} catch {
  // The commit is recorded when available; it is not part of the decision.
}

console.log(`V4 independence check: new ${newId}, consumed ${consumedId}`);
console.log(`commit: ${commit}`);
console.log(`new module sha256: ${fresh.fileSha256}`);
console.log(`consumed module sha256: ${consumed.fileSha256}`);
console.log(`text hash method: ${HOLDOUT_TEXT_HASH_METHOD}`);
const c = result.counts;
console.log(
  `rows: new=${c.newRows} consumed=${c.consumedRows} | overlap: ids=${c.idOverlap} text-hashes=${c.textHashOverlap} | repeated texts in new=${c.duplicateTextsInNew}`,
);
console.log(`result: ${result.accepted ? "ACCEPTED" : "NOT ACCEPTED"}`);
for (const r of result.reasons) console.log(`reason: ${r}`);
if (!result.accepted) process.exit(2);
