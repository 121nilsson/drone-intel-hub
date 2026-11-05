import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * A doc that names a file the tree does not have misleads whoever follows it. The roadmap and
 * README both pointed at files that were moved or never existed for weeks, because nothing
 * checked: this does. It reads the backticked paths in the docs a reader trusts and fails on one
 * that resolves to nothing.
 */
const ROOT = resolve(__dirname, "../..");
const DOCS = [
  "AGENTS.md",
  "README.md",
  "get_human_out_of_the_loop_plan.md",
  ...readdirSync(join(ROOT, "docs"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => `docs/${f}`),
];

/**
 * Paths a document mentions on purpose without the file existing (planned work, or a file the
 * document says is gone). Each needs its reason; an entry that starts to exist is a stale entry.
 */
const ALLOWED_MISSING: Record<string, string> = {
  "docs/EVALUATION_AUTOMATION.md:tasks/evaluation/adjudicate.ts":
    "the document itself says the file was never created; adjudication runs as a server function",
  "docs/ideas.md:src/test/fixtures/fetch":
    "ideas.md proposes moving the inline fixtures here; the directory is planned, not made",
  "docs/modelbenchmark.md:scripts/benchmark-results.json":
    "written by scripts/benchmark-models.mjs when it runs; not committed",
};

const TOP = ["src", "migrations", "scripts", "plugins", "tasks", "docs", "eslint-rules", "public"];
// AGENTS.md names source files relative to src/.
const SRC_LAYERS = ["entities", "shared", "features", "routes", "components", "integrations"];

function candidates(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/`([^`\s]+)`/g)) {
    let p = m[1]!.replace(/:\d+(-\d+)?$/, "").replace(/[.,;:)]+$/, "");
    if (/[*<>{}$|=?!]|\.\.\./.test(p) || p.includes("://") || p.startsWith("@/")) continue;
    const head = p.split("/")[0]!;
    if (SRC_LAYERS.includes(head) && p.includes("/")) p = `src/${p}`;
    else if (!TOP.includes(head) || !p.includes("/")) continue;
    // `a/b.ts`-shaped or a directory; skip prose such as `src/test/fixtures/` examples handled below.
    out.add(p.replace(/\/$/, ""));
  }
  return [...out];
}

const EXTENSIONS = ["", ".ts", ".tsx", ".mjs", ".js", ".json", ".md", ".sql", "/index.ts"];
const resolves = (p: string) => EXTENSIONS.some((e) => existsSync(join(ROOT, p + e)));

describe("paths named in the docs", () => {
  for (const doc of DOCS) {
    it(`${doc} names only files that exist`, () => {
      const missing = candidates(readFileSync(join(ROOT, doc), "utf8")).filter(
        (p) => !resolves(p) && !(`${doc}:${p}` in ALLOWED_MISSING),
      );
      expect(missing, `in ${doc}`).toEqual([]);
    });
  }

  it("keeps no allowance for a path that exists now", () => {
    for (const key of Object.keys(ALLOWED_MISSING)) {
      expect(resolves(key.split(":")[1]!), key).toBe(false);
    }
  });
});
