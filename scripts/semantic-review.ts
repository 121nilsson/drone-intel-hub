/**
 * Phase 3.2 / S4: two-step blind/reveal review export and decision import. CSV only, no UI.
 *
 *   npx tsx scripts/semantic-review.ts export --step blind --limit 5
 *   npx tsx scripts/semantic-review.ts export --step reveal --limit 5
 *   npx tsx scripts/semantic-review.ts import --file scripts/output/semantic-review-blind.csv --reviewer "Name"
 *
 * Step 1 has NO resolver or AI columns. Step 2 reveals them with a blank final_verdict (blank =
 * keep the blind verdict). Import rejects incomplete rows, invalid ids and mixed protocol versions.
 * `export` defaults to --limit 5; anything larger is an explicit choice, and cards are never
 * auto-produced after the G3 feasibility check.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  CODE_SEED_RULES,
  CODE_SEED_SNAPSHOT,
} from "../src/entities/normalization/semantic-resolver";
import {
  buildConceptCatalog,
  type CanonicalConceptCatalog,
} from "../src/entities/normalization/semantic-eval/concepts";
import {
  encodeCsv,
  exportBlindCsv,
  exportRevealCsv,
  importCsv,
  parseCsv,
} from "../src/entities/normalization/semantic-eval/csv";
import type {
  Decision,
  Example,
  Prediction,
  Suggestion,
} from "../src/entities/normalization/semantic-eval/types";
import {
  drawnIdsFromManifest,
  parseJsonl,
  toJsonl,
  validateDecision,
  validateExample,
  validatePrediction,
  validateSuggestion,
} from "../src/entities/normalization/semantic-eval/validate";

const args = process.argv.slice(2);
const command = args[0];
const value = (flag: string, fallback: string): string => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};

const DATA_DIR = resolve("src/test/fixtures/semantic-eval");
const OUT_DIR = resolve("scripts/output");
const examplesPath = resolve(value("--examples", resolve(DATA_DIR, "examples.jsonl")));
const manifestPath = resolve(value("--manifest", resolve(dirname(examplesPath), "manifest.json")));
const predictionsPath = resolve(value("--predictions", resolve(DATA_DIR, "predictions.jsonl")));
const suggestionsPath = resolve(value("--suggestions", resolve(DATA_DIR, "suggestions.jsonl")));
const decisionsPath = resolve(value("--decisions", resolve(DATA_DIR, "decisions.jsonl")));

function readOrEmpty(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function loadDrawnIds(): Set<string> {
  if (!existsSync(manifestPath)) {
    throw new Error(`missing ${manifestPath} — run the sampler first`);
  }
  try {
    return drawnIdsFromManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
  } catch (e) {
    throw new Error(`invalid manifest ${manifestPath}: ${(e as Error).message}`);
  }
}

function loadExamples(): Example[] {
  if (!existsSync(examplesPath)) {
    throw new Error(`missing ${examplesPath} — run the sampler first`);
  }
  // examples.jsonl is the whole frozen frame. Only manifest-selected examples may be reviewed;
  // S5 rejects decisions outside that set, so exporting from all examples would be a dead end.
  const drawn = loadDrawnIds();
  return parseJsonl(readFileSync(examplesPath, "utf8"), validateExample, "examples.jsonl").filter(
    (e) => drawn.has(e.exampleId),
  );
}

function loadPredictions(): Prediction[] {
  return parseJsonl(readOrEmpty(predictionsPath), validatePrediction, "predictions.jsonl");
}

function loadSuggestions(): Suggestion[] {
  return parseJsonl(readOrEmpty(suggestionsPath), validateSuggestion, "suggestions.jsonl");
}

function loadDecisions(): Decision[] {
  return parseJsonl(readOrEmpty(decisionsPath), validateDecision, "decisions.jsonl");
}

/**
 * Canonical ids are validated against the snapshot stamped on THIS frame, never the live registry.
 * Only the code-seed snapshot is available in this isolated CLI; refuse to guess a reference for
 * any other snapshot hash instead of silently validating against the wrong concept set.
 */
function loadActiveCatalog(): CanonicalConceptCatalog {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    throw new Error(`cannot read manifest ${manifestPath}: ${(e as Error).message}`);
  }
  const hash = (manifest as { snapshotHash?: unknown })?.snapshotHash;
  if (hash !== CODE_SEED_SNAPSHOT.contentHash) {
    throw new Error(
      `frame snapshot ${String(hash)} is not the available snapshot ${CODE_SEED_SNAPSHOT.snapshotId}; ` +
        "cannot validate canonical ids against an unknown snapshot",
    );
  }
  return buildConceptCatalog(CODE_SEED_RULES, CODE_SEED_SNAPSHOT);
}

