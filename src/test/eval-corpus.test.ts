import { describe, expect, it } from "vitest";
import corpus from "./fixtures/eval-corpus.json";
import catalog from "./fixtures/eval-catalog.json";
import { HeuristicExtractor } from "@/shared/infra/heuristic-ai";
import { checkFixture, type EvalFixture } from "@/shared/infra/evaluation/evaluation";
import type { Drone } from "@/entities/drone/types";

const fixtures = corpus as EvalFixture[];
const drones = catalog as Drone[];
const heuristic = new HeuristicExtractor(1);

describe("eval corpus regressions", () => {
  if (fixtures.length === 0) it.skip("corpus is empty — export from /evaluation", () => {});
  for (const fx of fixtures) {
    it(`${fx.source} (${fx.id.slice(0, 8)})`, async () => {
      const r = await checkFixture(fx, heuristic, drones);
      expect(r.missing).toEqual([]);
      expect(r.missingNames).toEqual([]);
    });
  }
});
