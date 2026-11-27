/**
 * Phase 3.2 / S0: replay the hand-written semantic fixtures through the isolated resolver and
 * check its technical invariants. No database, no network, no human input.
 *
 * A green report is NOT evidence of semantic correctness; the report says so itself.
 *
 *   npx tsx scripts/evaluate-semantic-registry.ts                 # writes scripts/output/semantic-replay.md
 *   npx tsx scripts/evaluate-semantic-registry.ts --stdout        # prints instead of writing
 *   npx tsx scripts/evaluate-semantic-registry.ts --out some.md   # custom path
 *   npx tsx scripts/evaluate-semantic-registry.ts --report        # S5: metrics from reviewed decisions
 *
 * Under --report the replay report is written only with --out or --stdout; S5 never rewrites the
 * committed scripts/output/semantic-replay.md implicitly. The invariants still run and still fail.
 *
 * Exit code 1 when a technical invariant fails. A parity difference never fails the run.
 * The committed report is formatted: run `npx prettier --write scripts/output/semantic-replay.md` after regenerating it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { format, resolveConfig } from "prettier";
import { semanticKeyFor } from "../src/entities/normalization/semantic";
import {
  CODE_SEED_RULES,
  CODE_SEED_SNAPSHOT,
  SEMANTIC_RESOLVER_VERSION,
} from "../src/entities/normalization/semantic-resolver";
import {
  renderReport,
  replayFixtures,
  replayReportTarget,
  runInvariants,
} from "../src/entities/normalization/semantic-eval/replay";
import { UNIT_NORMALIZER_VERSION } from "../src/entities/normalization/units";
import {
  computeMetrics,
  metricsContextFor,
  renderMetricsReport,
} from "../src/entities/normalization/semantic-eval/metrics";
import { readFlags } from "../src/entities/normalization/semantic-eval/cli-args";
import type { Origin, SamplingManifest } from "../src/entities/normalization/semantic-eval/types";
import {
  describeLanguageReplay,
  verifyEvaluationInputs,
  verifyLanguageProvenance,
} from "../src/entities/normalization/semantic-eval/verify";
import {
  canonicalJson,
  parseJsonl,
  validateDecision,
  validateExample,
  validatePrediction,
  validateSuggestion,
} from "../src/entities/normalization/semantic-eval/validate";
import { sha256Hex } from "../src/entities/normalization/sha256";
import { SEMANTICS } from "../src/test/fixtures/normalization-corpus";

const args = process.argv.slice(2);
const replayTarget = replayReportTarget(args);
if (replayTarget.kind === "invalid") {
  process.stderr.write(`${replayTarget.reason}\n`);
  process.exit(2);
}
// Every value flag is read here, before anything is written (T4): an invalid flag exits 2 and
// leaves no report behind. "" for --decisions means "decisions.jsonl in the data directory".
const flags = readFlags(args, {
  "--data-dir": "src/test/fixtures/semantic-eval",
  "--decisions": "",
  "--origins": "historical",
  "--report-out": "scripts/output/semantic-metrics.md",
});
if (!flags.ok) {
  process.stderr.write(`${flags.reason}\n`);
  process.exit(2);
}
const flagValues = flags.values;

const parity = replayFixtures(SEMANTICS, CODE_SEED_SNAPSHOT, semanticKeyFor);
const invariants = runInvariants({ snapshot: CODE_SEED_SNAPSHOT, rules: CODE_SEED_RULES });
const report = renderReport({
  snapshot: CODE_SEED_SNAPSHOT,
  resolverVersion: SEMANTIC_RESOLVER_VERSION,
  unitNormalizerVersion: UNIT_NORMALIZER_VERSION,
  fixtureCount: SEMANTICS.length,
  parity,
  invariants,
});

async function writeFormatted(path: string, text: string): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    await format(`${text}\n`, {
      filepath: path,
      ...((await resolveConfig(path)) ?? {}),
    }),
  );
}

async function writeReplayReport(): Promise<void> {
  if (replayTarget.kind === "stdout") {
    process.stdout.write(`${report}\n`);
  } else if (replayTarget.kind === "file") {
    const outPath = resolve(replayTarget.path);
    await writeFormatted(outPath, report);
    process.stdout.write(`wrote ${outPath}\n`);
  } else {
    process.stdout.write("replay report not written (--report without --out or --stdout)\n");
  }
}

const failed = invariants.filter((i) => !i.passed);

// ── S5: evidence-labelled metrics report (needs real human decisions) ─────
/**
 * Reads, verifies and renders the S5 report without writing anything. Any problem throws, so
 * that under --report nothing is written unless every input is valid (U3).
 */
