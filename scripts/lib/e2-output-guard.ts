/**
 * Shared destination guard for the three E2 CLIs (freeze/draw, adjudication, evaluation).
 *
 * An E2 stage is frozen once and never rewritten. Destinations are therefore restricted to an
 * explicit allowlisted root supplied with --e2-root, and can never point into source, docs,
 * migrations, fixtures, committed Phase 3.2 artifacts or other protected repository paths.
 * Traversal and symlinks are resolved before comparison, and existing files are refused.
 */
import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

export const E2_REPO_ROOT = resolve(import.meta.dirname, "..", "..");

/** Roots that hold source, documentation, migrations, fixtures or committed artifacts. */
const PROTECTED_RELATIVE = [
  "src",
  "scripts",
  "docs",
  "migrations",
  "drizzle",
  "eslint-rules",
  ".git",
  ".github",
  ".claude",
  ".lovable",
] as const;

function insideOrEqual(child: string, parent: string): boolean {
  const r = relative(parent, child);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
}

/** Canonical filesystem location, including symlinked ancestors of a not-yet-created target. */
function canonical(path: string): string {
  const absolute = resolve(path);
  let current = absolute;
  const suffix: string[] = [];
  for (;;) {
    try {
      if (lstatSync(current).isSymbolicLink()) return resolve(realpathSync(current), ...suffix);
      if (existsSync(current)) return resolve(current, ...suffix);
    } catch {
      // An inaccessible or dangling component is resolved by its parent below.
    }
    const parent = dirname(current);
    if (parent === current) return absolute;
    suffix.unshift(basename(current));
    current = parent;
  }
}

const protectedRoots = (): readonly string[] =>
  PROTECTED_RELATIVE.map((p) => canonical(resolve(E2_REPO_ROOT, p)));

export function checkE2OutputRoot(root: string): string | undefined {
  const absolute = resolve(root);
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
    return `--e2-root ${absolute} is not a directory`;
  }
  const real = canonical(absolute);
  if (protectedRoots().some((p) => insideOrEqual(real, p))) {
    return `--e2-root ${absolute} is inside a protected repository directory`;
  }
  return undefined;
}

/**
 * Returns an error message when `target` is not a safe destination under `root`. `kind` is "file"
 * for a single CSV and "dir" for a stage directory; an existing empty stage directory is allowed.
 */
export function checkE2OutputPath(
  root: string,
  target: string,
  kind: "file" | "dir",
): string | undefined {
  const rootError = checkE2OutputRoot(root);
  if (rootError !== undefined) return rootError;
  const absolute = resolve(target);
  const real = canonical(absolute);
  // Protected paths are checked before containment so a symlink that escapes into source is
  // reported as a protected destination rather than merely as an out-of-root destination.
  if (protectedRoots().some((p) => insideOrEqual(real, p))) {
    return `--out ${absolute} is inside a protected repository directory`;
  }
  if (!insideOrEqual(real, canonical(resolve(root)))) {
    return `--out ${absolute} is not inside --e2-root ${resolve(root)}`;
  }
  if (kind === "file" && real === canonical(resolve(root))) {
    return `--out ${absolute} must be a file inside --e2-root, not the root itself`;
  }
  try {
    if (lstatSync(absolute).isSymbolicLink()) {
      return `--out ${absolute} must not be a symlink`;
    }
  } catch {
    // No entry at the destination: that is the normal case.
  }
  if (existsSync(absolute) && kind === "file") {
    return `--out ${absolute} already exists`;
  }
  return undefined;
}
