/**
 * scripts/e2-evaluate.ts as a process, with the full chain on a small synthetic population:
 * freeze-and-draw, adjudication export, a reviewer CSV written here, import, evaluate run, verify.
 * jiti, a temporary working directory, every input and output under it.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { decodeCsv, encodeCsv } from "../entities/normalization/semantic-eval/csv";
import { validateE2EvaluationManifest } from "../entities/normalization/semantic-eval/e2/validate";

const require = createRequire(import.meta.url);
const JITI_PKG = require.resolve("jiti/package.json");
const JITI_CLI = join(dirname(JITI_PKG), (require(JITI_PKG) as { bin: { jiti: string } }).bin.jiti);
const ROOT = resolve(".");
const tmp = mkdtempSync(join(tmpdir(), "e2-evaluate-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const NO_STACK = /^\s+at /m;

function runScript(script: string, args: readonly string[], cwd: string) {
  const r = spawnSync(process.execPath, [JITI_CLI, join(ROOT, "scripts", script), ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, JITI_ALIAS: JSON.stringify({ "@/": `${join(ROOT, "src")}/` }) },
    timeout: 120_000,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
const evaluate = (args: readonly string[], cwd: string) => runScript("e2-evaluate.ts", args, cwd);

const EN = "The aircraft is a long range drone that is used by the army and it has been seen";
const RU = "Беспилотник имеет максимальную скорость это километров в час при полете";
const UK = "Дрон має максимальну швидкість це кілометрів на годину і є українським";

function row(i: number, excerpt: string, extra: object = {}) {
  return {
    sourceId: `src-${i}`,
    rawKey: `speed_${i}`,
    rawValue: String(i),
    excerpt: `${excerpt} ${i}`,
    publishedAt: "2026-01-01T00:00:00Z",
    ...extra,
  };
}
const GOOD = [
  row(1, EN, { declaredLanguage: "uk" }),
  row(2, EN),
  row(3, EN),
  row(4, RU),
  row(5, RU),
  row(6, UK),
  row(7, "x"),
];

function snapshot(dir: string): Record<string, string> {
  return Object.fromEntries(readdirSync(dir).map((f) => [f, readFileSync(join(dir, f), "utf8")]));
}

/** Builds the whole upstream chain under a fresh directory; returns the directories. */
function makeChain(name: string) {
  const cwd = join(tmp, name);
  mkdirSync(cwd, { recursive: true });
  const input = join(cwd, "rows.jsonl");
  writeFileSync(input, `${GOOD.map((r) => JSON.stringify(r)).join("\n")}\n`);
  const sampleDir = join(cwd, "sample");
  const d = runScript(
    "e2-freeze-and-draw.ts",
    ["--in", input, "--out", sampleDir, "--seed", "s", "--n", "7", "--m", "1"],
    cwd,
  );
  expect(d.status, d.stderr).toBe(0);
  const blind = join(cwd, "blind.csv");
  const e = runScript(
    "e2-adjudication.ts",
    ["export", "--sample-dir", sampleDir, "--out", blind],
    cwd,
  );
  expect(e.status, e.stderr).toBe(0);
  const table = decodeCsv(readFileSync(blind, "utf8"));
  const values = ["en", "ru", "uk", "mixed", "unknown", "en", "ru"];
  const reviewer = join(cwd, "reviewer.csv");
  writeFileSync(
    reviewer,
    encodeCsv([table[0]!, ...table.slice(1).map((r, i) => [r[0]!, r[1]!, values[i]!])]),
  );
  const adjudicationDir = join(cwd, "adjudicated");
  const i = runScript(
    "e2-adjudication.ts",
    [
      "import",
      "--sample-dir",
      sampleDir,
      "--reviewer",
      reviewer,
      "--reviewer-id",
      "rev-1",
      "--out",
      adjudicationDir,
    ],
    cwd,
  );
  expect(i.status, i.stderr).toBe(0);
  return { cwd, sampleDir, adjudicationDir };
}

