import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * `ListRow` renders its own `<li>`. Wrapping it in another `<li>` is invalid HTML: the browser
 * repairs the server markup, React finds a different tree on hydration and discards the server
 * HTML with a hydration error. Two panels did exactly that.
 */
const SRC = resolve(__dirname, "..");
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );

describe("list markup", () => {
  it("never wraps a ListRow in an li", () => {
    const offenders = walk(SRC)
      .filter((f) => f.endsWith(".tsx") && !f.includes(`${join("src", "test")}`))
      .filter((f) => /<li\b[^>]*>\s*<ListRow\b/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
