import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LANGUAGE_DETECTOR_VERSION } from "@/entities/normalization/language";
import {
  LANGUAGE_HOLDOUTS,
  holdoutFixtureFor,
  holdoutModuleSpecifier,
  holdoutRowsOf,
  holdoutRunRefusal,
  runHoldoutEvaluation,
  type LanguageHoldoutRecord,
} from "@/entities/normalization/language-holdout";

// These tests never load a real holdout: `importModule` is a stub that records the specifiers it
// is asked for and returns one fake row per call instead of a holdout.
const V1_FIXTURE = "language-detect-holdout";
const V1_SPECIFIER = holdoutModuleSpecifier(V1_FIXTURE);
const V2_SPECIFIER = "../src/test/fixtures/language-detect-holdout-v2.ts";
const FAKE_ROW = { id: "x", category: "c", text: "t", allowedDecisive: null };

function stubImport(rows: readonly unknown[] = [FAKE_ROW]) {
  const calls: string[] = [];
  const importModule = async (specifier: string) => {
    calls.push(specifier);
    return rows;
  };
  return { importModule, calls };
}

const v1Consumed = LANGUAGE_HOLDOUTS["v1"]!;
const registryWith = (v2: LanguageHoldoutRecord) =>
  new Map<string, LanguageHoldoutRecord>([
    ["v1", v1Consumed],
    ["v2", v2],
  ]);
const v2 = { fixture: "language-detect-holdout-v2", evaluatedWith: LANGUAGE_DETECTOR_VERSION };

async function runV2(
  registry: ReadonlyMap<string, LanguageHoldoutRecord>,
  rows: readonly unknown[] = [FAKE_ROW],
) {
  const { importModule, calls } = stubImport(rows);
  let evaluated = false;
  const r = await runHoldoutEvaluation({
    holdoutId: "v2",
    detectorVersion: LANGUAGE_DETECTOR_VERSION,
    importModule,
    registry,
    evaluate: () => {
      evaluated = true;
    },
  });
  return { r, calls, evaluated };
}

describe("holdout evaluation guard (R5)", () => {
  it("records v1 as consumed by 3.0.0 and v2 as consumed by 3.1.0, and nothing else", () => {
    expect(LANGUAGE_HOLDOUTS).toEqual({
      v1: { fixture: V1_FIXTURE, evaluatedWith: "3.0.0", consumedOn: "2026-11-27" },
      v2: {
        fixture: "language-detect-holdout-v2",
        evaluatedWith: "3.1.0",
        consumedOn: "2026-11-27",
      },
    });
  });

  it("refuses a second run of v2 under every version, the one it was evaluated with included", () => {
    for (const version of ["3.1.0", "3.0.0", "3.2.0", LANGUAGE_DETECTOR_VERSION]) {
      expect(holdoutRunRefusal("v2", version), version).toMatch(
        /holdout v2 was consumed on 2026-11-27 by detector 3\.1\.0; a new run is not approval evidence/,
      );
    }
  });

  it("refuses to run the consumed v1 with the current detector, before importing it", async () => {
    expect(LANGUAGE_DETECTOR_VERSION).not.toBe("3.0.0");
    const { importModule, calls } = stubImport();
    let evaluated = false;
    const r = await runHoldoutEvaluation({
      holdoutId: "v1",
      detectorVersion: LANGUAGE_DETECTOR_VERSION,
      importModule,
      evaluate: () => {
        evaluated = true;
      },
    });
    expect(r).toEqual({
      ran: false,
      refusal: expect.stringMatching(
        new RegExp(`consumed.*not approval evidence.*${LANGUAGE_DETECTOR_VERSION}`),
      ),
    });
    expect(calls).toEqual([]);
    expect(evaluated).toBe(false);
  });

  it("refuses the consumed v1 even with the version it was evaluated with", async () => {
    const { importModule, calls } = stubImport();
    const r = await runHoldoutEvaluation({
      holdoutId: "v1",
      detectorVersion: "3.0.0",
      importModule,
      evaluate: () => undefined,
    });
    expect(r.ran).toBe(false);
    expect(calls).toEqual([]);
  });

  it("allows an unconsumed holdout only with the version it is reserved for", () => {
    const registry = registryWith({ ...v2, evaluatedWith: "9.9.9" });
    expect(holdoutRunRefusal("v2", "9.9.9", registry)).toBeUndefined();
    expect(holdoutRunRefusal("v2", "9.9.8", registry)).toMatch(/reserved for detector 9\.9\.9/);
  });

  it("refuses an unknown holdout id", () => {
    expect(holdoutRunRefusal("v9", LANGUAGE_DETECTOR_VERSION)).toMatch(/unknown holdout/);
  });
});

