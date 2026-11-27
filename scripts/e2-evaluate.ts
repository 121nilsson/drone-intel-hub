/**
 * E2 step d: run the resolver on the drawn sample after the adjudication freeze, and verify the
 * whole hash-chained record from files.
 *
 *   run    --sample-dir <dir> --adjudication-dir <dir> --out <dir>
 *   verify --sample-dir <dir> --adjudication-dir <dir> --evaluation-dir <dir>
 *
 * `run` verifies population -> sample -> adjudication first and refuses (exit 2, no resolver call)
 * when anything is missing, invalid or does not chain. It writes predictions.jsonl and
 * evaluation-manifest.json into a new or empty --out, and never writes into its inputs.
 * `verify` exits 0 when everything reproduces and 1 with every error printed otherwise. Bad
 * arguments exit 2 with one message and no stack trace. Uses the real code seed snapshot.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  CODE_SEED_SNAPSHOT,
  SEMANTIC_RESOLVER_VERSION,
} from "../src/entities/normalization/semantic-resolver";
import { readFlags } from "../src/entities/normalization/semantic-eval/cli-args";
import {
  runE2Evaluation,
  verifyE2Record,
  type E2RecordFiles,
} from "../src/entities/normalization/semantic-eval/e2/evaluation";

function refuse(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function insideOrEqual(child: string, parent: string): boolean {
  const r = relative(parent, child);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
}

function dirArg(flag: string, value: string): string {
  if (value.length === 0) refuse(`${flag} is required`);
  const dir = resolve(value);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) refuse(`${flag} ${dir} is not a directory`);
  return dir;
}

function readOptional(dir: string, name: string): string | undefined {
  const path = join(dir, name);
  return existsSync(path) && statSync(path).isFile() ? readFileSync(path, "utf8") : undefined;
}

function frozenFiles(sampleDir: string, adjudicationDir: string): E2RecordFiles {
  return {
    populationJsonl: readOptional(sampleDir, "population.jsonl"),
    populationManifestText: readOptional(sampleDir, "population-manifest.json"),
    sampleJsonl: readOptional(sampleDir, "sample.jsonl"),
    sampleManifestText: readOptional(sampleDir, "sample-manifest.json"),
    adjudicationsJsonl: readOptional(adjudicationDir, "adjudications.jsonl"),
    adjudicationManifestText: readOptional(adjudicationDir, "adjudication-manifest.json"),
  };
}

const [command, ...rest] = process.argv.slice(2);

try {
  if (command === "run") {
    const flags = readFlags(rest, { "--sample-dir": "", "--adjudication-dir": "", "--out": "" });
    if (!flags.ok) refuse(flags.reason);
    const v = flags.values;
    const sampleDir = dirArg("--sample-dir", v["--sample-dir"]);
    const adjudicationDir = dirArg("--adjudication-dir", v["--adjudication-dir"]);
    if (v["--out"].length === 0) refuse("--out is required");
    const outDir = resolve(v["--out"]);
    for (const input of [sampleDir, adjudicationDir]) {
      if (insideOrEqual(outDir, input) || insideOrEqual(input, outDir)) {
        refuse("--out must not be inside or contain an input directory");
      }
    }
    if (existsSync(outDir)) {
      if (!statSync(outDir).isDirectory()) refuse(`--out ${outDir} exists and is not a directory`);
      if (readdirSync(outDir).length > 0) {
        refuse(`--out ${outDir} is not empty: a frozen stage is never rewritten`);
      }
    }
    const run = runE2Evaluation(
      frozenFiles(sampleDir, adjudicationDir),
      CODE_SEED_SNAPSHOT,
      SEMANTIC_RESOLVER_VERSION,
    );
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "predictions.jsonl"), run.predictionsJsonl);
    writeFileSync(join(outDir, "evaluation-manifest.json"), run.manifestText);
    process.stdout.write(`${run.predictions.length} prediction(s) written to ${outDir}\n`);
  } else if (command === "verify") {
    const flags = readFlags(rest, {
      "--sample-dir": "",
      "--adjudication-dir": "",
      "--evaluation-dir": "",
    });
    if (!flags.ok) refuse(flags.reason);
    const v = flags.values;
    const sampleDir = dirArg("--sample-dir", v["--sample-dir"]);
    const adjudicationDir = dirArg("--adjudication-dir", v["--adjudication-dir"]);
    const evaluationDir = dirArg("--evaluation-dir", v["--evaluation-dir"]);
    const errors = verifyE2Record(
      {
        ...frozenFiles(sampleDir, adjudicationDir),
        predictionsJsonl: readOptional(evaluationDir, "predictions.jsonl"),
        evaluationManifestText: readOptional(evaluationDir, "evaluation-manifest.json"),
      },
      CODE_SEED_SNAPSHOT,
      SEMANTIC_RESOLVER_VERSION,
    );
    if (errors.length > 0) {
      process.stderr.write(
        `${errors.length} error(s):\n${errors.map((e) => `- ${e}`).join("\n")}\n`,
      );
      process.exit(1);
    }
    process.stdout.write("verified: population, sample, adjudication and predictions reproduce\n");
  } else {
    refuse("usage: e2-evaluate.ts run|verify [flags]; see the header of this script");
  }
} catch (e) {
  refuse(`refused: ${(e as Error).message}`);
}
