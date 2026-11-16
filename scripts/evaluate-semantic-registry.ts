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
  runInvariants,
} from "../src/entities/normalization/semantic-eval/replay";
import { UNIT_NORMALIZER_VERSION } from "../src/entities/normalization/units";
import {
  computeMetrics,
  renderMetricsReport,
} from "../src/entities/normalization/semantic-eval/metrics";
import type { MetricsContext } from "../src/entities/normalization/semantic-eval/metrics";
import type { SamplingManifest } from "../src/entities/normalization/semantic-eval/types";
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
const toStdout = args.includes("--stdout");
const outIdx = args.indexOf("--out");
const outPath = resolve(
  outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1]! : "scripts/output/semantic-replay.md",
);
const value = (flag: string, fallback: string): string => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
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

if (toStdout) {
  process.stdout.write(`${report}\n`);
} else {
  await writeFormatted(outPath, report);
  process.stdout.write(`wrote ${outPath}\n`);
}

const failed = invariants.filter((i) => !i.passed);
if (failed.length > 0) {
  process.stderr.write(`invariant failures: ${failed.map((f) => f.id).join(", ")}\n`);
  process.exit(1);
}

// ── S5: evidence-labelled metrics report (needs real human decisions) ─────
if (args.includes("--report")) {
  const dataDir = resolve(value("--data-dir", "src/test/fixtures/semantic-eval"));
  const decisionsPath = resolve(value("--decisions", resolve(dataDir, "decisions.jsonl")));
  if (!existsSync(decisionsPath)) {
    process.stderr.write(
      `no decisions at ${decisionsPath}. No human labels are fabricated: review the CSV queue with semantic-review.ts first.\n`,
    );
    process.exit(2);
  }
  const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
  const examples = parseJsonl(
    read(resolve(dataDir, "examples.jsonl")),
    validateExample,
    "examples.jsonl",
  );
  const predictions = parseJsonl(
    read(resolve(dataDir, "predictions.jsonl")),
    validatePrediction,
    "predictions.jsonl",
  );
  const suggestions = parseJsonl(
    read(resolve(dataDir, "suggestions.jsonl")),
    validateSuggestion,
    "suggestions.jsonl",
  );
  const decisions = parseJsonl(read(decisionsPath), validateDecision, "decisions.jsonl");
  const manifest: SamplingManifest | undefined = existsSync(resolve(dataDir, "manifest.json"))
    ? (JSON.parse(read(resolve(dataDir, "manifest.json"))) as SamplingManifest)
    : undefined;
  const manifestHash = manifest === undefined ? "" : sha256Hex(canonicalJson(manifest));
  const context: MetricsContext | undefined = manifest
    ? {
        cells: manifest.cells,
        emptyCells: manifest.emptyCells,
        unsampledCells: manifest.unsampledCells,
        coveredFraction: manifest.coveredFraction,
        exclusions: manifest.exclusions,
        concentration: manifest.concentration,
        topShare: manifest.topShare,
      }
    : undefined;
  const metricsInput = {
    examples,
    predictions,
    decisions,
    suggestions,
    sampledExampleIds: manifest?.cells.flatMap((c) => c.sampledExampleIds),
    frameId: manifest?.frameId ?? "",
    seed: manifest?.seed ?? "",
    cutoff: manifest?.cutoff ?? "",
    snapshotHash: manifest?.snapshotHash ?? CODE_SEED_SNAPSHOT.contentHash,
    resolverVersion: manifest?.resolverVersion ?? SEMANTIC_RESOLVER_VERSION,
    manifestHash,
    pilot: true,
    allowMixedProtocol: args.includes("--allow-mixed-protocol"),
    context,
  };
  const reportOut = resolve(value("--report-out", "scripts/output/semantic-metrics.md"));
  try {
    const report = renderMetricsReport(metricsInput, computeMetrics(metricsInput));
    await writeFormatted(reportOut, report);
    process.stdout.write(`wrote ${reportOut}\n`);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exit(1);
  }
}
