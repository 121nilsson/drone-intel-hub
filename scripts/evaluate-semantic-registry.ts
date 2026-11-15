/**
 * Phase 3.2 / S0: replay the hand-written semantic fixtures through the isolated resolver and
 * check its technical invariants. No database, no network, no human input.
 *
 * A green report is NOT evidence of semantic correctness; the report says so itself.
 *
 *   npx tsx scripts/evaluate-semantic-registry.ts                 # writes scripts/output/semantic-replay.md
 *   npx tsx scripts/evaluate-semantic-registry.ts --stdout        # prints instead of writing
 *   npx tsx scripts/evaluate-semantic-registry.ts --out some.md   # custom path
 *
 * Exit code 1 when a technical invariant fails. A parity difference never fails the run.
 * The committed report is formatted: run `npx prettier --write scripts/output/semantic-replay.md` after regenerating it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
import { SEMANTICS } from "../src/test/fixtures/normalization-corpus";

const args = process.argv.slice(2);
const toStdout = args.includes("--stdout");
const outIdx = args.indexOf("--out");
const outPath = resolve(
  outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1]! : "scripts/output/semantic-replay.md",
);

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

if (toStdout) {
  process.stdout.write(`${report}\n`);
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${report}\n`);
  process.stdout.write(`wrote ${outPath}\n`);
}

const failed = invariants.filter((i) => !i.passed);
if (failed.length > 0) {
  process.stderr.write(`invariant failures: ${failed.map((f) => f.id).join(", ")}\n`);
  process.exit(1);
}
