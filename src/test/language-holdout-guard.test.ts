import { describe, expect, it } from "vitest";
import { LANGUAGE_DETECTOR_VERSION } from "@/entities/normalization/language";
import {
  LANGUAGE_HOLDOUTS,
  holdoutRunRefusal,
  runHoldoutEvaluation,
  type LanguageHoldoutRecord,
} from "@/entities/normalization/language-holdout";

// These tests never load a real holdout: every loader is a stub that records its calls.
const V1_FIXTURE = "language-detect-holdout";

function stubLoaders(...fixtures: string[]) {
  const calls: string[] = [];
  const loaders = new Map(
    fixtures.map((f) => [
      f,
      async () => {
        calls.push(f);
        return f;
      },
    ]),
  );
  return { loaders, calls };
}

const v1Consumed = LANGUAGE_HOLDOUTS.get("v1")!;
const registryWith = (v2: LanguageHoldoutRecord) =>
  new Map<string, LanguageHoldoutRecord>([
    ["v1", v1Consumed],
    ["v2", v2],
  ]);

describe("holdout evaluation guard (R5)", () => {
  it("records holdout v1 as consumed by detector 3.0.0", () => {
    expect(v1Consumed).toEqual({
      fixture: V1_FIXTURE,
      evaluatedWith: "3.0.0",
      consumedOn: "2026-11-27",
    });
  });

  it("refuses to run the consumed v1 with the current detector, before loading it", async () => {
    expect(LANGUAGE_DETECTOR_VERSION).not.toBe("3.0.0");
    const { loaders, calls } = stubLoaders(V1_FIXTURE);
    let evaluated = false;
    const r = await runHoldoutEvaluation({
      holdoutId: "v1",
      detectorVersion: LANGUAGE_DETECTOR_VERSION,
      loaders,
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
    const { loaders, calls } = stubLoaders(V1_FIXTURE);
    const r = await runHoldoutEvaluation({
      holdoutId: "v1",
      detectorVersion: "3.0.0",
      loaders,
      evaluate: () => undefined,
    });
    expect(r.ran).toBe(false);
    expect(calls).toEqual([]);
  });

  it("allows an unconsumed holdout only with the version it is reserved for", () => {
    const registry = new Map([["v2", { fixture: "x", evaluatedWith: "9.9.9" }]]);
    expect(holdoutRunRefusal("v2", "9.9.9", registry)).toBeUndefined();
    expect(holdoutRunRefusal("v2", "9.9.8", registry)).toMatch(/reserved for detector 9\.9\.9/);
  });

  it("refuses an unknown holdout id", () => {
    expect(holdoutRunRefusal("v9", LANGUAGE_DETECTOR_VERSION)).toMatch(/unknown holdout/);
  });
});

describe("holdout fixture selection (Q1)", () => {
  const v2 = { fixture: "language-detect-holdout-v2", evaluatedWith: LANGUAGE_DETECTOR_VERSION };

  it("loads exactly the fixture the registry names for v2, never the v1 fixture", async () => {
    const { loaders, calls } = stubLoaders(V1_FIXTURE, v2.fixture);
    let seen: string | undefined;
    const r = await runHoldoutEvaluation({
      holdoutId: "v2",
      detectorVersion: LANGUAGE_DETECTOR_VERSION,
      loaders,
      registry: registryWith(v2),
      evaluate: (h) => {
        seen = h;
      },
    });
    expect(r).toEqual({ ran: true, fixture: v2.fixture });
    expect(calls).toEqual([v2.fixture]);
    expect(seen).toBe(v2.fixture);
  });

  it("refuses v2 when only the v1 loader exists, without calling any loader", async () => {
    const { loaders, calls } = stubLoaders(V1_FIXTURE);
    const r = await runHoldoutEvaluation({
      holdoutId: "v2",
      detectorVersion: LANGUAGE_DETECTOR_VERSION,
      loaders,
      registry: registryWith(v2),
      evaluate: () => undefined,
    });
    expect(r).toEqual({
      ran: false,
      refusal: expect.stringMatching(/no loader for fixture language-detect-holdout-v2/),
    });
    expect(calls).toEqual([]);
  });

  it("refuses a v2 that points at the consumed v1 fixture, without calling any loader", async () => {
    const { loaders, calls } = stubLoaders(V1_FIXTURE);
    const r = await runHoldoutEvaluation({
      holdoutId: "v2",
      detectorVersion: LANGUAGE_DETECTOR_VERSION,
      loaders,
      registry: registryWith({ ...v2, fixture: V1_FIXTURE }),
      evaluate: () => undefined,
    });
    expect(r).toEqual({
      ran: false,
      refusal: expect.stringMatching(/also registered as holdout v1 \(consumed on 2026-11-27\)/),
    });
    expect(calls).toEqual([]);
  });

  it("registers one fixture per holdout id", () => {
    const fixtures = [...LANGUAGE_HOLDOUTS.values()].map((h) => h.fixture);
    expect(new Set(fixtures).size).toBe(fixtures.length);
  });
});
