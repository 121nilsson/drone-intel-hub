/**
 * Phase 3.2 / S3: prepare AI suggestions for the sampled examples. A suggestion is never a label.
 *
 *   npx tsx --env-file=.env.local scripts/prepare-semantic-suggestions.ts                 # dry run
 *   npx tsx --env-file=.env.local scripts/prepare-semantic-suggestions.ts --ai --apply --model <id>
 *   npx tsx scripts/prepare-semantic-suggestions.ts --offline --apply                     # placeholders
 *
 * The prompt shows only the evidence and the canonical manifest — no resolver output, no AI
 * suggestion from another run, and no prior analyst verdict. The output file's schema forbids
 * `human_reviewed`; only semantic-review.ts import can create a Decision.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CANONICAL_CONCEPTS } from "../src/entities/normalization/canonical-manifest";
import type { Suggestion } from "../src/entities/normalization/semantic-eval/types";
import { VERDICTS } from "../src/entities/normalization/semantic-eval/types";
import {
  drawnIdsFromManifest,
  parseJsonl,
  toJsonl,
  validateExample,
  validateSuggestion,
} from "../src/entities/normalization/semantic-eval/validate";
import { sha256Hex } from "../src/entities/normalization/sha256";

const args = process.argv.slice(2);
const value = (flag: string, fallback: string): string => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const apply = args.includes("--apply");
const useAi = args.includes("--ai");
const offline = args.includes("--offline");

const examplesPath = resolve(value("--examples", "src/test/fixtures/semantic-eval/examples.jsonl"));
const manifestPath = resolve(value("--manifest", resolve(dirname(examplesPath), "manifest.json")));
const outPath = resolve(value("--out", "src/test/fixtures/semantic-eval/suggestions.jsonl"));
const limit = Number(value("--limit", "72"));
const model = value("--model", process.env.TIER2_MODEL ?? "tier2");

if (!Number.isSafeInteger(limit) || limit < 1) {
  process.stderr.write("--limit must be a positive integer\n");
  process.exit(2);
}
if (useAi && offline) {
  process.stderr.write("choose --ai or --offline, not both\n");
  process.exit(2);
}

if (!existsSync(examplesPath)) {
  process.stderr.write(`missing ${examplesPath} — run the sampler first\n`);
  process.exit(2);
}
let drawnIds: Set<string>;
try {
  if (!existsSync(manifestPath)) throw new Error(`missing ${manifestPath} — run the sampler first`);
  drawnIds = drawnIdsFromManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
} catch (e) {
  process.stderr.write(`${(e as Error).message}\n`);
  process.exit(2);
}

// examples.jsonl is the whole frozen frame. Only manifest-selected examples may be reviewed.
const examples = parseJsonl(readFileSync(examplesPath, "utf8"), validateExample, "examples.jsonl")
  .filter((e) => drawnIds.has(e.exampleId))
  .slice()
  .sort((a, b) => a.exampleId.localeCompare(b.exampleId))
  .slice(0, limit);
if (examples.length === 0) {
  process.stderr.write(
    `no drawn examples in ${examplesPath} — check the manifest and sampler output\n`,
  );
  process.exit(2);
}

const SYSTEM =
  "You assist a defence analyst who is labelling extracted drone-technology attributes. " +
  "Return ONLY one JSON object with keys: verdict, canonical_id, candidates, rationale, missing_info. " +
  `verdict must be one of ${VERDICTS.join(", ")}. ` +
  "Use resolve and a canonical_id only when the evidence supports exactly one listed concept. " +
  "Use withhold_context when a guard is not satisfied, withhold_ambiguous with candidates for a " +
  "known polysemous term, unknown_term when it is not a recognised concept, and " +
  "insufficient_evidence when the excerpt cannot support any call. " +
  "Never assume a value you were not given. Be terse and explain what is missing.";

const CANONICAL_LIST = CANONICAL_CONCEPTS.map((c) => `${c.id} — ${c.label}`).join("\n");

function promptFor(example: (typeof examples)[number]): string {
  return [
    "Canonical concepts (closed set):",
    CANONICAL_LIST,
    "",
    "Evidence (no resolver result is shown):",
    JSON.stringify({
      excerpt: example.excerpt,
      rawKey: example.rawKey,
      ...(example.rawLabel !== undefined ? { rawLabel: example.rawLabel } : {}),
      ...(example.rawValue !== undefined ? { rawValue: example.rawValue } : {}),
      ...(example.rawUnit !== undefined ? { rawUnit: example.rawUnit } : {}),
      language: example.language,
      context: example.context,
    }),
  ].join("\n");
}

function promptHash(example: (typeof examples)[number]): string {
  return sha256Hex(`${SYSTEM}\n${CANONICAL_LIST}\n${promptFor(example)}`);
}

function parseProposal(raw: string, exampleId: string, usedModel: string): Suggestion {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`model returned non-JSON for ${exampleId}: ${(e as Error).message}`);
  }
  const o = parsed as Record<string, unknown>;
  const candidates = Array.isArray(o.candidates)
    ? (o.candidates as unknown[]).filter((c): c is string => typeof c === "string")
    : undefined;
  return validateSuggestion({
    exampleId,
    model: usedModel,
    promptHash: promptHash(examples.find((e) => e.exampleId === exampleId)!),
    proposed: {
      verdict: o.verdict,
      ...(typeof o.canonical_id === "string" && o.canonical_id.length > 0
        ? { canonicalId: o.canonical_id }
        : {}),
      ...(candidates !== undefined && candidates.length > 0 ? { candidates } : {}),
    },
    rationale: typeof o.rationale === "string" ? o.rationale : "",
    missingInfo: Array.isArray(o.missing_info)
      ? (o.missing_info as unknown[]).filter((x): x is string => typeof x === "string")
      : [],
    status: "suggested",
  });
}

async function main(): Promise<void> {
  if (!apply) {
    process.stdout.write(
      `dry run: ${examples.length} example(s) would get a suggestion. Prompt preview:\n\n${promptFor(examples[0]!)}\n`,
    );
    return;
  }
  const suggestions: Suggestion[] = [];

  if (offline) {
    for (const e of examples) {
      suggestions.push(
        validateSuggestion({
          exampleId: e.exampleId,
          model: "offline-placeholder",
          promptHash: promptHash(e),
          proposed: { verdict: "insufficient_evidence" },
          rationale: "OFFLINE PLACEHOLDER — no AI call was made. Replace before review.",
          missingInfo: ["human review required"],
          status: "suggested",
        }),
      );
    }
  } else if (useAi) {
    const { chatCompletionOnce } = await import("../src/shared/infra/ai-proxy.server");
    for (const e of examples) {
      const result = await chatCompletionOnce({
        model,
        system: SYSTEM,
        prompt: promptFor(e),
        json: true,
      });
      if (!result.ok) throw new Error(`AI call failed for ${e.exampleId}: ${result.error}`);
      suggestions.push(parseProposal(result.content, e.exampleId, model));
    }
  } else {
    process.stderr.write(
      "pass --ai (real call) or --offline (placeholders) together with --apply\n",
    );
    process.exit(2);
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, toJsonl(suggestions));
  process.stdout.write(`wrote ${suggestions.length} suggestions to ${outPath}\n`);
}

await main();
