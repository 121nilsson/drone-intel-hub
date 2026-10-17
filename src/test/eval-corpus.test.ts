import { describe, expect, it } from "vitest";
import corpus from "./fixtures/eval-corpus.json";
import { HeuristicExtractor } from "@/shared/infra/heuristic-ai";
import { checkFixture, type EvalFixture } from "@/features/evaluation/evaluation";

/**
 * Auto-generated regression corpus: exported from /evaluation ("Download corpus").
 * Each entry is a real report where the heuristic agreed with the stored extraction;
 * a later heuristic change must keep producing those values.
 */
const fixtures = corpus as EvalFixture[];
const heuristic = new HeuristicExtractor(1);

describe("eval corpus regressions", () => {
  if (fixtures.length === 0) it.skip("corpus is empty — export from /evaluation", () => {});
  for (const fx of fixtures) {
    it(`${fx.source} (${fx.id.slice(0, 8)})`, async () => {
      const r = await checkFixture(fx, heuristic);
      expect(r.missing).toEqual([]);
      expect(r.missingNames).toEqual([]);
    });
  }
});
