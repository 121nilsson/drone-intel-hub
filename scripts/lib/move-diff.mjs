import ts from "typescript";

/**
 * What a refactor that only moves code must preserve: every top-level statement, character for
 * character once comments, formatting and the `export` keyword are set aside. Printing each
 * statement through the TypeScript printer makes prettier's re-wrapping irrelevant, which a
 * line-by-line comparison cannot do.
 *
 * Imports and re-exports are skipped on purpose: a split rewrites them by definition, and the
 * type checker is what proves they resolve.
 */
export function statementsOf(source, fileName = "file.tsx") {
  const kind = fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const printer = ts.createPrinter({ removeComments: true });
  const out = [];
  for (const node of file.statements) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) continue;
    if (ts.isExportAssignment(node)) continue;
    const text = printer
      .printNode(ts.EmitHint.Unspecified, node, file)
      .replace(/^export\s+(default\s+)?/, "")
      .replace(/\s+/g, " ")
      .trim();
    out.push({ name: nameOf(node, file), text });
  }
  return out;
}

function nameOf(node, file) {
  if (ts.isVariableStatement(node))
    return node.declarationList.declarations.map((d) => d.name.getText(file)).join(", ");
  const n = node.name;
  return n ? n.getText(file) : ts.SyntaxKind[node.kind];
}

/** Compare the statements of the old files with those of the new files. */
export function diffMove(oldSources, newSources) {
  const tally = (sources) => {
    const m = new Map();
    for (const { text, name } of sources.flatMap(([f, s]) => statementsOf(s, f))) {
      const e = m.get(text) ?? { name, n: 0 };
      e.n++;
      m.set(text, e);
    }
    return m;
  };
  const before = tally(oldSources);
  const after = tally(newSources);
  const lost = [];
  const added = [];
  for (const [text, { name, n }] of before) {
    const left = n - (after.get(text)?.n ?? 0);
    for (let i = 0; i < left; i++) lost.push({ name, text });
  }
  for (const [text, { name, n }] of after) {
    const extra = n - (before.get(text)?.n ?? 0);
    for (let i = 0; i < extra; i++) added.push({ name, text });
  }
  // A statement whose name is on both sides but whose body differs was edited, not moved.
  const addedNames = new Set(added.map((a) => a.name));
  const changed = lost.filter((l) => addedNames.has(l.name)).map((l) => l.name);
  return {
    kept: [...before.values()].reduce((a, e) => a + e.n, 0) - lost.length,
    lost,
    added,
    changed: [...new Set(changed)],
  };
}
