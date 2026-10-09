import { describe, expect, it } from "vitest";
import { parseMagnitude, parseNumber, parseRange } from "@/entities/normalization/numeric";
import { parseMoney } from "@/entities/normalization/currency";
import { normalizeRF, parseFrequencies } from "@/entities/normalization/rf";
import { semanticKeyFor } from "@/entities/normalization/semantic";
import { normalizeQuantity } from "@/entities/normalization/units";
import {
  FREQUENCIES,
  MAGNITUDES,
  MONEY,
  NUMBERS,
  QUANTITIES,
  RANGES,
  RF,
  SEMANTICS,
} from "./fixtures/normalization-corpus";

/**
 * Data-driven runner over the fixture corpus. There is deliberately no logic
 * here beyond "run every fixture and assert its expected result": all the
 * interesting cases live as data in normalization-corpus.ts so that adding a
 * regression case never means writing new test code.
 *
 * A fixture with `expected: undefined` pins a KNOWN GAP. If a parser change
 * makes one of those start parsing, update the corpus entry in the same commit
 * and drop the PINNED GAP note — do not delete the fixture.
 */

const fmt = (s: string) => JSON.stringify(s);

describe("fixture corpus: parseNumber", () => {
  for (const { raw, expected, note } of NUMBERS) {
    it(`${fmt(raw)} → ${String(expected)}${note ? ` (${note})` : ""}`, () => {
      expect(parseNumber(raw)).toBe(expected);
    });
  }
});

describe("fixture corpus: parseMagnitude", () => {
  for (const { raw, expected, note } of MAGNITUDES) {
    it(`${fmt(raw)} → ${String(expected)}${note ? ` (${note})` : ""}`, () => {
      expect(parseMagnitude(raw)).toBe(expected);
    });
  }
});

describe("fixture corpus: parseRange", () => {
  for (const { raw, expected, note } of RANGES) {
    it(`${fmt(raw)}${note ? ` (${note})` : ""}`, () => {
      expect(parseRange(raw)).toEqual(expected);
    });
  }
});

describe("fixture corpus: normalizeQuantity", () => {
  for (const { raw, expected, note } of QUANTITIES) {
    it(`${fmt(raw)}${note ? ` (${note})` : ""}`, () => {
      const got = normalizeQuantity(raw);
      if (expected === undefined) {
        expect(got).toBeUndefined();
        return;
      }
      expect(got).toBeDefined();
      if (expected.value !== undefined) expect(got?.value).toBe(expected.value);
      if (expected.unit !== undefined) expect(got?.unit).toBe(expected.unit);
      if (expected.canonicalUnit !== undefined) expect(got?.canonicalUnit).toBe(expected.canonicalUnit);
      if (expected.canonicalValue !== undefined) expect(got?.canonicalValue).toBeCloseTo(expected.canonicalValue, 4);
      // A fixture that expects a bound/range must not accidentally get a point value.
      if (expected.canonicalValue === undefined && expected.range !== undefined) {
        expect(got?.canonicalValue).toBeUndefined();
      }
      if (expected.range !== undefined) {
        expect(got?.range?.qualifier).toBe(expected.range.qualifier);
        if (expected.range.min !== undefined) expect(got?.range?.min).toBeCloseTo(expected.range.min, 4);
        if (expected.range.max !== undefined) expect(got?.range?.max).toBeCloseTo(expected.range.max, 4);
        if (expected.range.value !== undefined) expect(got?.range?.value).toBeCloseTo(expected.range.value, 4);
      }
      if (expected.confidence !== undefined) expect(got?.confidence).toBe(expected.confidence);
    });
  }
});

describe("fixture corpus: parseMoney", () => {
  for (const { raw, expected, note } of MONEY) {
    it(`${fmt(raw)}${note ? ` (${note})` : ""}`, () => {
      const got = parseMoney(raw);
      if (expected === undefined) {
        expect(got).toBeUndefined();
        return;
      }
      expect(got?.amount).toBe(expected.amount);
      expect(got?.currency).toBe(expected.currency);
    });
  }
});

describe("fixture corpus: parseFrequencies", () => {
  for (const { raw, expected, note } of FREQUENCIES) {
    it(`${fmt(raw)}${note ? ` (${note})` : ""}`, () => {
      expect(parseFrequencies(raw)).toEqual(expected);
    });
  }
});

describe("fixture corpus: normalizeRF", () => {
  for (const { raw, expected, note } of RF) {
    it(`${fmt(raw)}${note ? ` (${note})` : ""}`, () => {
      const got = normalizeRF(raw);
      expect(got).toBeDefined();
      if (expected.role !== undefined) expect(got.role).toBe(expected.role);
      if (expected.freqMHz !== undefined) expect(got.freqMHz).toEqual(expected.freqMHz);
      if (expected.ieeeBands !== undefined) expect(got.ieeeBands).toEqual(expected.ieeeBands);
      if (expected.natoBands !== undefined) expect(got.natoBands).toEqual(expected.natoBands);
      if (expected.protocols !== undefined) expect(got.protocols).toEqual(expected.protocols);
      if (expected.tacticalTag !== undefined) expect(got.tacticalTag).toBe(expected.tacticalTag);
      if (expected.isFiberOptic !== undefined) expect(got.isFiberOptic).toBe(expected.isFiberOptic);
      if (expected.confidence !== undefined) expect(got.confidence).toBeCloseTo(expected.confidence, 2);
    });
  }
});

describe("fixture corpus: semanticKeyFor", () => {
  for (const { key, label, expected, note } of SEMANTICS) {
    it(`${fmt(key)} / ${fmt(label ?? "")} → ${expected}${note ? ` (${note})` : ""}`, () => {
      expect(semanticKeyFor(key, label)).toBe(expected);
    });
  }
});