describe("holdout identity: id → fixture → module (Q1, T1, T5, U1)", () => {
  it("derives the one fixture name of an id, and nothing for an id of any other form", () => {
    expect(holdoutFixtureFor("v1")).toBe(V1_FIXTURE);
    expect(holdoutFixtureFor("v2")).toBe("language-detect-holdout-v2");
    expect(holdoutFixtureFor("v10")).toBe("language-detect-holdout-v10");
    for (const bad of [
      "",
      "v",
      "v0",
      "v01",
      "V2",
      "v2 ",
      " v2",
      "v2.0",
      "v-2",
      "2",
      "v2/x",
      "../v1",
    ]) {
      expect(holdoutFixtureFor(bad), JSON.stringify(bad)).toBeUndefined();
      expect(holdoutRunRefusal(bad, LANGUAGE_DETECTOR_VERSION)).toMatch(/invalid holdout id/);
    }
  });

  it("derives the module specifier from the fixture name only", () => {
    expect(V1_SPECIFIER).toBe("../src/test/fixtures/language-detect-holdout.ts");
    expect(holdoutModuleSpecifier("language-detect-holdout-v2")).toBe(V2_SPECIFIER);
  });

  it("every committed record names exactly the fixture derived from its id", () => {
    for (const [id, h] of Object.entries(LANGUAGE_HOLDOUTS)) {
      expect(h.fixture, id).toBe(holdoutFixtureFor(id));
    }
  });

  it("imports exactly v2's derived module, never v1's", async () => {
    const { r, calls, evaluated } = await runV2(registryWith(v2));
    expect(r).toEqual({
      ran: true,
      fixture: "language-detect-holdout-v2",
      specifier: V2_SPECIFIER,
    });
    expect(calls).toEqual([V2_SPECIFIER]);
    expect(evaluated).toBe(true);
  });

  it("never imports anything when v2's registry record is wrong, including every v1 spelling", async () => {
    const wrongFixtures = [
      V1_FIXTURE, // wrong coupling: v2 pointing at the consumed v1
      "language-detect-holdout.ts",
      "./language-detect-holdout",
      "../fixtures/language-detect-holdout",
      "Language-Detect-Holdout",
      "language-detect-holdout ",
      "language-detect-holdout-v1",
      "language-detect-holdout-v3", // another id's name
      "language-detect-holdout-v2.ts",
      "language-detect-holdout-V2",
      "",
    ];
    for (const fixture of wrongFixtures) {
      const { r, calls, evaluated } = await runV2(registryWith({ ...v2, fixture }));
      expect(r, JSON.stringify(fixture)).toEqual({
        ran: false,
        refusal: expect.stringMatching(/its fixture must be "language-detect-holdout-v2"/),
      });
      expect(calls, JSON.stringify(fixture)).toEqual([]);
      expect(evaluated).toBe(false);
    }
  });

  it("imports only the id-derived module even if the record changes between reads (U1)", async () => {
    // A record whose fixture answers correctly on the first read and with v1 or an outside path
    // afterwards: the guard reads it once, and the specifier is built from the id, not re-read.
    for (const later of [V1_FIXTURE, "../../../../outside/evil"]) {
      let reads = 0;
      const flipping = {
        evaluatedWith: LANGUAGE_DETECTOR_VERSION,
        get fixture() {
          reads++;
          return reads === 1 ? "language-detect-holdout-v2" : later;
        },
      } as LanguageHoldoutRecord;
      const { r, calls } = await runV2(registryWith(flipping));
      expect(r).toMatchObject({ ran: true, specifier: V2_SPECIFIER });
      expect(calls).toEqual([V2_SPECIFIER]);
      expect(reads).toBe(1);
    }
  });

  it("reads a registry whose get() is stateful only once, by iteration (U1, U5)", async () => {
    class Shifty extends Map<string, LanguageHoldoutRecord> {
      override get(key: string) {
        return key === "v2" ? { ...v2, fixture: V1_FIXTURE } : super.get(key);
      }
    }
    const { r, calls } = await runV2(new Shifty(registryWith(v2)));
    expect(r).toMatchObject({ ran: true, specifier: V2_SPECIFIER });
    expect(calls).toEqual([V2_SPECIFIER]);
  });

  it("refuses v2 when another id names the same fixture", async () => {
    const registry = new Map<string, LanguageHoldoutRecord>([
      ["v1", v1Consumed],
      ["v2", v2],
      ["v3", { ...v2 }],
    ]);
    const { r, calls } = await runV2(registry);
    expect(r).toEqual({
      ran: false,
      refusal: expect.stringMatching(/also registered as holdout v3; one fixture, one holdout/),
    });
    expect(calls).toEqual([]);
  });

  it("turns a failed, missing or empty import into a refusal, without evaluating (U2)", async () => {
    const cases: [string, () => Promise<readonly unknown[] | undefined>, RegExp][] = [
      [
        "throws",
        async () => {
          throw new Error("Cannot find module");
        },
        /cannot import/,
      ],
      ["undefined", async () => undefined, /does not export valid/],
      ["empty", async () => [], /exports no rows/],
    ];
    for (const [name, importModule, message] of cases) {
      let evaluated = false;
      const r = await runHoldoutEvaluation({
        holdoutId: "v2",
        detectorVersion: LANGUAGE_DETECTOR_VERSION,
        importModule,
        registry: registryWith(v2),
        evaluate: () => {
          evaluated = true;
        },
      });
      expect(r, name).toEqual({ ran: false, refusal: expect.stringMatching(message) });
      expect(evaluated, name).toBe(false);
    }
  });

  it("accepts only arrays of well-formed rows (U2)", () => {
    expect(holdoutRowsOf([FAKE_ROW, { ...FAKE_ROW, id: "y", allowedDecisive: "uk" }])).toHaveLength(
      2,
    );
    expect(holdoutRowsOf([])).toEqual([]); // empty is refused by runHoldoutEvaluation
    for (const bad of [
      undefined,
      null,
      {},
      "rows",
      [null],
      [{ ...FAKE_ROW, id: 1 }],
      [{ ...FAKE_ROW, text: undefined }],
      [{ ...FAKE_ROW, category: null }],
      [{ ...FAKE_ROW, allowedDecisive: "be" }],
      [FAKE_ROW, "x"],
      // V3: duplicate ids, blank fields
      [FAKE_ROW, { ...FAKE_ROW, text: "other" }],
      [{ ...FAKE_ROW, text: "" }],
      [{ ...FAKE_ROW, text: "   " }],
      [{ ...FAKE_ROW, category: "" }],
      [{ ...FAKE_ROW, id: " " }],
    ]) {
      expect(holdoutRowsOf(bad), JSON.stringify(bad)).toBeUndefined();
    }
    // A sparse array (a hole is not a row).
    const sparse: unknown[] = [FAKE_ROW];
    sparse[2] = { ...FAKE_ROW, id: "y" };
    expect(holdoutRowsOf(sparse)).toBeUndefined();
  });

  it("evaluates a frozen plain copy: a getter-backed row is read once (V3)", () => {
    let reads = 0;
    const row = {
      id: "g",
      category: "c",
      allowedDecisive: null,
      get text() {
        reads++;
        return reads === 1 ? "validated" : "";
      },
    };
    const rows = holdoutRowsOf([row])!;
    expect(rows[0]).toEqual({ id: "g", category: "c", text: "validated", allowedDecisive: null });
    expect(rows[0]!.text).toBe("validated");
    expect(reads).toBe(1);
    expect(Object.isFrozen(rows)).toBe(true);
    expect(Object.isFrozen(rows[0])).toBe(true);
  });
});

