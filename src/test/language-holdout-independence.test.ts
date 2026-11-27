import { describe, expect, it } from "vitest";
import {
  HOLDOUT_TEXT_HASH_METHOD,
  canonicalHoldoutText,
  holdoutIndependence,
} from "@/entities/normalization/language-holdout";
import { sha256Hex } from "@/entities/normalization/sha256";

const holdoutTextHash = (text: string) => sha256Hex(canonicalHoldoutText(text));
const check = (input: { newRows: unknown; newSource: string | undefined; consumedRows: unknown }) =>
  holdoutIndependence({ sha256: sha256Hex, ...input });

// Synthetic rows only: no holdout is imported here.
const row = (id: string, text: string) => ({ id, category: "c", text, allowedDecisive: null });
const consumed = [row("a1", "Дрон упал в поле."), row("a2", "Ракета летела низко.")];
const fresh = [row("b1", "Новый текст про дрон."), row("b2", "Інший текст.")];
const SOURCE = 'export const LANGUAGE_DETECT_HOLDOUT = [\n  { id: "b1", text: "…" },\n];\n';

describe("V4: canonical text hash", () => {
  it("is documented and ignores only case, Unicode form and whitespace", () => {
    expect(HOLDOUT_TEXT_HASH_METHOD).toMatch(/NFC.*lower-cased.*whitespace.*trimmed/);
    const decomposed = "Дрон йде".normalize("NFD");
    expect(canonicalHoldoutText(`  ДРОН\t\n ${decomposed.slice(5)}  `)).toBe("дрон йде");
    expect(holdoutTextHash("Дрон  упал")).toBe(holdoutTextHash(" дрон упал "));
    expect(holdoutTextHash("Дрон упал")).not.toBe(holdoutTextHash("Дрон упал."));
    expect(holdoutTextHash("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("V4: holdout independence gate", () => {
  it("accepts a disjoint, self-contained holdout", () => {
    expect(check({ newRows: fresh, newSource: SOURCE, consumedRows: consumed })).toEqual({
      accepted: true,
      reasons: [],
      counts: {
        newRows: 2,
        consumedRows: 2,
        idOverlap: 0,
        textHashOverlap: 0,
        duplicateTextsInNew: 0,
      },
    });
  });

  it("rejects an overlapping row id", () => {
    const r = check({
      newRows: [...fresh, row("a1", "Совсем другой текст.")],
      newSource: SOURCE,
      consumedRows: consumed,
    });
    expect(r.accepted).toBe(false);
    expect(r.counts.idOverlap).toBe(1);
    expect(r.reasons).toContain("1 row id(s) overlap the consumed holdout");
  });

  it("rejects a consumed text under a new id, even re-cased and re-spaced", () => {
    const r = check({
      newRows: [...fresh, row("b3", "  дрон  УПАЛ в поле. ")],
      newSource: SOURCE,
      consumedRows: consumed,
    });
    expect(r.accepted).toBe(false);
    expect(r.counts.textHashOverlap).toBe(1);
  });

  it("rejects a text repeated within the new holdout", () => {
    const r = check({
      newRows: [...fresh, row("b3", "новый текст про  дрон.")],
      newSource: SOURCE,
      consumedRows: consumed,
    });
    expect(r.accepted).toBe(false);
    expect(r.counts.duplicateTextsInNew).toBe(1);
  });

  it("rejects a module that imports, re-exports or requires anything", () => {
    for (const source of [
      'import { X } from "./language-detect-holdout";\nexport const LANGUAGE_DETECT_HOLDOUT = X;',
      'export { LANGUAGE_DETECT_HOLDOUT } from "./language-detect-holdout";',
      'export * from "./language-detect-holdout";',
      "export const LANGUAGE_DETECT_HOLDOUT = (await import('./x')).rows;",
      "export const LANGUAGE_DETECT_HOLDOUT = require('./x');",
    ]) {
      const r = check({ newRows: fresh, newSource: source, consumedRows: consumed });
      expect(r.accepted, source).toBe(false);
      expect(r.reasons, source).toContain(
        "new holdout module imports, re-exports or requires another module",
      );
    }
  });

  it("fails safe when either set or the source cannot be read or verified", () => {
    for (const input of [
      { newRows: undefined, newSource: SOURCE, consumedRows: consumed },
      { newRows: [], newSource: SOURCE, consumedRows: consumed },
      { newRows: [{ id: "x" }], newSource: SOURCE, consumedRows: consumed },
      { newRows: fresh, newSource: SOURCE, consumedRows: undefined },
      { newRows: fresh, newSource: SOURCE, consumedRows: [] },
      { newRows: fresh, newSource: undefined, consumedRows: consumed },
      { newRows: fresh, newSource: "", consumedRows: consumed },
    ]) {
      expect(check(input).accepted, JSON.stringify(input)).toBe(false);
    }
  });

  it("never puts a text into its reasons", () => {
    const secret = "Секретный текст строки";
    const r = check({
      newRows: [row("a1", secret), row("b9", secret)],
      newSource: SOURCE,
      consumedRows: [row("a1", secret)],
    });
    expect(r.accepted).toBe(false);
    expect(JSON.stringify(r)).not.toContain("Секретный");
  });
});
