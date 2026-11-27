/**
 * E2 step c: blind human language adjudication of the drawn sample. Never runs the resolver.
 *
 *   export  --sample-dir <dir> --out <file.csv>
 *   import  --sample-dir <dir> --reviewer <csv> --reviewer-id <id> --out <dir>
 *           [--second-reviewer <csv> --second-reviewer-id <id>] [--resolutions <csv|jsonl>]
 *
 * `export` writes the blind CSV (example_id, excerpt, language) and refuses an existing file.
 * `import` checks completeness and integrity, then writes adjudications.jsonl and
 * adjudication-manifest.json into a new or empty --out. The sample directory is only read, and
 * nothing is ever written into it. Any error exits 2 with one message and no stack trace.
 * Protocol: docs/semantic-resolver-v1.3.0-e2-adjudication-protocol.md
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { readFlags } from "../src/entities/normalization/semantic-eval/cli-args";
import {
  buildE2AdjudicationExport,
  e2AdjudicationManifestText,
  freezeE2Adjudications,
  parseResolutions,
  parseReviewerCsv,
} from "../src/entities/normalization/semantic-eval/e2/adjudication";
import {
  validateE2Example,
  validateE2PopulationManifest,
  validateE2SampleManifest,
} from "../src/entities/normalization/semantic-eval/e2/validate";

function refuse(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

const [command, ...rest] = process.argv.slice(2);

function insideOrEqual(child: string, parent: string): boolean {
  const r = relative(parent, child);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
}

function readText(path: string, label: string): string {
  if (!existsSync(path) || !statSync(path).isFile()) refuse(`${label} ${path} does not exist`);
  return readFileSync(path, "utf8");
}

function loadSampleDir(dir: string) {
  if (!existsSync(dir) || !statSync(dir).isDirectory())
    refuse(`--sample-dir ${dir} is not a directory`);
  const rowsText = readText(join(dir, "sample.jsonl"), "sample file");
  const rows = rowsText
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => validateE2Example(JSON.parse(l)));
  const sampleManifest = validateE2SampleManifest(
    JSON.parse(readText(join(dir, "sample-manifest.json"), "sample manifest")),
  );
  return { rows, sampleManifest, dir };
}

function requireValues<K extends string>(
  v: Readonly<Record<K, string>>,
  names: readonly K[],
): void {
  for (const name of names) if (v[name].length === 0) refuse(`${name} is required`);
}

try {
  if (command === "export") {
    const flags = readFlags(rest, { "--sample-dir": "", "--out": "" });
    if (!flags.ok) refuse(flags.reason);
    const v = flags.values;
    requireValues(v, ["--sample-dir", "--out"]);
    const sampleDir = resolve(v["--sample-dir"]);
    const out = resolve(v["--out"]);
    if (existsSync(out)) refuse(`--out ${out} already exists: an export is never overwritten`);
    if (insideOrEqual(out, sampleDir)) refuse("--out must not be inside the sample directory");
    const { rows } = loadSampleDir(sampleDir);
    const csv = buildE2AdjudicationExport(rows);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, csv);
    process.stdout.write(`blind export of ${rows.length} excerpt(s) written to ${out}\n`);
  } else if (command === "import") {
    const flags = readFlags(rest, {
      "--sample-dir": "",
      "--reviewer": "",
      "--reviewer-id": "",
      "--second-reviewer": "",
      "--second-reviewer-id": "",
      "--resolutions": "",
      "--out": "",
    });
    if (!flags.ok) refuse(flags.reason);
    const v = flags.values;
    requireValues(v, ["--sample-dir", "--reviewer", "--reviewer-id", "--out"]);
    if ((v["--second-reviewer"] === "") !== (v["--second-reviewer-id"] === "")) {
      refuse("--second-reviewer and --second-reviewer-id must be given together");
    }
    const sampleDir = resolve(v["--sample-dir"]);
    const outDir = resolve(v["--out"]);
    if (insideOrEqual(outDir, sampleDir)) refuse("--out must not be inside the sample directory");
    if (existsSync(outDir)) {
      if (!statSync(outDir).isDirectory()) refuse(`--out ${outDir} exists and is not a directory`);
      if (readdirSync(outDir).length > 0) {
        refuse(`--out ${outDir} is not empty: a frozen stage is never rewritten`);
      }
    }
    const { rows, sampleManifest } = loadSampleDir(sampleDir);
    const populationManifest = validateE2PopulationManifest(
      JSON.parse(readText(join(sampleDir, "population-manifest.json"), "population manifest")),
    );
    const first = {
      reviewerId: v["--reviewer-id"],
      entries: parseReviewerCsv(readText(resolve(v["--reviewer"]), "--reviewer"), "reviewer file"),
    };
    const second =
      v["--second-reviewer"] === ""
        ? undefined
        : {
            reviewerId: v["--second-reviewer-id"],
            entries: parseReviewerCsv(
              readText(resolve(v["--second-reviewer"]), "--second-reviewer"),
              "second reviewer file",
            ),
          };
    const resPath = v["--resolutions"];
    const resolutions =
      resPath === ""
        ? undefined
        : parseResolutions(
            readText(resolve(resPath), "--resolutions"),
            resPath.toLowerCase().endsWith(".jsonl") ? "jsonl" : "csv",
          );
    const frozen = freezeE2Adjudications({
      sampleRows: rows,
      sampleManifest,
      populationManifest,
      first,
      second,
      resolutions,
    });
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "adjudications.jsonl"), frozen.jsonl);
    writeFileSync(
      join(outDir, "adjudication-manifest.json"),
      e2AdjudicationManifestText(frozen.manifest),
    );
    process.stdout.write(
      `adjudicated ${frozen.rows.length}, disagreements ${frozen.manifest.disagreementCount}, written to ${outDir}\n`,
    );
  } else {
    refuse("usage: e2-adjudication.ts export|import [flags]; see the header of this script");
  }
} catch (e) {
  refuse(`refused: ${(e as Error).message}`);
}