describe("registry immutability and the test seam (T6, U5)", () => {
  it("the committed registry is deeply frozen and cannot be changed at run time", () => {
    expect(Object.isFrozen(LANGUAGE_HOLDOUTS)).toBe(true);
    expect(Object.isFrozen(LANGUAGE_HOLDOUTS["v1"])).toBe(true);
    const r = LANGUAGE_HOLDOUTS as Record<string, LanguageHoldoutRecord>;
    expect(() => {
      r["v2"] = v2;
    }).toThrow(TypeError);
    expect(() => {
      delete (r["v1"] as { consumedOn?: string }).consumedOn;
    }).toThrow(TypeError);
    expect(holdoutRunRefusal("v1", "3.0.0")).toMatch(/consumed/);
  });

  it("the evaluation script has no holdout path and never uses the test seam", () => {
    // Reads the script as text; never imports it (it would run) and never touches a holdout.
    const source = readFileSync(resolve("scripts/evaluate-language-holdout.ts"), "utf8");
    expect(source).not.toMatch(/language-detect-holdout/);
    expect(source).not.toMatch(/import\s*\(\s*["'`]/);
    expect(source.match(/import\s*\(/g)).toHaveLength(1);
    expect(source).toMatch(/import\(new URL\(specifier, import\.meta\.url\)\.href\)/);
    expect(source).not.toMatch(/\bregistry\b/);
    expect(source).not.toMatch(/LANGUAGE_HOLDOUTS/);
  });
});
