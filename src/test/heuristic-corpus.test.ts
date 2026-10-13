import { describe, expect, it } from "vitest";
import { HeuristicExtractor } from "@/shared/infra/heuristic-ai";
import { HEURISTIC_CORPUS } from "./fixtures/heuristic-corpus";

const t = new HeuristicExtractor(1);

describe("heuristic corpus", () => {
  for (const fixture of HEURISTIC_CORPUS) {
    it(`${fixture.lang}: ${fixture.name}`, async () => {
      const e = await t.extract(fixture.text, []);
      const keys = new Set(e.specs.map((s) => s.key));
      for (const key of fixture.expectedKeys) {
        expect(keys, `${fixture.name}: missing ${key}`).toContain(key);
      }
    });
  }
});
