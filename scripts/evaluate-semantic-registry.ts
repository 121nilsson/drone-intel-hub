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
const value = (flag: string, fallback: string): string => {
  const i = args.indexOf(flag);
  if (i < 0) return fallback;
  const v = args[i + 1];
  // A missing value, or the next flag in its place, is an error, never a path (Q4).
  if (v === undefined || v.startsWith("--")) {
    process.stderr.write(`${flag} needs a value\n`);
    process.exit(2);
  }
  return v;
};

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

if (replayTarget.kind === "stdout") {
  process.stdout.write(`${report}\n`);
} else if (replayTarget.kind === "file") {
  const outPath = resolve(replayTarget.path);
  await writeFormatted(outPath, report);
  process.stdout.write(`wrote ${outPath}\n`);
} else {
  process.stdout.write("replay report not written (--report without --out or --stdout)\n");
}

const failed = invariants.filter((i) => !i.passed);
if (failed.length > 0) {
  process.stderr.write(`invariant failures: ${failed.map((f) => f.id).join(", ")}\n`);
  process.exit(1);
}

// ── S5: evidence-labelled metrics report (needs real human decisions) ─────
if (args.includes("--report")) {
  try {
    const dataDir = resolve(value("--data-dir", "src/test/fixtures/semantic-eval"));
    const decisionsPath = resolve(value("--decisions", resolve(dataDir, "decisions.jsonl")));
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
      for (const v of violations) process.stderr.write(`manifest check: ${v}\n`);
      process.exit(1);
    }
    const manifest = parsedManifest as SamplingManifest;
    const language = verifyLanguageProvenance(manifest, examples);
    for (const w of language.warnings) process.stderr.write(`manifest warning: ${w}\n`);
    const replayLine = describeLanguageReplay(language.replay);
    process.stdout.write(`${replayLine}\n`);
    const manifestHash = sha256Hex(canonicalJson(manifest));
    const origins = value("--origins", "historical")
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
    const reportOut = resolve(value("--report-out", "scripts/output/semantic-metrics.md"));
    const rendered = renderMetricsReport(metricsInput, computeMetrics(metricsInput));
    // A 1.0.0 report stays byte-identical; a 1.1.0 report says whether its language strata were
    // reproduced, so a report cannot pass as a reproduction it never performed.
    const report =
      language.replay.status === "not_applicable" ? rendered : `> ${replayLine}\n\n${rendered}`;
    await writeFormatted(reportOut, report);
    process.stdout.write(`wrote ${reportOut}\n`);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exit(1);
  }
}
