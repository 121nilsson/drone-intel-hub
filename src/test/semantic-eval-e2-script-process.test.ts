/**
 * scripts/e2-freeze-and-draw.ts as a process, in the style of semantic-eval-scripts-process.test.ts:
 * jiti, a temporary working directory, every input and output under it. Nothing is written into
 * the repository.
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
import {
  checkE2HashChain,
  validateE2Example,
  validateE2PopulationManifest,
  validateE2SampleManifest,
} from "../entities/normalization/semantic-eval/e2/validate";

const require = createRequire(import.meta.url);
const JITI_PKG = require.resolve("jiti/package.json");
const JITI_CLI = join(dirname(JITI_PKG), (require(JITI_PKG) as { bin: { jiti: string } }).bin.jiti);
const ROOT = resolve(".");
const tmp = mkdtempSync(join(tmpdir(), "e2-freeze-draw-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const NO_STACK = /^\s+at /m;

function freshDir(name: string): string {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function run(args: readonly string[], cwd: string) {
  const r = spawnSync(
    process.execPath,
    [JITI_CLI, join(ROOT, "scripts", "e2-freeze-and-draw.ts"), ...args, "--e2-root", cwd],
    {
      cwd,
      encoding: "utf8",
      env: { ...process.env, JITI_ALIAS: JSON.stringify({ "@/": `${join(ROOT, "src")}/` }) },
      timeout: 60_000,
    },
  );
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const EN = "The aircraft is a long range drone that is used by the army and it has been seen";
const RU = "Беспилотник имеет максимальную скорость сто километров в час при полете";
const UK = "Дрон має максимальну швидкість сто кілометрів на годину і є українським";

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

function writeRows(cwd: string, rows: readonly object[]): string {
  const p = join(cwd, "rows.jsonl");
  writeFileSync(p, `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
  return p;
}

// 3 en, 2 ru, 1 uk, 1 unknown
const GOOD = [row(1, EN), row(2, EN), row(3, EN), row(4, RU), row(5, RU), row(6, UK), row(7, "x")];

describe("e2-freeze-and-draw.ts as a process", () => {
  it("happy path: four files, all valid and chained", () => {
    const cwd = freshDir("happy");
    const input = writeRows(cwd, GOOD);
    const out = join(cwd, "out");
    const r = run(
      ["--in", input, "--out", out, "--seed", "test-seed", "--n", "5", "--m", "1"],
      cwd,
    );
    expect(r.status, r.stderr).toBe(0);
    expect(readdirSync(out).sort()).toEqual([
      "population-manifest.json",
      "population.jsonl",
      "sample-manifest.json",
      "sample.jsonl",
    ]);
    const popText = readFileSync(join(out, "population.jsonl"), "utf8");
    const sampleText = readFileSync(join(out, "sample.jsonl"), "utf8");
    const popRows = popText
      .trim()
      .split("\n")
      .map((l) => validateE2Example(JSON.parse(l)));
    const sampleRows = sampleText
      .trim()
      .split("\n")
      .map((l) => validateE2Example(JSON.parse(l)));
    const popManifest = validateE2PopulationManifest(
      JSON.parse(readFileSync(join(out, "population-manifest.json"), "utf8")),
    );
    const sampleManifest = validateE2SampleManifest(
      JSON.parse(readFileSync(join(out, "sample-manifest.json"), "utf8")),
    );
    expect(popRows.length).toBe(7);
    expect(popManifest.populationCount).toBe(7);
    expect(popManifest.stratumCounts).toEqual({ en: 3, ru: 2, uk: 1, unknown: 1 });
    expect(popManifest.populationRowsSha256).toBe(sha(popText));
    expect(popManifest.rawExportSha256).toBe(sha(readFileSync(input, "utf8")));
    expect(sampleManifest.drawnRowsSha256).toBe(sha(sampleText));
    expect(sampleRows.length).toBe(5);
    // minima 1 each = 4, r = 1 over en (3) and ru (2): remainders 3 and 2 -> en. en 2, ru 1.
    expect(sampleManifest.strata.map((s) => s.sampleCount)).toEqual([2, 1, 1, 1]);
    expect(checkE2HashChain({ population: popManifest, sample: sampleManifest })).toEqual([]);
    // The input stays where it was and nothing else appeared in the working directory.
    expect(readdirSync(cwd).sort()).toEqual(["out", "rows.jsonl"]);
  }, 60_000);

  it("exit 2 when --out leaves the allowlisted root, nothing written", () => {
    const cwd = freshDir("escape");
    const input = writeRows(cwd, GOOD);
    const out = join(tmp, "escape-out");
    const r = run(["--in", input, "--out", out, "--seed", "s", "--n", "5", "--m", "1"], cwd);
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toMatch(/not inside --e2-root/);
    expect(existsSync(out)).toBe(false);
  }, 60_000);

  it("exit 2 without --out, nothing written", () => {
    const cwd = freshDir("no-out");
    const input = writeRows(cwd, GOOD);
    const r = run(["--in", input, "--seed", "s", "--n", "5", "--m", "1"], cwd);
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr.trim()).toBe("--out is required");
    expect(r.stderr).not.toMatch(NO_STACK);
    expect(readdirSync(cwd)).toEqual(["rows.jsonl"]);
  }, 60_000);

  it("exit 2 when --out is non-empty, with nothing changed", () => {
    const cwd = freshDir("non-empty");
    const input = writeRows(cwd, GOOD);
    const out = join(cwd, "out");
    mkdirSync(out);
    writeFileSync(join(out, "keep.txt"), "frozen");
    const r = run(["--in", input, "--out", out, "--seed", "s", "--n", "5", "--m", "1"], cwd);
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toMatch(/not empty/);
    expect(r.stderr).not.toMatch(NO_STACK);
    expect(readdirSync(out)).toEqual(["keep.txt"]);
    expect(readFileSync(join(out, "keep.txt"), "utf8")).toBe("frozen");
  }, 60_000);

  it("exit 2 on a declared unknown, nothing written", () => {
    const cwd = freshDir("declared-unknown");
    const input = writeRows(cwd, [...GOOD, row(8, EN, { declaredLanguage: "unknown" })]);
    const out = join(cwd, "out");
    const r = run(["--in", input, "--out", out, "--seed", "s", "--n", "5", "--m", "1"], cwd);
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toMatch(/^refused: .*declaredLanguage "unknown"/m);
    expect(r.stderr).not.toMatch(NO_STACK);
    expect(existsSync(out)).toBe(false);
  }, 60_000);

  it("exit 2 on the legacy language field, nothing written", () => {
    const cwd = freshDir("legacy");
    const input = writeRows(cwd, [...GOOD, row(8, EN, { language: "en" })]);
    const out = join(cwd, "out");
    const r = run(["--in", input, "--out", out, "--seed", "s", "--n", "5", "--m", "1"], cwd);
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toMatch(/^refused: .*legacy language field/m);
    expect(r.stderr).not.toMatch(NO_STACK);
    expect(existsSync(out)).toBe(false);
  }, 60_000);

  it("exit 2 when the minima exceed n, nothing written", () => {
    const cwd = freshDir("refused-alloc");
    const input = writeRows(cwd, GOOD);
    const out = join(cwd, "out");
    const r = run(["--in", input, "--out", out, "--seed", "s", "--n", "3", "--m", "1"], cwd);
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toMatch(/allocation refused/);
    expect(r.stderr).not.toMatch(NO_STACK);
    expect(existsSync(out)).toBe(false);
  }, 60_000);
});
