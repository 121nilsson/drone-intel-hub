/**
 * Runs the semantic-eval scripts as separate processes (review findings T2, T4, U3, U4): the
 * refusals live in the scripts' own control flow, which unit tests of the library cannot reach.
 *
 * Write safety (U4): every process runs with a temporary working directory, so every relative
 * default path (fixture directories, `scripts/output/…`) resolves inside it, and every output
 * flag points into it as well. Inputs from the repository are passed as absolute paths and are
 * only read. No run here can write to a tracked file, even if a refusal regressed.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const JITI_CLI = join(dirname(require.resolve("jiti/package.json")), "lib", "jiti-cli.mjs");
const ROOT = resolve(".");
const PILOT_ROWS = join(ROOT, "src/test/fixtures/semantic-eval/frame-rows.jsonl");
const V120_DIR = join(ROOT, "src/test/fixtures/semantic-eval-v1.2.0");
const tmp = mkdtempSync(join(tmpdir(), "semantic-eval-scripts-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** A fresh, empty working directory per run, inside the temporary root. */
function freshDir(name: string): string {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function run(script: string, args: readonly string[], cwd: string) {
  const r = spawnSync(process.execPath, [JITI_CLI, join(ROOT, "scripts", script), ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, JITI_ALIAS: JSON.stringify({ "@/": `${join(ROOT, "src")}/` }) },
    timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const NO_STACK = /^\s+at /m;

describe("sample-historical-evaluation-set.ts as a process (T2, U4)", () => {
  it("refuses the committed pilot rows under 1.1.0: exit 2, the reason, no stack trace, nothing written", () => {
    const cwd = freshDir("sampler-1.1.0");
    const out = join(cwd, "out");
    const r = run(
      "sample-historical-evaluation-set.ts",
      [
        "--schema-version",
        "1.1.0",
        "--in",
        PILOT_ROWS,
        "--out",
        out,
        "--report",
        join(cwd, "s.md"),
        "--apply",
      ],
      cwd,
    );
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toMatch(
      /^refused: row \S+ sets the legacy language field;.*declaredLanguage/m,
    );
    expect(r.stderr).not.toMatch(NO_STACK);
    expect(readdirSync(cwd)).toEqual([]);
  }, 60_000);

  it("refuses a value flag followed by another flag: exit 2, nothing written", () => {
    const cwd = freshDir("sampler-flag");
    const r = run(
      "sample-historical-evaluation-set.ts",
      ["--out", join(cwd, "out"), "--report", join(cwd, "s.md"), "--in", "--apply"],
      cwd,
    );
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr.trim()).toBe("--in needs a value");
    expect(readdirSync(cwd)).toEqual([]);
  }, 60_000);
});

describe("evaluate-semantic-registry.ts as a process (T4, U3)", () => {
  it("validates every flag before writing: an invalid --report-out leaves no replay report", () => {
    const cwd = freshDir("s5-flag");
    const r = run(
      "evaluate-semantic-registry.ts",
      ["--report", "--out", join(cwd, "replay.md"), "--report-out"],
      cwd,
    );
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr.trim()).toBe("--report-out needs a value");
    expect(r.stdout).not.toMatch(/wrote /);
    expect(readdirSync(cwd)).toEqual([]);
  }, 60_000);

  it("rejects --out followed by a flag before writing anything", () => {
    const cwd = freshDir("s5-out");
    const r = run(
      "evaluate-semantic-registry.ts",
      ["--report", "--out", "--origins", "fixture"],
      cwd,
    );
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr.trim()).toBe("--out needs a file path");
    expect(r.stdout).not.toMatch(/wrote /);
    expect(readdirSync(cwd)).toEqual([]);
  }, 60_000);

  it("writes nothing when well-formed S5 arguments turn out wrong (U3)", () => {
    const cases: [string, string[], RegExp][] = [
      ["missing data dir", ["--data-dir", join(tmp, "no-such-dir")], /missing .*examples\.jsonl/],
      [
        "missing decisions",
        ["--data-dir", V120_DIR, "--decisions", join(tmp, "no-such.jsonl"), "--origins", "fixture"],
        /missing .*no-such\.jsonl/,
      ],
      [
        "origins without examples",
        [
          "--data-dir",
          V120_DIR,
          "--decisions",
          join(V120_DIR, "examples.jsonl"),
          "--origins",
          "bogus",
        ],
        /./,
      ],
    ];
    for (const [name, extra, message] of cases) {
      const cwd = freshDir(`s5-${name.replace(/ /g, "-")}`);
      const r = run(
        "evaluate-semantic-registry.ts",
        [
          "--report",
          "--out",
          join(cwd, "replay.md"),
          "--report-out",
          join(cwd, "metrics.md"),
          ...extra,
        ],
        cwd,
      );
      expect(r.status, `${name}: ${r.stderr}`).toBe(1);
      expect(r.stderr, name).toMatch(message);
      expect(r.stdout, name).not.toMatch(/wrote /);
      expect(readdirSync(cwd), name).toEqual([]);
    }
  }, 120_000);
});
