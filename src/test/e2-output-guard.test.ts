/**
 * The shared E2 destination guard: allowlisted root, traversal, protected paths, symlinks and
 * overwrites. Every path in these tests is a temporary directory; the repository is only read.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  E2_REPO_ROOT,
  checkE2OutputPath,
  checkE2OutputRoot,
} from "../../scripts/lib/e2-output-guard";

const tmp = mkdtempSync(join(tmpdir(), "e2-output-guard-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const root = join(tmp, "root");
mkdirSync(root, { recursive: true });

describe("checkE2OutputRoot", () => {
  it("accepts a plain directory and refuses one inside protected source", () => {
    expect(checkE2OutputRoot(root)).toBeUndefined();
    expect(checkE2OutputRoot(join(E2_REPO_ROOT, "src"))).toMatch(/protected repository directory/);
    expect(checkE2OutputRoot(join(E2_REPO_ROOT, "scripts", "output"))).toMatch(
      /protected repository directory/,
    );
  });
});

describe("checkE2OutputPath", () => {
  it("accepts a destination under the allowlisted root", () => {
    expect(checkE2OutputPath(root, join(root, "stage", "sample.jsonl"), "file")).toBeUndefined();
  });

  it("refuses a destination that traverses out of the root", () => {
    expect(checkE2OutputPath(root, join(root, "..", "outside.jsonl"), "file")).toMatch(
      /not inside --e2-root/,
    );
  });

  it("refuses fixtures, migrations, docs and committed output even with the repo as root", () => {
    for (const target of [
      join(E2_REPO_ROOT, "src", "test", "fixtures", "x.jsonl"),
      join(E2_REPO_ROOT, "docs", "x.md"),
      join(E2_REPO_ROOT, "migrations", "001_x.sql"),
      join(E2_REPO_ROOT, "scripts", "output", "x.md"),
    ]) {
      expect(checkE2OutputPath(E2_REPO_ROOT, target, "file"), target).toMatch(
        /protected repository directory/,
      );
    }
  });

  it("refuses a symlink that escapes into a protected directory", () => {
    const link = join(root, "to-src");
    try {
      symlinkSync(join(E2_REPO_ROOT, "src"), link, "junction");
    } catch {
      // Windows without developer mode cannot create a junction; the path checks above still run.
      return;
    }
    expect(checkE2OutputPath(root, join(link, "new.jsonl"), "file")).toMatch(
      /protected repository directory/,
    );
  });

  it("refuses an existing file, but allows an existing empty stage directory", () => {
    const file = join(root, "exists.jsonl");
    writeFileSync(file, "{}");
    expect(checkE2OutputPath(root, file, "file")).toMatch(/already exists/);
    const dir = join(root, "empty-stage");
    mkdirSync(dir);
    expect(checkE2OutputPath(root, dir, "dir")).toBeUndefined();
    expect(existsSync(dir)).toBe(true);
  });
});
