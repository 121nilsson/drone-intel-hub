/**
 * E2 step b: freeze the population and draw the stratified sample. Never runs the resolver.
 *
 *   npx tsx scripts/e2-freeze-and-draw.ts --in rows.jsonl --out <dir> --seed <seed> --n 150 --m 25 --e2-root <dir>
 *
 * Writes population.jsonl, population-manifest.json, sample.jsonl and sample-manifest.json into
 * --out. There is no default output directory, and a non-empty --out is refused, so a frozen stage
 * is never rewritten silently. Bad arguments or a refused input exit 2 with one message.
 * Optional: --cutoff <ISO instant> (default: the frame cutoff).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readFlags } from "../src/entities/normalization/semantic-eval/cli-args";
import { allocateE2 } from "../src/entities/normalization/semantic-eval/e2/allocation";
import { drawE2Sample } from "../src/entities/normalization/semantic-eval/e2/draw";
import {
  e2RowsJsonl,
  freezeE2Population,
} from "../src/entities/normalization/semantic-eval/e2/population";
import { checkE2HashChain } from "../src/entities/normalization/semantic-eval/e2/validate";
import { FRAME_CUTOFF } from "../src/entities/normalization/semantic-eval/types";
import { parseJsonl, validateFrameRow } from "../src/entities/normalization/semantic-eval/validate";
import { checkE2OutputPath } from "./lib/e2-output-guard";

function refuse(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

const flags = readFlags(process.argv.slice(2), {
  "--in": "",
  "--out": "",
  "--seed": "",
  "--n": "",
  "--m": "",
  "--cutoff": FRAME_CUTOFF,
  "--e2-root": "",
});
if (!flags.ok) refuse(flags.reason);
const v = flags.values;
for (const required of ["--in", "--out", "--seed", "--n", "--m", "--e2-root"] as const) {
  if (v[required].length === 0) refuse(`${required} is required`);
}
const n = Number(v["--n"]);
const m = Number(v["--m"]);
if (!Number.isSafeInteger(n) || n < 1) refuse("--n must be an integer >= 1");
if (!Number.isSafeInteger(m) || m < 1) refuse("--m must be an integer >= 1");

const inPath = resolve(v["--in"]);
const outDir = resolve(v["--out"]);
if (!existsSync(inPath)) refuse(`--in ${inPath} does not exist`);
const guardError = checkE2OutputPath(v["--e2-root"], outDir, "dir");
if (guardError !== undefined) refuse(guardError);
if (existsSync(outDir)) {
  if (!statSync(outDir).isDirectory()) refuse(`--out ${outDir} exists and is not a directory`);
  if (readdirSync(outDir).length > 0) {
    refuse(`--out ${outDir} is not empty: a frozen stage is never rewritten`);
  }
}

try {
  const raw = readFileSync(inPath);
  const rows = parseJsonl(raw.toString("utf8"), validateFrameRow, "frame rows");
  const population = freezeE2Population(rows, {
    cutoff: v["--cutoff"],
    rawExportSha256: createHash("sha256").update(raw).digest("hex"),
  });
  const allocation = allocateE2(population.manifest.stratumCounts, n, m);
  const sample = drawE2Sample(population, allocation, v["--seed"]);
  const chain = checkE2HashChain({ population: population.manifest, sample: sample.manifest });
  if (chain.length > 0) throw new Error(`hash chain: ${chain.join("; ")}`);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "population.jsonl"), e2RowsJsonl(population.rows));
  writeFileSync(
    join(outDir, "population-manifest.json"),
    `${JSON.stringify(population.manifest, null, 2)}\n`,
  );
  writeFileSync(join(outDir, "sample.jsonl"), e2RowsJsonl(sample.rows));
  writeFileSync(
    join(outDir, "sample-manifest.json"),
    `${JSON.stringify(sample.manifest, null, 2)}\n`,
  );
  if (allocation.n !== allocation.requestedN) {
    process.stderr.write(
      `note: n ${allocation.requestedN} is at least the population ${allocation.n}, so every row is drawn (census)\n`,
    );
  }
  process.stdout.write(
    `population ${population.manifest.populationCount}, sample ${sample.manifest.n}, ` +
      `rounds ${sample.manifest.redistributionRounds}, written to ${outDir}\n`,
  );
} catch (e) {
  refuse(`refused: ${(e as Error).message}`);
}
