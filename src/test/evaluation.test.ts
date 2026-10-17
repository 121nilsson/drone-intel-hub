import { describe, expect, it } from "vitest";
import type { Candidate, Extraction } from "@/entities/drone/types";
import type { IntelExtractor } from "@/shared/contracts/ai";
import { evaluateHeuristic, numbersClose, platformOf } from "@/features/evaluation/evaluation";

const ext = (specs: Extraction["specs"], name?: string): Extraction => ({
  ...(name ? { name } : {}),

  aliases: [],
  operators: [],
  specs,
  rfBands: [],
  confidence: 0.5,
  rationale: "",
});
const cand = (id: string, extraction: Extraction, source = "tg:test"): Candidate => ({
  id,
  raw: "x".repeat(80),
  source,
  createdAt: "2026-01-01",
  tier: 1,
  extraction,
  status: "pending",
});
const fake = (out: Extraction): IntelExtractor => ({
  tier: 1,
  label: "fake",
  extract: async () => out,
});

describe("evaluation", () => {
  it("numeric tolerance is 1%", () => {
    expect(numbersClose(100, 100.9)).toBe(true);
    expect(numbersClose(100, 102)).toBe(false);
  });

  it("parses platform from source prefix", () => {
    expect(platformOf("tg:dva_majors/1")).toBe("telegram");
    expect(platformOf("rss:militaer")).toBe("rss");
  });

  it("counts a target altitude read as vehicle altitude as a wrong key", async () => {
    const ref = ext([
      { key: "target_altitude_max", label: "Target altitude", value: 40, unit: "km" },
    ]);
    const heur = ext([{ key: "altitude", label: "Altitude", value: 40, unit: "km" }]);
    const r = await evaluateHeuristic([cand("a", ref)], [], fake(heur));
    expect(r.mismatches[0]?.matchType).toBe("wrongKey");
    expect(r.summary.tp).toBe(0);
  });

  it("ignores contract values (routed to procurements)", async () => {
    const ref = ext([{ key: "contract_value", label: "Contract", value: "$2 billion" }]);
    const r = await evaluateHeuristic([cand("a", ref)], [], fake(ext([])));
    expect(r.summary.fn).toBe(0);
  });

  it("turns agreements into regression fixtures and skips short texts", async () => {
    const spec = { key: "range", label: "Range", value: 40, unit: "km" };
    const short = { ...cand("s", ext([spec])), raw: "short" };
    const r = await evaluateHeuristic([cand("a", ext([spec])), short], [], fake(ext([spec])));
    expect(r.totalItems).toBe(1);
    expect(r.fixtures).toHaveLength(1);
    expect(r.fixtures[0]?.expect[0]?.value).toBe(40);
  });
});
