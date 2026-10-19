import { describe, expect, it } from "vitest";
import { compileRuleSnapshot, type DynamicRuleRow } from "@/shared/contracts/rules";
import { HeuristicExtractor } from "@/shared/infra/heuristic-ai";
import { parseMoney } from "@/entities/normalization/currency";
import { runSandbox } from "@/features/evaluation/sandbox";
import type { Candidate, Extraction } from "@/entities/drone/types";

const grand: DynamicRuleRow = {
  id: "grand",
  kind: "add_unit_scale",
  payload: { unit: "grand", multiplier: 1000, dimension: "currency" },
};
const unitCost = async (text: string, rows: DynamicRuleRow[] = []) =>
  (await new HeuristicExtractor(1, compileRuleSnapshot(rows)).extract(text, [])).specs.find(
    (s) => s.key === "unit_cost",
  )?.value;

describe("add_unit_scale rules", () => {
  it("compiles a currency magnitude and rejects what the parser cannot honour", () => {
    const s = compileRuleSnapshot([
      grand,
      { id: "odd", kind: "add_unit_scale", payload: { unit: "lakh", multiplier: 1e5 } },
      {
        id: "dist",
        kind: "add_unit_scale",
        payload: { unit: "verst", multiplier: 1e3, dimension: "distance" },
      },
      { id: "regex", kind: "add_unit_scale", payload: { unit: "m+$", multiplier: 1e6 } },
    ]);
    expect(s.scales.map((x) => [x.word, x.multiplier])).toEqual([["grand", 1000]]);
    expect(s.invalid).toEqual(["odd", "dist", "regex"]);
    expect(s.unsupported).toBe(0);
  });

  it("reads a price with the rule's magnitude in the heuristic engine", async () => {
    const text = "The unit price is $40 grand, the ministry said.";
    expect(await unitCost(text)).toBe(40);
    expect(await unitCost(text, [grand])).toBe(40_000);
  });

  it("parses a magnitude in another script", async () => {
    const lyam = { id: "l", kind: "add_unit_scale", payload: { unit: "лям", multiplier: 1e6 } };
    const text = "Цена за единицу: 3 лям рублей.";
    expect(await unitCost(text)).toBeUndefined();
    const s = compileRuleSnapshot([lyam]).scales;
    expect(parseMoney("3 лям рублей", s)).toMatchObject({ amount: 3e6, currency: "RUB" });
  });

  it("never redefines a lexicon word", () => {
    const s = compileRuleSnapshot([
      { id: "x", kind: "add_unit_scale", payload: { unit: "million", multiplier: 1e9 } },
    ]).scales;
    expect(parseMoney("$2 million", s)?.amount).toBe(2e6);
  });

  it("passes the sandbox when the AI-judged reference has the full amount", async () => {
    const raw = "The unit price is $40 grand, the ministry said. Deliveries start next spring.";
    const stored = (n: number) =>
      ({
        id: `c${n}`,
        source: `tg:test/c${n}`,
        raw,
        createdAt: "2026-10-18T00:00:00Z",
        status: "queued",
        extraction: {
          aliases: [],
          operators: [],
          rfBands: [],
          systems: [],
          confidence: 0.5,
          specs: [{ key: "unit_cost", label: "Unit cost", value: 40000, provenance: "ai" }],
        } as unknown as Extraction,
      }) as unknown as Candidate;
    const r = await runSandbox({
      fixtures: [],
      candidates: [stored(1), stored(2)],
      catalog: [],
      baseline: new HeuristicExtractor(1, compileRuleSnapshot([])),
      proposed: new HeuristicExtractor(1, compileRuleSnapshot([grand])),
      terms: ["grand"],
    });
    expect(r.after.spec.tp).toBe(2);
    expect(r.passed).toBe(true);
  });
});
