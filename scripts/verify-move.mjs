#!/usr/bin/env node
/**
 * Prove that a refactor only moved code.
 *
 *   node scripts/verify-move.mjs --base <git-ref> --old <path> [--old <path>...] \
 *        [--head <git-ref>] --new <path> [--new <path>...]
 *
 * Old files are read at --base. New files are read at --head, or from the working tree when
 * --head is left out. Exit 1 when a top-level statement from the old files is missing or was
 * edited in the new ones; statements only the new files have are listed but allowed (a new
 * barrel, a shared helper). See scripts/lib/move-diff.mjs for what counts as "the same".
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { diffMove } from "./lib/move-diff.mjs";

const args = process.argv.slice(2);
const take = (flag) => args.flatMap((a, i) => (a === flag && args[i + 1] ? [args[i + 1]] : []));
const [base] = take("--base");
const [head] = take("--head");
const oldFiles = take("--old");
const newFiles = take("--new");
if (!base || !oldFiles.length || !newFiles.length) {
  console.error("usage: verify-move --base <ref> --old <path>... [--head <ref>] --new <path>...");
  process.exit(2);
}

const git = (ref, path) =>
  execFileSync("git", ["show", `${ref}:${path}`], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
const result = diffMove(
  oldFiles.map((f) => [f, git(base, f)]),
  newFiles.map((f) => [f, head ? git(head, f) : readFileSync(f, "utf8")]),
);

console.log(`kept ${result.kept} statement(s)`);
for (const a of result.added) console.log(`  new: ${a.name}`);
if (result.changed.length)
  console.log(`EDITED (same name, different body): ${result.changed.join(", ")}`);
for (const l of result.lost) console.log(`  LOST: ${l.name}`);
if (result.lost.length) {
  console.log(`verify-move: FAIL - ${result.lost.length} statement(s) not preserved.`);
  process.exit(1);
}
console.log("verify-move: OK - every statement is preserved.");
