#!/usr/bin/env node
/**
 * Baseline-diff green gate for drone-intel-hub.
 *
 * The problem this solves: "run the tests and make sure everything passes" is only meaningful
 * against a known starting point. A repo can carry a pre-existing failure, and without a baseline
 * you cannot tell the one you introduced from the one that was already there - so you either
 * wave through a real regression or refuse to finish.
 *
 * So: snapshot before you edit, compare after. Only findings that are NEW block the run.
 *
 *   node scripts/green-check.mjs --save     # before starting work; records the starting state
 *   node scripts/green-check.mjs            # after finishing; exits 1 if you regressed
 *   node scripts/green-check.mjs --clear    # drop the baseline
 *
 * With no baseline saved, the gate falls back to "no errors at all", which is what this repo
 * currently satisfies. The baseline file is deliberately gitignored: a committed one goes stale
 * as the codebase moves and turns into diff noise nobody reads.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const BASELINE_FILE = resolve(ROOT, ".greencheck-baseline.json");
const NPX = process.platform === "win32" ? "npx.cmd" : "npx";
const isWindows = process.platform === "win32";

/**
 * Findings are keyed WITHOUT line and column numbers.
 *
 * Inserting an import at the top of a file shifts every diagnostic below it, which would make
 * every touched file look like it had a dozen new findings. Rule and message are what actually
 * identify a problem; position is incidental.
 */
const key = (...parts) => parts.filter(Boolean).join(" :: ");

function run(args) {
  const r = spawnSync(NPX, args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: isWindows,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  // Some tools colour their output when the environment asks for it (FORCE_COLOR), even when
  // stdout is a pipe. An ANSI-wrapped `[warn]` line does not match the format check's regex, and
  // a whole failing prettier pass silently reads as zero findings - which is how this gate came
  // to report a clean format check on a tree with six unformatted files. Strip colour first.
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.replace(/\u001b\[[0-9;]*m/g, "");
  return { code: r.status ?? 1, out };
}

/** Errors block. Warnings are reported but tolerated - see eslint's 14 existing react-refresh ones. */
const CHECKS = [
  {
    name: "tsc",
    label: "type check",
    args: ["tsc", "--noEmit"],
    /** @returns {{findings: string[], blocking: boolean}} */
    collect({ code, out }) {
      const findings = out
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => /error TS\d+:/.test(l))
        .map((l) => key(l.replace(/\(\d+,\d+\)/, "")));
      return { findings, blocking: code !== 0 || findings.length > 0 };
    },
  },
  {
    name: "eslint",
    label: "lint",
    args: ["eslint", ".", "-f", "json"],
    collect({ code, out }) {
      let results = [];
      try {
        results = JSON.parse(out.slice(out.indexOf("[")));
      } catch {
        return { findings: [key("eslint produced no parseable JSON")], blocking: true };
      }
      const findings = [];
      let blocking = code !== 0;
      for (const file of results) {
        const rel = relative(ROOT, file.filePath ?? "");
        for (const m of file.messages ?? []) {
          findings.push(key(rel, m.severity === 2 ? "error" : "warning", m.ruleId, m.message));
          if (m.severity === 2) blocking = true;
        }
      }
      return { findings, blocking };
    },
  },
  {
    name: "prettier",
    label: "format",
    args: ["prettier", "--check", "."],
    collect({ code, out }) {
      const findings = out
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => /^\[warn\]/.test(l))
        .map((l) => key(l.replace(/^\[warn\]\s*/, "")));
      return { findings, blocking: code !== 0 || findings.length > 0 };
    },
  },
  {
    name: "vitest",
    label: "tests",
    // No --reporter flag: `basic` was removed in Vitest 3, and a pinned reporter name would make
    // this script break on a vitest upgrade. The default output is parsed instead.
    args: ["vitest", "run"],
    collect({ code, out }) {
      const findings = [];
      // " FAIL  src/test/foo.test.ts > some test name" - the file, so a newly broken file is
      // visible even when the individual test name also changed.
      for (const m of out.matchAll(/FAIL\s+(src[^\s>]*\.test\.tsx?)(?:\s*>\s*(.+))?/g)) {
        findings.push(key("failing", m[1], (m[2] ?? "").trim()));
      }
      return { findings, blocking: code !== 0 || findings.length > 0 };
    },
  },
];

// ---------------------------------------------------------------- CLI flags

if (process.argv.includes("--clear")) {
  if (existsSync(BASELINE_FILE)) rmSync(BASELINE_FILE);
  console.log("green-check: baseline cleared.");
  process.exit(0);
}

const save = process.argv.includes("--save");

const baseline =
  !save && existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, "utf8")) : {};
const hasBaseline = !save && existsSync(BASELINE_FILE);

const current = {};
const failed = [];

for (const check of CHECKS) {
  const started = Date.now();
  process.stdout.write(`green-check: ${check.label} ... `);
  const result = check.collect(run(check.args));
  current[check.name] = result.findings;
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`${result.findings.length} finding(s) in ${secs}s`);

  const before = baseline[check.name] ?? [];
  const added = result.findings.filter((f) => !before.includes(f));
  const fixed = before.filter((f) => !result.findings.includes(f));

  // Only NEW findings block. Without a baseline, "new" is everything, which is the strict
  // reading - correct for a repo that currently passes everything.
  const blockers = hasBaseline ? added : result.blocking ? result.findings : [];
  if (blockers.length > 0) failed.push({ check, blockers, fixed });
  if (!hasBaseline && !result.blocking && result.findings.length > 0) {
    console.log(`  ${result.findings.length} non-blocking finding(s) (no baseline saved)`);
  }
}

// ---------------------------------------------------------------- Report

if (save) {
  writeFileSync(BASELINE_FILE, JSON.stringify(current, null, 2));
  const total = Object.values(current).reduce((n, f) => n + f.length, 0);
  console.log(
    `\nBaseline saved to .greencheck-baseline.json (${total} existing finding(s) tolerated).`,
  );
  process.exit(0);
}

console.log("");
if (failed.length === 0) {
  console.log(
    hasBaseline
      ? "green-check: GREEN - no new findings vs the baseline."
      : "green-check: GREEN - no blocking findings.",
  );
  for (const c of CHECKS) {
    const n = current[c.name].length;
    if (n > 0) console.log(`  ${n} pre-existing ${c.name} finding(s) tolerated`);
  }
  process.exit(0);
}

console.log("green-check: RED - you introduced:\n");
for (const { check, blockers, fixed } of failed) {
  console.log(`  ${check.name}:`);
  for (const b of blockers) console.log(`    + ${b}`);
  for (const f of fixed) console.log(`    - ${f}  (fixed)`);
  console.log("");
}
process.exit(1);
