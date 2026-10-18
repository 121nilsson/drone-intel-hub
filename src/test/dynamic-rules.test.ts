import { describe, expect, it, beforeEach } from "vitest";
import {
  compileRuleSnapshot,
  emptySnapshot,
  setActiveRuleSnapshot,
} from "@/shared/contracts/rules";
import {
  getOrRefreshRuleSnapshot,
  resetRuleRegistry,
} from "@/shared/infra/heuristics/rule-registry.server";
import { HeuristicExtractor } from "@/shared/infra/heuristic-ai";
import type { Drone } from "@/entities/drone/types";

const drone = { id: "d-lancet", name: "Lancet-3", aliases: [], specs: [] } as unknown as Drone;

beforeEach(() => {
  resetRuleRegistry();
  setActiveRuleSnapshot(emptySnapshot());
});

describe("dynamic rules phase 1", () => {
  it("an active alias rule matches the catalog drone", async () => {
    const rules = compileRuleSnapshot(
      [{ id: "r1", kind: "add_alias", payload: { droneId: "d-lancet", alias: "Izdeliye 52" } }],
      2,
    );
    const x = await new HeuristicExtractor(1, rules).extract("Izdeliye 52 struck a howitzer.", [
      drone,
    ]);
    expect(x.matchId).toBe("d-lancet");
  });

  it("an alias for a deleted drone is ignored", async () => {
    const rules = compileRuleSnapshot(
      [{ id: "r1", kind: "add_alias", payload: { droneId: "gone", alias: "Izdeliye 52" } }],
      2,
    );
    const x = await new HeuristicExtractor(1, rules).extract("Izdeliye 52 struck.", [drone]);
    expect(x.matchId).toBeUndefined();
  });

  it("a stopword rule suppresses a false system name", async () => {
    const text = "ZALA reported SPARTA deployment near the front.";
    const before = await new HeuristicExtractor(1).extract(text, []);
    expect(before.systems?.some((s) => s.name === "SPARTA")).toBe(true);
    const rules = compileRuleSnapshot(
      [{ id: "s", kind: "add_stopword", payload: { word: "SPARTA" } }],
      2,
    );
    const after = await new HeuristicExtractor(1).extract(text, [], undefined, { rules });
    expect(after.systems?.some((s) => s.name === "SPARTA")).toBe(false);
  });

  it("registry never throws and keeps the last good snapshot", async () => {
    await getOrRefreshRuleSnapshot({
      force: true,
      loader: async () => ({
        version: 3,
        rows: [{ id: "s", kind: "add_stopword", payload: { word: "foo" } }],
      }),
    });
    const s = await getOrRefreshRuleSnapshot({
      force: true,
      loader: async () => {
        throw new Error("db down");
      },
    });
    expect(s.version).toBe(3);
    expect(s.stopwords.has("foo")).toBe(true);
  });

  it("malformed and unsupported rows are skipped, not thrown", () => {
    const s = compileRuleSnapshot([
      { id: "a", kind: "add_alias", payload: null },
      { id: "b", kind: "add_cue", payload: { word: "x" } },
    ]);
    expect(s.aliases.size).toBe(0);
    expect(s.unsupported).toBe(1);
  });
});
