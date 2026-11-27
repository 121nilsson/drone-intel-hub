/**
 * scripts/e2-adjudication.ts as a process, in the style of semantic-eval-e2-script-process.test.ts:
 * jiti, a temporary working directory, every input and output under it. Nothing is written into
 * the repository. The sample is made with the step b CLI.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { decodeCsv, encodeCsv } from "../entities/normalization/semantic-eval/csv";
import {
  checkE2HashChain,
  validateE2Adjudication,
  validateE2AdjudicationManifest,
  validateE2PopulationManifest,
  validateE2SampleManifest,
} from "../entities/normalization/semantic-eval/e2/validate";

const require = createRequire(import.meta.url);
const JITI_PKG = require.resolve("jiti/package.json");
const JITI_CLI = join(dirname(JITI_PKG), (require(JITI_PKG) as { bin: { jiti: string } }).bin.jiti);
const ROOT = resolve(".");
const tmp = mkdtempSync(join(tmpdir(), "e2-adjudication-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const NO_STACK = /^\s+at /m;

function freshDir(name: string): string {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function runScript(script: string, args: readonly string[], cwd: string) {
  const r = spawnSync(
    process.execPath,
    [JITI_CLI, join(ROOT, "scripts", script), ...args, "--e2-root", cwd],
    {
      cwd,
      encoding: "utf8",
      env: { ...process.env, JITI_ALIAS: JSON.stringify({ "@/": `${join(ROOT, "src")}/` }) },
      timeout: 60_000,
    },
  );
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
const adj = (args: readonly string[], cwd: string) => runScript("e2-adjudication.ts", args, cwd);

const EN = "The aircraft is a long range drone that is used by the army and it has been seen";
const RU = "Беспилотник имеет максимальную скорость сто километров в час при полете";
const UK = "Дрон має максимальну швидкість сто кілометрів на годину і є українським";

function row(i: number, excerpt: string) {
  return {
    sourceId: `src-${i}`,
    rawKey: `speed_${i}`,
    rawValue: String(i),
    excerpt: `${excerpt} ${i}`,
    publishedAt: "2026-01-01T00:00:00Z",
  };
}
const GOOD = [row(1, EN), row(2, EN), row(3, EN), row(4, RU), row(5, RU), row(6, UK), row(7, "x")];

/** Freezes and draws the synthetic population (census, n = 7) into <cwd>/sample. */
function makeSample(name: string) {
  const cwd = freshDir(name);
  const input = join(cwd, "rows.jsonl");
  writeFileSync(input, `${GOOD.map((r) => JSON.stringify(r)).join("\n")}\n`);
  const sampleDir = join(cwd, "sample");
  const r = runScript(
    "e2-freeze-and-draw.ts",
    ["--in", input, "--out", sampleDir, "--seed", "s", "--n", "7", "--m", "1"],
    cwd,
  );
  expect(r.status, r.stderr).toBe(0);
  return { cwd, sampleDir };
}

function snapshot(dir: string): Record<string, string> {
  return Object.fromEntries(readdirSync(dir).map((f) => [f, readFileSync(join(dir, f), "utf8")]));
}

/** Writes a reviewer CSV from an export, filling the language column in row order. */
function fillCsv(exportPath: string, outPath: string, values: readonly string[]): string[] {
  const table = decodeCsv(readFileSync(exportPath, "utf8"));
  const ids = table.slice(1).map((r) => r[0]!);
  const filled = [table[0]!, ...table.slice(1).map((r, i) => [r[0]!, r[1]!, values[i]!])];
  writeFileSync(outPath, encodeCsv(filled));
  return ids;
}

