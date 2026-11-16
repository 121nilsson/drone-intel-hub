/**
 * Phase 3.2 / S2: freeze a historical frame, replay the resolver over ALL of it, and draw a seeded
 * stratified pilot sample. Dry-run by default (report to stdout); `--apply` writes the data files.
 *
 *   npx tsx --env-file=.env.local scripts/sample-historical-evaluation-set.ts
 *   npx tsx --env-file=.env.local scripts/sample-historical-evaluation-set.ts --apply
 *   npx tsx scripts/sample-historical-evaluation-set.ts --in my-frame.jsonl --seed my-seed --apply
 *
 * The input is a JSONL export of eligible spec attributes (FrameRow records). D1: this script never
 * reads verification_audit. It only uses the deterministic code-seed snapshot; no DB, no network.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { format, resolveConfig } from "prettier";
import {
  CODE_SEED_SNAPSHOT,
  SEMANTIC_RESOLVER_VERSION,
} from "../src/entities/normalization/semantic-resolver";
import {
  buildFrame,
  drawSample,
  frameIdFor,
  renderSamplingReport,
  sourceConcentration,
} from "../src/entities/normalization/semantic-eval/sampling";
import {
  FRAME_CUTOFF,
  FAMILY_COUNT,
  LANGUAGE_COUNT,
  PILOT_CEILING,
  RESOLVER_STATUS_COUNT,
  SAMPLING_SEED,
  type FrameRow,
  type SamplingManifest,
} from "../src/entities/normalization/semantic-eval/types";
import {
  canonicalJson,
  parseJsonl,
  toJsonl,
  validateFrameRow,
} from "../src/entities/normalization/semantic-eval/validate";
import { sha256Hex } from "../src/entities/normalization/sha256";

const args = process.argv.slice(2);
const value = (flag: string, fallback: string): string => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const apply = args.includes("--apply");

const inPath = resolve(value("--in", "src/test/fixtures/semantic-eval/frame-rows.jsonl"));
const outDir = resolve(value("--out", "src/test/fixtures/semantic-eval"));
const reportPath = resolve(value("--report", "scripts/output/semantic-sampling.md"));
const ceiling = Number(value("--ceiling", String(PILOT_CEILING)));
const seed = value("--seed", SAMPLING_SEED);
const cutoff = value("--cutoff", FRAME_CUTOFF);

if (!Number.isSafeInteger(ceiling) || ceiling < 0) {
  process.stderr.write("--ceiling must be a non-negative integer\n");
  process.exit(2);
}

const rows: FrameRow[] = parseJsonl(
  readFileSync(inPath, "utf8"),
  validateFrameRow,
  "frame-rows.jsonl",
);
const built = buildFrame(rows, {
  frameId: "", // replaced below once ids are known; frameIdFor hashes the frozen example ids
  snapshot: CODE_SEED_SNAPSHOT,
  resolverVersion: SEMANTIC_RESOLVER_VERSION,
  cutoff,
  isPilot: true,
  defaultOrigin: "historical",
});
const frameId = frameIdFor(built.examples);
const examples = built.examples.map((e) => ({ ...e, frameId }));
const sample = drawSample(examples, { seed, ceiling });
const concentration = sourceConcentration(examples);

const examplesJsonl = toJsonl(examples);
const predictionsJsonl = toJsonl(built.predictions);
const manifest: SamplingManifest = {
  manifestVersion: "1.0.0",
  frameId,
  seed,
  cutoff,
  ceiling,
  familyCount: FAMILY_COUNT,
  languageCount: LANGUAGE_COUNT,
  resolverStatusCount: RESOLVER_STATUS_COUNT,
  resolverVersion: SEMANTIC_RESOLVER_VERSION,
  snapshotHash: CODE_SEED_SNAPSHOT.contentHash,
  populationCount: sample.populationCount,
  drawnCount: sample.drawnCount,
  cells: sample.cells,
  emptyCells: sample.emptyCells,
  unsampledCells: sample.unsampledCells,
  coveredFraction: sample.coveredFraction,
  concentration: concentration.rows,
  topShare: concentration.topShare,
  exclusions: built.exclusions,
  examplesSha256: sha256Hex(examplesJsonl),
  predictionsSha256: sha256Hex(predictionsJsonl),
};
const manifestHash = sha256Hex(canonicalJson(manifest));
const report = renderSamplingReport({
  frameId,
  seed,
  cutoff,
  ceiling,
  snapshotHash: CODE_SEED_SNAPSHOT.contentHash,
  resolverVersion: SEMANTIC_RESOLVER_VERSION,
  sample,
  exclusions: built.exclusions,
  truncated: built.truncated,
  concentration,
  manifestHash,
});

if (apply) {
  mkdirSync(outDir, { recursive: true });
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(resolve(outDir, "examples.jsonl"), examplesJsonl);
  writeFileSync(resolve(outDir, "predictions.jsonl"), predictionsJsonl);
  const manifestPath = resolve(outDir, "manifest.json");
  writeFileSync(
    manifestPath,
    await format(`${JSON.stringify(manifest, null, 2)}\n`, {
      filepath: manifestPath,
      ...((await resolveConfig(manifestPath)) ?? {}),
    }),
  );
  writeFileSync(
    reportPath,
    await format(`${report}\n`, {
      filepath: reportPath,
      ...((await resolveConfig(reportPath)) ?? {}),
    }),
  );
  process.stdout.write(
    `wrote ${examples.length} examples, ${built.predictions.length} predictions, ${sample.drawnCount} drawn\n`,
  );
  process.stdout.write(`wrote ${reportPath}\n`);
} else {
  process.stdout.write(`${report}\n`);
  process.stdout.write(
    `dry run: pass --apply to write examples.jsonl, predictions.jsonl and manifest.json\n`,
  );
}
