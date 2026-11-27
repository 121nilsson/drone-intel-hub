/**
 * Runs the semantic-eval scripts as separate processes (review findings T2, T4): the refusals live
 * in the scripts' own control flow, which unit tests of the library cannot reach. Every run here is
 * refused before it reads data or writes a file; outputs are pointed at a temporary directory.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const JITI_CLI = join(dirname(require.resolve("jiti/package.json")), "lib", "jiti-cli.mjs");
const ROOT = resolve(".");
const tmp = mkdtempSync(join(tmpdir(), "semantic-eval-scripts-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function run(script: string, args: readonly string[]) {
  const r = spawnSync(process.execPath, [JITI_CLI, join(ROOT, "scripts", script), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, JITI_ALIAS: JSON.stringify({ "@/": `${join(ROOT, "src")}/` }) },
    timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const NO_STACK = /^\s+at /m;

describe("sample-historical-evaluation-set.ts as a process (T2)", () => {
  it("refuses the committed pilot rows under 1.1.0: exit 2, the reason, no stack trace, nothing written", () => {
    const report = join(tmp, "sampling.md");
    const r = run("sample-historical-evaluation-set.ts", [
      "--schema-version",
      "1.1.0",
      "--report",
      report,
    ]);
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toMatch(
      /^refused: row \S+ sets the legacy language field;.*declaredLanguage/m,
    );
    expect(r.stderr).not.toMatch(NO_STACK);
    expect(existsSync(report)).toBe(false);
  }, 60_000);

  it("refuses a value flag followed by another flag: exit 2, nothing written", () => {
    const report = join(tmp, "sampling-2.md");
    const r = run("sample-historical-evaluation-set.ts", ["--report", report, "--in", "--apply"]);
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr.trim()).toBe("--in needs a value");
    expect(existsSync(report)).toBe(false);
  }, 60_000);
});

describe("evaluate-semantic-registry.ts as a process (T4)", () => {
  it("validates every flag before writing: an invalid --report-out leaves no replay report", () => {
    const replay = join(tmp, "replay.md");
    const r = run("evaluate-semantic-registry.ts", ["--report", "--out", replay, "--report-out"]);
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr.trim()).toBe("--report-out needs a value");
    expect(existsSync(replay)).toBe(false);
    expect(r.stdout).not.toMatch(/wrote /);
  }, 60_000);

  it("rejects --out followed by a flag before writing anything", () => {
    const r = run("evaluate-semantic-registry.ts", ["--report", "--out", "--origins", "fixture"]);
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr.trim()).toBe("--out needs a file path");
    expect(r.stdout).not.toMatch(/wrote /);
    expect(existsSync(join(ROOT, "--origins"))).toBe(false);
  }, 60_000);
});
