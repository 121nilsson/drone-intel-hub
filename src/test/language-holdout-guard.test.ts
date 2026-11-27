import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LANGUAGE_DETECTOR_VERSION } from "@/entities/normalization/language";
import {
  LANGUAGE_HOLDOUTS,
  holdoutFixtureFor,
  holdoutModuleSpecifier,
  holdoutRunRefusal,
  runHoldoutEvaluation,
  type LanguageHoldoutRecord,
} from "@/entities/normalization/language-holdout";

// These tests never load a real holdout: `importModule` is a stub that records the specifiers it
// is asked for and returns a marker instead of rows.
const V1_FIXTURE = "language-detect-holdout";
const V1_SPECIFIER = holdoutModuleSpecifier(V1_FIXTURE);

function stubImport() {
  const calls: string[] = [];
  const importModule = async (specifier: string) => {
    calls.push(specifier);
    return specifier;
  };
  return { importModule, calls };
}

const v1Consumed = LANGUAGE_HOLDOUTS.get("v1")!;
const registryWith = (v2: LanguageHoldoutRecord) =>
  new Map<string, LanguageHoldoutRecord>([
    ["v1", v1Consumed],
    ["v2", v2],
  ]);
const v2 = { fixture: "language-detect-holdout-v2", evaluatedWith: LANGUAGE_DETECTOR_VERSION };

async function runV2(registry: ReadonlyMap<string, LanguageHoldoutRecord>) {
  const { importModule, calls } = stubImport();
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
  it("records holdout v1 as consumed by detector 3.0.0", () => {
    expect(v1Consumed).toEqual({
      fixture: V1_FIXTURE,
      evaluatedWith: "3.0.0",
      consumedOn: "2026-11-27",
    });
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

describe("holdout identity: id → fixture → module (Q1, T1, T5)", () => {
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
    expect(holdoutModuleSpecifier("language-detect-holdout-v2")).toBe(
      "../src/test/fixtures/language-detect-holdout-v2.ts",
    );
  });

  it("every committed record names exactly the fixture derived from its id", () => {
    for (const [id, h] of LANGUAGE_HOLDOUTS) expect(h.fixture, id).toBe(holdoutFixtureFor(id));
  });

  it("imports exactly v2's derived module, never v1's", async () => {
    const { r, calls, evaluated } = await runV2(registryWith(v2));
    expect(r).toEqual({
      ran: true,
      fixture: "language-detect-holdout-v2",
      specifier: "../src/test/fixtures/language-detect-holdout-v2.ts",
    });
    expect(calls).toEqual(["../src/test/fixtures/language-detect-holdout-v2.ts"]);
    expect(calls).not.toContain(V1_SPECIFIER);
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

  it("refuses v2 when another id names the same fixture", async () => {
    const registry = new Map<string, LanguageHoldoutRecord>([
      ["v1", v1Consumed],
      ["v2", v2],
      ["v3", { ...v2 }], // wrong: v3 must be -v3; refused for v3, and v2 sees the duplicate
    ]);
    const { r, calls } = await runV2(registry);
    expect(r).toEqual({
      ran: false,
      refusal: expect.stringMatching(/also registered as holdout v3; one fixture, one holdout/),
    });
    expect(calls).toEqual([]);
  });

  it("turns a failed or empty import into a refusal, without evaluating", async () => {
    for (const importModule of [
      async () => {
        throw new Error("Cannot find module");
      },
      async () => undefined,
    ]) {
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
      expect(r.ran).toBe(false);
      expect(evaluated).toBe(false);
    }
  });

  it("the evaluation script has no holdout path of its own: it imports only the guard's specifier", () => {
    // Reads the script as text; never imports it (it would run) and never touches a holdout.
    const source = readFileSync(resolve("scripts/evaluate-language-holdout.ts"), "utf8");
    expect(source).not.toMatch(/language-detect-holdout/);
    expect(source).not.toMatch(/import\s*\(\s*["'`]/);
    expect(source.match(/import\s*\(/g)).toHaveLength(1);
    expect(source).toMatch(/import\(new URL\(specifier, import\.meta\.url\)\.href\)/);
    expect(source).not.toMatch(/registry\s*:/);
  });
});
