import { describe, expect, it } from "vitest";
import { claimsByRuleAlias, replayTargets } from "@/entities/drone/claim-lineage";
import type { Drone, SpecClaim } from "@/entities/drone/types";

const drone = (id: string, claims: Partial<SpecClaim>[]): Drone =>
  ({
    id,
    name: id,
    aliases: [],
    specs: [{ key: "range", label: "Range", value: 1, unit: "km", claims: claims.map(claim) }],
  }) as unknown as Drone;

let n = 0;
const claim = (over: Partial<SpecClaim>): SpecClaim =>
  ({ id: `c${++n}`, value: 1, source: "Outlet", date: "2026-01-01", ...over }) as SpecClaim;

const cueShaped = (sourceId?: string) => ({
  ...(sourceId ? { sourceId } : {}),
  lineage: { ruleIds: ["cue-reach"] },
});
const aliasShaped = (matchedName: string, sourceId?: string) => ({
  ...(sourceId ? { sourceId } : {}),
  lineage: { matchedVia: "rule_alias" as const, matchedName },
});

describe("claimsByRuleAlias", () => {
  it("finds the claims a rule alias matched, case-insensitively and ignoring spaces", () => {
    const d = drone("d1", [aliasShaped("  Ghost Hawk ", "p1"), aliasShaped("ghost hawk", "p2")]);
    expect(claimsByRuleAlias([d], "d1", ["GHOST HAWK"])).toHaveLength(2);
  });

  it("ignores a claim matched through the catalogue's own alias, even with the same string", () => {
    const d = drone("d1", [
      { sourceId: "p1", lineage: { matchedVia: "alias", matchedName: "Ghost Hawk" } },
      { sourceId: "p2", lineage: { matchedVia: "name", matchedName: "Ghost Hawk" } },
    ]);
    expect(claimsByRuleAlias([d], "d1", ["Ghost Hawk"])).toEqual([]);
  });

  it("only looks at the named drone", () => {
    const d = drone("d1", [aliasShaped("Ghost Hawk", "p1")]);
    expect(claimsByRuleAlias([d], "d2", ["Ghost Hawk"])).toEqual([]);
  });

  it("returns nothing for no aliases or a blank one", () => {
    const d = drone("d1", [{ lineage: { matchedVia: "rule_alias", matchedName: "" } }]);
    expect(claimsByRuleAlias([d], "d1", [])).toEqual([]);
    expect(claimsByRuleAlias([d], "d1", ["  "])).toEqual([]);
  });
});

describe("replayTargets", () => {
  it("collects the posts a cue rule shaped, each once", () => {
    const a = drone("d1", [cueShaped("p1"), cueShaped("p1"), cueShaped("p2")]);
    const b = drone("d2", [cueShaped("p2")]);
    const out = replayTargets([a, b], { ruleId: "cue-reach" });
    expect(out.dispatchIds.sort()).toEqual(["p1", "p2"]);
    expect(out.claimIds).toHaveLength(4);
  });

  it("skips a claim without a sourceId: it cannot be re-read from a post", () => {
    const d = drone("d1", [cueShaped(), cueShaped("p1")]);
    const out = replayTargets([d], { ruleId: "cue-reach" });
    expect(out.dispatchIds).toEqual(["p1"]);
    expect(out.claimIds).toHaveLength(1);
  });

  it("replays an alias rule through its drone and alias terms only", () => {
    const d = drone("d1", [
      aliasShaped("Ghost Hawk", "p1"),
      { sourceId: "p9", lineage: { matchedVia: "alias", matchedName: "Ghost Hawk" } },
    ]);
    const out = replayTargets([d], {
      ruleId: "alias-ghost",
      alias: { droneId: "d1", aliases: ["Ghost Hawk"] },
    });
    expect(out.dispatchIds).toEqual(["p1"]);
  });

  it("returns nothing for a rule that shaped no claim", () => {
    const d = drone("d1", [cueShaped("p1")]);
    expect(replayTargets([d], { ruleId: "unknown" })).toEqual({ claimIds: [], dispatchIds: [] });
  });
});