describe("e2-adjudication.ts as a process", () => {
  it("happy path: export, two reviewers, a resolution, import; files validate and chain", () => {
    const { cwd, sampleDir } = makeSample("happy");
    const before = snapshot(sampleDir);
    const exportPath = join(cwd, "blind.csv");
    const e = adj(["export", "--sample-dir", sampleDir, "--out", exportPath], cwd);
    expect(e.status, e.stderr).toBe(0);
    const csvText = readFileSync(exportPath, "utf8");
    expect(csvText.split("\n")[0]).toBe("example_id,excerpt,language");

    const r1 = join(cwd, "r1.csv");
    const r2 = join(cwd, "r2.csv");
    const ids = fillCsv(exportPath, r1, ["en", "ru", "uk", "mixed", "unknown", "en", "ru"]);
    fillCsv(exportPath, r2, ["ru", "ru", "uk", "mixed", "unknown", "en", "ru"]);
    const resolutions = join(cwd, "res.csv");
    writeFileSync(
      resolutions,
      `example_id,final_language,resolved_by,note\n${ids[0]},mixed,rev-3,both languages\n`,
    );
    const out = join(cwd, "adjudicated");
    const r = adj(
      [
        "import",
        "--sample-dir",
        sampleDir,
        "--reviewer",
        r1,
        "--reviewer-id",
        "rev-1",
        "--second-reviewer",
        r2,
        "--second-reviewer-id",
        "rev-2",
        "--resolutions",
        resolutions,
        "--out",
        out,
      ],
      cwd,
    );
    expect(r.status, r.stderr).toBe(0);
    expect(readdirSync(out).sort()).toEqual(["adjudication-manifest.json", "adjudications.jsonl"]);

    const jsonl = readFileSync(join(out, "adjudications.jsonl"), "utf8");
    const rows = jsonl
      .trim()
      .split("\n")
      .map((l) => validateE2Adjudication(JSON.parse(l)));
    expect(rows.map((x) => x.exampleId)).toEqual([...ids].sort());
    expect(rows.map((x) => x.finalAdjudicatedLanguage)).toEqual([
      "mixed",
      "ru",
      "uk",
      "mixed",
      "unknown",
      "en",
      "ru",
    ]);
    const manifest = validateE2AdjudicationManifest(
      JSON.parse(readFileSync(join(out, "adjudication-manifest.json"), "utf8")),
    );
    expect(manifest.adjudicationSha256).toBe(sha(jsonl));
    expect(manifest.disagreementCount).toBe(1);
    expect(manifest.secondReviewerUsed).toBe(true);
    expect(manifest.reviewerIds).toEqual(["rev-1", "rev-2"]);
    expect(manifest.protocolVersion).toBe("e2-lang-1");
    expect(
      checkE2HashChain({
        population: validateE2PopulationManifest(
          JSON.parse(readFileSync(join(sampleDir, "population-manifest.json"), "utf8")),
        ),
        sample: validateE2SampleManifest(
          JSON.parse(readFileSync(join(sampleDir, "sample-manifest.json"), "utf8")),
        ),
        adjudication: manifest,
      }),
    ).toEqual([]);
    expect(snapshot(sampleDir)).toEqual(before);
  }, 120_000);

  describe("exit 2 with nothing written", () => {
    function setup(name: string) {
      const s = makeSample(name);
      const exportPath = join(s.cwd, "blind.csv");
      expect(adj(["export", "--sample-dir", s.sampleDir, "--out", exportPath], s.cwd).status).toBe(
        0,
      );
      const r1 = join(s.cwd, "r1.csv");
      const ids = fillCsv(exportPath, r1, ["en", "ru", "uk", "mixed", "unknown", "en", "ru"]);
      return { ...s, exportPath, r1, ids, before: snapshot(s.sampleDir) };
    }
    const importArgs = (s: { sampleDir: string; r1: string }, out?: string) => [
      "import",
      "--sample-dir",
      s.sampleDir,
      "--reviewer",
      s.r1,
      "--reviewer-id",
      "rev-1",
      ...(out === undefined ? [] : ["--out", out]),
    ];

    it("a missing --out", () => {
      const s = setup("no-out");
      const r = adj(importArgs(s), s.cwd);
      expect(r.status, r.stderr).toBe(2);
      expect(r.stderr.trim()).toBe("--out is required");
      expect(r.stderr).not.toMatch(NO_STACK);
      expect(snapshot(s.sampleDir)).toEqual(s.before);
    }, 120_000);

    it("a non-empty --out", () => {
      const s = setup("non-empty");
      const out = join(s.cwd, "out");
      mkdirSync(out);
      writeFileSync(join(out, "keep.txt"), "frozen");
      const r = adj(importArgs(s, out), s.cwd);
      expect(r.status, r.stderr).toBe(2);
      expect(r.stderr).toMatch(/not empty/);
      expect(r.stderr).not.toMatch(NO_STACK);
      expect(readdirSync(out)).toEqual(["keep.txt"]);
    }, 120_000);

    it("an export outside the allowlisted root", () => {
      const s = setup("export-escape");
      const outside = join(tmp, "escape.csv");
      const r = adj(["export", "--sample-dir", s.sampleDir, "--out", outside], s.cwd);
      expect(r.status, r.stderr).toBe(2);
      expect(r.stderr).toMatch(/not inside --e2-root/);
      expect(existsSync(outside)).toBe(false);
    }, 120_000);

    it("an existing export file", () => {
      const s = setup("export-exists");
      const r = adj(["export", "--sample-dir", s.sampleDir, "--out", s.exportPath], s.cwd);
      expect(r.status, r.stderr).toBe(2);
      expect(r.stderr).toMatch(/already exists/);
      expect(r.stderr).not.toMatch(NO_STACK);
      expect(snapshot(s.sampleDir)).toEqual(s.before);
    }, 120_000);

    it("an export into the sample directory", () => {
      const s = setup("export-into-sample");
      const r = adj(
        ["export", "--sample-dir", s.sampleDir, "--out", join(s.sampleDir, "x.csv")],
        s.cwd,
      );
      expect(r.status, r.stderr).toBe(2);
      expect(snapshot(s.sampleDir)).toEqual(s.before);
    }, 120_000);

    it("an unresolved disagreement", () => {
      const s = setup("unresolved");
      const r2 = join(s.cwd, "r2.csv");
      fillCsv(s.exportPath, r2, ["ru", "ru", "uk", "mixed", "unknown", "en", "ru"]);
      const out = join(s.cwd, "out");
      const r = adj(
        [...importArgs(s, out), "--second-reviewer", r2, "--second-reviewer-id", "rev-2"],
        s.cwd,
      );
      expect(r.status, r.stderr).toBe(2);
      expect(r.stderr).toMatch(/^refused: .*unresolved disagreement/m);
      expect(r.stderr).not.toMatch(NO_STACK);
      expect(existsSync(out)).toBe(false);
      expect(snapshot(s.sampleDir)).toEqual(s.before);
    }, 120_000);

    it("a missing id", () => {
      const s = setup("missing-id");
      const lines = readFileSync(s.r1, "utf8").trimEnd().split("\n");
      writeFileSync(s.r1, `${lines.slice(0, -1).join("\n")}\n`);
      const out = join(s.cwd, "out");
      const r = adj(importArgs(s, out), s.cwd);
      expect(r.status, r.stderr).toBe(2);
      expect(r.stderr).toMatch(/^refused: .*not adjudicated/m);
      expect(r.stderr).not.toMatch(NO_STACK);
      expect(existsSync(out)).toBe(false);
      expect(snapshot(s.sampleDir)).toEqual(s.before);
    }, 120_000);

    it("an invalid language value", () => {
      const s = setup("bad-value");
      fillCsv(s.exportPath, s.r1, ["Russian", "ru", "uk", "mixed", "unknown", "en", "ru"]);
      const out = join(s.cwd, "out");
      const r = adj(importArgs(s, out), s.cwd);
      expect(r.status, r.stderr).toBe(2);
      expect(r.stderr).toMatch(/invalid language/);
      expect(existsSync(out)).toBe(false);
    }, 120_000);
  });
});
