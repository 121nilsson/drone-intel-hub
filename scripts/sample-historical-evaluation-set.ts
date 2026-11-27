/**
 * Phase 3.2 / S2: freeze a historical frame, replay the resolver over ALL of it, and draw a seeded
 * stratified pilot sample. Dry-run by default (report to stdout); `--apply` writes the data files.
 *
 *   npx tsx --env-file=.env.local scripts/sample-historical-evaluation-set.ts
 *   npx tsx --env-file=.env.local scripts/sample-historical-evaluation-set.ts --apply
 *   npx tsx scripts/sample-historical-evaluation-set.ts --in my-frame.jsonl --seed my-seed --apply
 *
 *   npx tsx scripts/sample-historical-evaluation-set.ts --schema-version 1.1.0 --in rows.jsonl --out dir
 *
 * Schema 1.1.0 (language provenance) refuses rows that set the legacy `language` field: put a real
 * declaration in `declaredLanguage` or leave it empty. The committed pilot rows set `language` on
 * every row, so they freeze only under the default 1.0.0. A refused input exits 2.
 *
 * The input is a JSONL export of eligible spec attributes (FrameRow records). D1: this script never
 * reads verification_audit. It only uses the deterministic code-seed snapshot; no DB, no network.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { format, resolveConfig } from "prettier";
import { LANGUAGE_DETECTOR_VERSION } from "../src/entities/normalization/language";
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
  LANGUAGE_STRATUM_RULE,
  SEMANTIC_EVAL_SCHEMA_VERSION,
  SEMANTIC_EVAL_SCHEMA_VERSION_1_1,
} from "../src/entities/normalization/semantic-eval/types";
import {
  canonicalJson,
  parseJsonl,
  toJsonl,
  validateFrameRow,
} from "../src/entities/normalization/semantic-eval/validate";
import { sha256Hex } from "../src/entities/normalization/sha256";
import { readFlags } from "../src/entities/normalization/semantic-eval/cli-args";

const args = process.argv.slice(2);
// Every value flag is read once, here, with the shared rule (T3): a missing value or the next flag
// in its place exits 2 before anything is read or written.
const flags = readFlags(args, {
  // 1.0.0 stays the default; 1.1.0 (language provenance) is opt-in for new directories only.
  "--schema-version": SEMANTIC_EVAL_SCHEMA_VERSION,
  "--in": "src/test/fixtures/semantic-eval/frame-rows.jsonl",
  "--out": "src/test/fixtures/semantic-eval",
  "--report": "scripts/output/semantic-sampling.md",
  "--ceiling": String(PILOT_CEILING),
  "--seed": SAMPLING_SEED,
  "--cutoff": FRAME_CUTOFF,
});
if (!flags.ok) {
  process.stderr.write(`${flags.reason}\n`);
  process.exit(2);
}
const value = (flag: keyof typeof flags.values): string => flags.values[flag];
const apply = args.includes("--apply");
const schemaFlag = value("--schema-version");
if (
  schemaFlag !== SEMANTIC_EVAL_SCHEMA_VERSION &&
  schemaFlag !== SEMANTIC_EVAL_SCHEMA_VERSION_1_1
) {
  process.stderr.write("--schema-version must be 1.0.0 or 1.1.0\n");
  process.exit(2);
}

const inPath = resolve(value("--in"));
const outDir = resolve(value("--out"));
const reportPath = resolve(value("--report"));
const ceiling = Number(value("--ceiling"));
const seed = value("--seed");
const cutoff = value("--cutoff");
// Pilot status follows the configuration, so the report never has to guess from the ceiling.
const pilot = ceiling <= PILOT_CEILING;

if (!Number.isSafeInteger(ceiling) || ceiling < 0) {
  process.stderr.write("--ceiling must be a non-negative integer\n");
  process.exit(2);
}
if (ceiling > PILOT_CEILING) {
  if (!args.includes("--allow-ceiling-override")) {
    process.stderr.write(
      `--ceiling ${ceiling} exceeds the Phase 3.2 pilot ceiling of ${PILOT_CEILING}. Expansion is a decision after G3; pass --allow-ceiling-override only if you are leaving pilot mode.\n`,
    );
    process.exit(2);
  }
  process.stderr.write(
    `WARNING: ceiling ${ceiling} exceeds the pilot ceiling; leaving pilot mode.\n`,
  );
}

const rows: FrameRow[] = parseJsonl(
  readFileSync(inPath, "utf8"),
  validateFrameRow,
  "frame-rows.jsonl",
);
let built: ReturnType<typeof buildFrame>;
try {
  built = buildFrame(rows, {
    frameId: "", // replaced below once ids are known; frameIdFor hashes the frozen example ids
    snapshot: CODE_SEED_SNAPSHOT,
    resolverVersion: SEMANTIC_RESOLVER_VERSION,
    cutoff,
    isPilot: pilot,
    defaultOrigin: "historical",
    schemaVersion: schemaFlag,
  });
} catch (e) {
  // An input the freeze refuses (for example the legacy `language` field under 1.1.0) is a
  // controlled refusal with the reason, not a stack trace (Q3).
  process.stderr.write(`refused: ${(e as Error).message}\n`);
  process.exit(2);
}
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
  pilot,
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
  ...(schemaFlag === SEMANTIC_EVAL_SCHEMA_VERSION_1_1
    ? {
        languageRule: LANGUAGE_STRATUM_RULE,
        languageDetectorVersion: LANGUAGE_DETECTOR_VERSION,
      }
    : {}),
};
const manifestHash = sha256Hex(canonicalJson(manifest));
const report = renderSamplingReport({
  frameId,
  seed,
  cutoff,
  ceiling,
  pilot,
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
