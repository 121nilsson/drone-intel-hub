import { describe, expect, it } from "vitest";
import {
  compileRuleSnapshot,
  emptySnapshot,
  setActiveRuleSnapshot,
} from "@/shared/contracts/rules";
import { HeuristicExtractor, resolveSystems } from "@/shared/infra/heuristic-ai";
import type { Drone } from "@/entities/drone/types";

const drone = (over: Partial<Drone> & { id: string; name: string }): Drone =>
  ({ aliases: [], specs: [], ...over }) as unknown as Drone;

describe("heuristic rule lineage", () => {
  it("a dynamic cue that fills a spec leaves its id on the spec", async () => {
    const rules = compileRuleSnapshot(
      [{ id: "cue-reach", kind: "add_cue", payload: { target: "range", terms: ["reach of"] } }],
      3,
    );
    setActiveRuleSnapshot(emptySnapshot());
    const x = await new HeuristicExtractor(1).extract(
      "The UAV has a reach of 120 km.",
      [],
      undefined,
      {
        rules,
      },
    );
    expect(x.specs.find((s) => s.key === "range")?.ruleIds).toEqual(["cue-reach"]);
  });

  it("reports how a name hit and an alias hit were matched", () => {
    const lancet = drone({ id: "lancet-3", name: "Lancet-3", aliases: ["Izdeliye 52"] });
    expect(resolveSystems("A Lancet-3 struck.", [lancet])).toContainEqual({
      name: "Lancet-3",
      matchId: "lancet-3",
      matchedVia: "name",
    });
    expect(resolveSystems("An Izdeliye 52 struck.", [lancet])).toContainEqual({
      name: "Izdeliye 52",
      matchId: "lancet-3",
      matchedVia: "alias",
    });
  });

  it("reports an alias the rule snapshot added as rule_alias", () => {
    const lancet = drone({ id: "lancet-3", name: "Lancet-3", aliases: ["Izdeliye 52"] });
    const ruleAliases = new Map([["lancet-3", ["Izdeliye 52"]]]);
    expect(
      resolveSystems("An Izdeliye 52 struck.", [lancet], undefined, ruleAliases),
    ).toContainEqual({ name: "Izdeliye 52", matchId: "lancet-3", matchedVia: "rule_alias" });
  });
});
