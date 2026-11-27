import { describe, expect, it } from "vitest";
import { LANGUAGE_DETECTOR_VERSION } from "@/entities/normalization/language";
import {
  LANGUAGE_HOLDOUTS,
  holdoutRunRefusal,
  runHoldoutEvaluation,
} from "@/entities/normalization/language-holdout";

// These tests never load a holdout: the loader is a stub that fails the test if it is called.
const mustNotLoad = async (): Promise<never> => {
  throw new Error("holdout was loaded");
};

describe("holdout evaluation guard (R5)", () => {
  it("records holdout v1 as consumed by detector 3.0.0", () => {
    expect(LANGUAGE_HOLDOUTS.get("v1")).toEqual({
      fixture: "language-detect-holdout",
      evaluatedWith: "3.0.0",
      consumedOn: "2026-11-27",
    });
  });

  it("refuses to run the consumed v1 with the current detector, before loading it", async () => {
    expect(LANGUAGE_DETECTOR_VERSION).not.toBe("3.0.0");
    let evaluated = false;
    const r = await runHoldoutEvaluation({
      holdoutId: "v1",
      detectorVersion: LANGUAGE_DETECTOR_VERSION,
      load: mustNotLoad,
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
    expect(evaluated).toBe(false);
  });

  it("refuses the consumed v1 even with the version it was evaluated with", async () => {
    const r = await runHoldoutEvaluation({
      holdoutId: "v1",
      detectorVersion: "3.0.0",
      load: mustNotLoad,
      evaluate: () => undefined,
    });
    expect(r.ran).toBe(false);
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