function exportQueue(): void {
  const step = value("--step", "blind");
  if (step !== "blind" && step !== "reveal") {
    process.stderr.write("--step must be blind or reveal\n");
    process.exit(2);
  }
  const limit = Number(value("--limit", "5"));
  if (!Number.isSafeInteger(limit) || limit < 1) {
    process.stderr.write("--limit must be a positive integer\n");
    process.exit(2);
  }
  const examples = loadExamples();
  const decided = new Set(loadDecisions().map((d) => d.exampleId));
  mkdirSync(OUT_DIR, { recursive: true });

  if (step === "blind") {
    const selected = examples
      .filter((e) => !decided.has(e.exampleId))
      .sort((a, b) => a.exampleId.localeCompare(b.exampleId))
      .slice(0, limit);
    const path = resolve(OUT_DIR, "semantic-review-blind.csv");
    writeFileSync(path, exportBlindCsv(selected));
    process.stdout.write(`wrote ${selected.length} blind card(s) to ${path}\n`);
    return;
  }

  // Reveal must show the SAME ids as the blind queue: read its ids rather than drawing again.
  const blindPath = resolve(OUT_DIR, "semantic-review-blind.csv");
  if (!existsSync(blindPath)) {
    throw new Error(`missing ${blindPath} — export the blind queue first`);
  }
  const table = parseCsv(readFileSync(blindPath, "utf8"));
  const header = table[0] ?? [];
  const idIdx = header.indexOf("example_id");
  const ids = table
    .slice(1)
    .map((r) => r[idIdx]!)
    .filter((id) => id.length > 0);
  const byId = new Map(examples.map((e) => [e.exampleId, e]));
  const selected = ids.flatMap((id) => {
    const e = byId.get(id);
    return e === undefined ? [] : [e];
  });
  if (selected.length !== ids.length) {
    throw new Error(
      `blind queue has ${ids.length - selected.length} id(s) outside the manifest's drawn sample; re-export the blind queue`,
    );
  }
  const path = resolve(OUT_DIR, "semantic-review-reveal.csv");
  // The filled blind CSV is the source of truth for the blind verdict at this point: it may not
  // have been imported yet. Copy its answers into the reveal sheet so import never sees blanks.
  const blindRows = new Map(table.slice(1).map((r) => [r[idIdx]!, r] as const));
  const answerColumns = ["verdict", "canonical_id", "note"];
  const revealTable = parseCsv(
    exportRevealCsv({
      examples: selected,
      predictions: loadPredictions(),
      suggestions: loadSuggestions(),
      existing: loadDecisions(),
    }),
  );
  const revealHeader = revealTable[0]!;
  for (const row of revealTable.slice(1)) {
    const blindRow = blindRows.get(row[revealHeader.indexOf("example_id")]!);
    if (!blindRow) continue;
    for (const name of answerColumns) {
      const to = revealHeader.indexOf(name);
      const from = header.indexOf(name);
      if (to >= 0 && from >= 0) row[to] = blindRow[from]!;
    }
  }
  writeFileSync(path, encodeCsv(revealTable));
  process.stdout.write(`wrote ${selected.length} reveal card(s) to ${path}\n`);
}

function importQueue(): void {
  const file = resolve(value("--file", resolve(OUT_DIR, "semantic-review-blind.csv")));
  const reviewer = value("--reviewer", "");
  const reviewedAt = value("--reviewed-at", new Date().toISOString());
  const allowMixedProtocol = args.includes("--allow-mixed-protocol");
  if (!existsSync(file)) throw new Error(`missing ${file}`);
  const catalog = loadActiveCatalog();
  const loaded = importCsv(readFileSync(file, "utf8"), {
    reviewer,
    reviewedAt,
    allowMixedProtocol,
    catalog,
  });
  const existing = loadDecisions();
  const merged = new Map(existing.map((d) => [d.exampleId, d]));
  for (const d of loaded.decisions) merged.set(d.exampleId, d);
  // 3.2 keeps one active decision per example. Re-review replaces it; no history is retained.
  const decisions = [...merged.values()]
    .map((d) => validateDecision(d, { catalog }))
    .sort((a, b) => a.exampleId.localeCompare(b.exampleId));
  mkdirSync(dirname(decisionsPath), { recursive: true });
  writeFileSync(decisionsPath, toJsonl(decisions));
  process.stdout.write(
    `imported ${loaded.decisions.length} decision(s) (${loaded.step}, protocols ${loaded.protocolVersions.join(", ")})\n`,
  );
  process.stdout.write(
    "NOTE: decisions are diagnostic data from a person. They are not committed and never become AI or resolver output.\n",
  );
}

try {
  if (command === "export") exportQueue();
  else if (command === "import") importQueue();
  else {
    process.stderr.write(
      "usage: semantic-review.ts export --step blind|reveal [--limit N] | import --file ... --reviewer ...\n",
    );
    process.exit(2);
  }
} catch (e) {
  process.stderr.write(`${(e as Error).message}\n`);
  process.exit(1);
}