describe("e2-evaluate.ts as a process", () => {
  it("run then verify: exit 0, every file present, inputs untouched; tampered copies fail", () => {
    const { cwd, sampleDir, adjudicationDir } = makeChain("happy");
    const sampleBefore = snapshot(sampleDir);
    const adjBefore = snapshot(adjudicationDir);
    const out = join(cwd, "evaluation");

    const r = evaluate(
      ["run", "--sample-dir", sampleDir, "--adjudication-dir", adjudicationDir, "--out", out],
      cwd,
    );
    expect(r.status, r.stderr).toBe(0);
    expect(readdirSync(out).sort()).toEqual(["evaluation-manifest.json", "predictions.jsonl"]);
    expect(snapshot(sampleDir)).toEqual(sampleBefore);
    expect(snapshot(adjudicationDir)).toEqual(adjBefore);

    const predictions = readFileSync(join(out, "predictions.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { resolverLanguage: string });
    expect(predictions).toHaveLength(7);
    expect(
      predictions.every((p) => ["en", "ru", "uk", "unknown"].includes(p.resolverLanguage)),
    ).toBe(true);
    const manifest = validateE2EvaluationManifest(
      JSON.parse(readFileSync(join(out, "evaluation-manifest.json"), "utf8")),
    );
    expect(manifest.resolverVersion).toBe("1.2.0");

    const v = evaluate(
      [
        "verify",
        "--sample-dir",
        sampleDir,
        "--adjudication-dir",
        adjudicationDir,
        "--evaluation-dir",
        out,
      ],
      cwd,
    );
    expect(v.status, v.stderr).toBe(0);

    // Tamper with a copy of the predictions.
    const badEval = join(cwd, "evaluation-bad");
    cpSync(out, badEval, { recursive: true });
    const file = join(badEval, "predictions.jsonl");
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace('"resolverLanguage":"en"', '"resolverLanguage":"ru"'),
    );
    const bad = evaluate(
      [
        "verify",
        "--sample-dir",
        sampleDir,
        "--adjudication-dir",
        adjudicationDir,
        "--evaluation-dir",
        badEval,
      ],
      cwd,
    );
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/predictions: predictions\.jsonl SHA-256/);
    expect(bad.stderr).not.toMatch(NO_STACK);

    // Tamper with a copy of the adjudications.
    const badAdj = join(cwd, "adjudicated-bad");
    cpSync(adjudicationDir, badAdj, { recursive: true });
    const adjFile = join(badAdj, "adjudications.jsonl");
    writeFileSync(
      adjFile,
      readFileSync(adjFile, "utf8").replace(
        '"finalAdjudicatedLanguage":"mixed"',
        '"finalAdjudicatedLanguage":"ru"',
      ),
    );
    const bad2 = evaluate(
      ["verify", "--sample-dir", sampleDir, "--adjudication-dir", badAdj, "--evaluation-dir", out],
      cwd,
    );
    expect(bad2.status).toBe(1);
    expect(bad2.stderr).toMatch(/adjudication: adjudications\.jsonl SHA-256/);
    expect(snapshot(sampleDir)).toEqual(sampleBefore);
  });

  it("run refuses a tampered adjudication with exit 2 and writes nothing", () => {
    const { cwd, sampleDir, adjudicationDir } = makeChain("refuse-tampered");
    const bad = join(cwd, "adjudicated-bad");
    cpSync(adjudicationDir, bad, { recursive: true });
    const f = join(bad, "adjudications.jsonl");
    writeFileSync(
      f,
      readFileSync(f, "utf8").replace(
        '"finalAdjudicatedLanguage":"en"',
        '"finalAdjudicatedLanguage":"uk"',
      ),
    );
    const out = join(cwd, "evaluation");
    const r = evaluate(
      ["run", "--sample-dir", sampleDir, "--adjudication-dir", bad, "--out", out],
      cwd,
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/refusing to run/);
    expect(r.stderr).not.toMatch(NO_STACK);
    expect(existsSync(out)).toBe(false);
  });

  it("exits 2 on missing or non-empty --out, missing directories and bad flags", () => {
    const { cwd, sampleDir, adjudicationDir } = makeChain("args");
    const base = ["--sample-dir", sampleDir, "--adjudication-dir", adjudicationDir];

    const noOut = evaluate(["run", ...base], cwd);
    expect(noOut.status).toBe(2);
    expect(noOut.stderr).toMatch(/--out is required/);
    expect(noOut.stderr).not.toMatch(NO_STACK);

    const full = join(cwd, "full");
    mkdirSync(full);
    writeFileSync(join(full, "keep.txt"), "keep");
    const nonEmpty = evaluate(["run", ...base, "--out", full], cwd);
    expect(nonEmpty.status).toBe(2);
    expect(nonEmpty.stderr).toMatch(/not empty/);
    expect(readdirSync(full)).toEqual(["keep.txt"]);

    const insideInput = evaluate(["run", ...base, "--out", join(sampleDir, "x")], cwd);
    expect(insideInput.status).toBe(2);
    expect(existsSync(join(sampleDir, "x"))).toBe(false);

    const noDir = evaluate(
      [
        "run",
        "--sample-dir",
        join(cwd, "nope"),
        "--adjudication-dir",
        adjudicationDir,
        "--out",
        join(cwd, "o"),
      ],
      cwd,
    );
    expect(noDir.status).toBe(2);
    expect(noDir.stderr).toMatch(/is not a directory/);

    const noValue = evaluate(["run", "--sample-dir", "--out", join(cwd, "o")], cwd);
    expect(noValue.status).toBe(2);
    expect(noValue.stderr).not.toMatch(NO_STACK);

    const noCommand = evaluate([], cwd);
    expect(noCommand.status).toBe(2);
    expect(noCommand.stderr).toMatch(/usage/);

    const noEvalDir = evaluate(["verify", ...base], cwd);
    expect(noEvalDir.status).toBe(2);
    expect(noEvalDir.stderr).toMatch(/--evaluation-dir is required/);
  });
});
