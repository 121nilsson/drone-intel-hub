import { describe, expect, it } from "vitest";
import { diffMove } from "../../scripts/lib/move-diff.mjs";

const OLD = `
import { a } from "./a";
/** Doubles. */
function double(n: number) {
  return n * 2;
}
export const LIMIT = 10;
`;

describe("verifying that a refactor only moved code", () => {
  it("accepts a split that adds export, re-wraps lines and rewrites imports", () => {
    const parts: [string, string][] = [
      [
        "double.ts",
        `import { b } from "./b";\n// moved\nexport function double(n:number){return n*2}\n`,
      ],
      ["limit.ts", `export const LIMIT =\n  10;\n`],
      ["index.ts", `export * from "./double";\nexport * from "./limit";\n`],
    ];
    const r = diffMove([["old.ts", OLD]], parts);
    expect(r.lost).toEqual([]);
    expect(r.kept).toBe(2);
  });

  it("reports an edited function as lost and names it as changed", () => {
    const edited: [string, string][] = [
      [
        "double.ts",
        `export function double(n: number) { return n * 3; }\nexport const LIMIT = 10;`,
      ],
    ];
    const r = diffMove([["old.ts", OLD]], edited);
    expect(r.lost.map((l) => l.name)).toEqual(["double"]);
    expect(r.changed).toEqual(["double"]);
  });

  it("reports a dropped statement as lost without calling it changed", () => {
    const r = diffMove([["old.ts", OLD]], [["x.ts", `export const LIMIT = 10;`]]);
    expect(r.lost.map((l) => l.name)).toEqual(["double"]);
    expect(r.changed).toEqual([]);
  });

  it("lists statements that only the new files have, without failing them", () => {
    const r = diffMove(
      [["old.ts", OLD]],
      [
        [
          "x.ts",
          `function double(n: number) { return n * 2; }\nconst LIMIT = 10;\nexport const extra = 1;`,
        ],
      ],
    );
    expect(r.lost).toEqual([]);
    expect(r.added.map((a) => a.name)).toEqual(["extra"]);
  });

  it("counts a statement that now exists twice as one lost copy", () => {
    const r = diffMove([["old.ts", `const a = 1;\nconst a = 1;`]], [["x.ts", `const a = 1;`]]);
    expect(r.lost).toHaveLength(1);
  });

  it("parses tsx", () => {
    const tsx = `export function Hi() { return <p className="x">hi</p>; }`;
    const r = diffMove([["a.tsx", tsx]], [["b.tsx", tsx]]);
    expect(r.lost).toEqual([]);
    expect(r.kept).toBe(1);
  });
});