async function buildS5Report(): Promise<{
  readonly reportOut: string;
  readonly report: string;
  readonly replayLine: string;
  readonly warnings: readonly string[];
}> {
  const dataDir = resolve(flagValues["--data-dir"]);
  const decisionsPath = resolve(flagValues["--decisions"] || resolve(dataDir, "decisions.jsonl"));
  const read = (p: string): string => {
    if (!existsSync(p)) throw new Error(`missing ${p} — run the sampler and reviewer first`);
    return readFileSync(p, "utf8");
  };
  const readOrEmpty = (p: string): string => (existsSync(p) ? readFileSync(p, "utf8") : "");
  // The manifest is mandatory. Without it there is no verified frame, snapshot or sample to
  // report on, and no acceptable fallback to the current resolver version.
  const examplesText = read(resolve(dataDir, "examples.jsonl"));
  const predictionsText = read(resolve(dataDir, "predictions.jsonl"));
  const manifestText = read(resolve(dataDir, "manifest.json"));
  const decisionsText = read(decisionsPath);
  let parsedManifest: unknown;
  try {
    parsedManifest = JSON.parse(manifestText);
  } catch (e) {
    throw new Error(`invalid manifest.json: ${(e as Error).message}`);
  }
  const examples = parseJsonl(examplesText, validateExample, "examples.jsonl");
  const predictions = parseJsonl(predictionsText, validatePrediction, "predictions.jsonl");
  const suggestions = parseJsonl(
    readOrEmpty(resolve(dataDir, "suggestions.jsonl")),
    validateSuggestion,
    "suggestions.jsonl",
  );
  const decisions = parseJsonl(decisionsText, validateDecision, "decisions.jsonl");
  const violations = verifyEvaluationInputs({
    manifest: parsedManifest,
    examples,
    predictions,
    decisions,
    examplesText,
    predictionsText,
  });
  if (violations.length > 0) {
    throw new Error(violations.map((v) => `manifest check: ${v}`).join("\n"));
  }
  const manifest = parsedManifest as SamplingManifest;
  const language = verifyLanguageProvenance(manifest, examples);
  const replayLine = describeLanguageReplay(language.replay);
  const manifestHash = sha256Hex(canonicalJson(manifest));
  const origins = flagValues["--origins"]
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0) as Origin[];
  const selectedExamples = examples.filter((e) => origins.includes(e.origin));
  if (selectedExamples.length === 0) {
    throw new Error(`no examples for origins ${origins.join(", ")}; refusing an empty report`);
  }
  const metricsInput = {
    examples,
    predictions,
    decisions,
    suggestions,
    sampledExampleIds: manifest.cells.flatMap((c) => c.sampledExampleIds),
    frameId: manifest.frameId,
    seed: manifest.seed,
    cutoff: manifest.cutoff,
    snapshotHash: manifest.snapshotHash,
    resolverVersion: manifest.resolverVersion,
    manifestHash,
    pilot: manifest.pilot,
    origins,
    allowMixedProtocol: args.includes("--allow-mixed-protocol"),
    context: metricsContextFor(manifest, selectedExamples),
  };
  const reportOut = resolve(flagValues["--report-out"]);
  const rendered = renderMetricsReport(metricsInput, computeMetrics(metricsInput));
  // A 1.0.0 report stays byte-identical; a 1.1.0 report says whether its language strata were
  // reproduced, so a report cannot pass as a reproduction it never performed.
  const report =
    language.replay.status === "not_applicable" ? rendered : `> ${replayLine}\n\n${rendered}`;
  return { reportOut, report, replayLine, warnings: language.warnings };
}

if (args.includes("--report")) {
  // S5: validate and compute everything first, and write nothing unless all of it succeeds (U3).
  // A failed run leaves neither a replay report nor a metrics report behind.
  if (failed.length > 0) {
    process.stderr.write(`invariant failures: ${failed.map((f) => f.id).join(", ")}\n`);
    process.exit(1);
  }
  let s5: Awaited<ReturnType<typeof buildS5Report>>;
  try {
    s5 = await buildS5Report();
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exit(1);
  }
  await writeReplayReport();
  for (const w of s5.warnings) process.stderr.write(`manifest warning: ${w}\n`);
  process.stdout.write(`${s5.replayLine}\n`);
  await writeFormatted(s5.reportOut, s5.report);
  process.stdout.write(`wrote ${s5.reportOut}\n`);
} else {
  // Replay mode: the replay report documents the invariants, failed ones included.
  await writeReplayReport();
  if (failed.length > 0) {
    process.stderr.write(`invariant failures: ${failed.map((f) => f.id).join(", ")}\n`);
    process.exit(1);
  }
}
