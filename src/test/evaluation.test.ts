import { describe, expect, it } from "vitest";
import type { Candidate, Extraction } from "@/entities/drone/types";
import type { IntelExtractor } from "@/shared/contracts/ai";
import {
  evaluateHeuristic,
  numbersClose,
  evalPosts,
  platformOf,
} from "@/shared/infra/evaluation/evaluation";

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

  it("reads the platform from the post's host in today's source lines", () => {
    expect(platformOf("Rybar · https://t.me/rybar/71234")).toBe("telegram");
    expect(platformOf("OSINTtechnical · https://x.com/Osinttechnical/status/1")).toBe("x");
    expect(platformOf("Militarnyi · https://www.mil.in.ua/en/news/1")).toBe("web");
    // Legacy "outlet|tg:handle" rows were read as the outlet's name.
    expect(platformOf("dronebomber|tg:dva_majors/100461")).toBe("telegram");
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
    // Two outlets with the same spec satisfy the corroboration filter (>=2).
    const r = await evaluateHeuristic(
      [cand("a", ext([spec]), "tg:one"), cand("b", ext([spec]), "tg:two"), short],
      [],
      fake(ext([spec])),
    );
    // "short" is too short to be eligible, so totalItems counts only the two real ones.
    expect(r.totalItems).toBe(2);
    expect(r.fixtures.length).toBeGreaterThanOrEqual(1);
    expect(r.fixtures[0]?.expect[0]?.value).toBe(40);
  });

  it("scores a post once however often it was analysed", async () => {
    const spec = { key: "range", label: "Range", value: 40, unit: "km" };
    const copies = [1, 2, 3].map((n) => ({
      ...cand(`a${n}`, ext([])),
      createdAt: `2026-01-0${n}`,
    }));
    const r = await evaluateHeuristic(copies, [], fake(ext([spec])));
    expect(r.totalItems).toBe(1);
    expect(r.summary.fp).toBe(1);
    // The latest analysis is the reference.
    expect(evalPosts(copies).map((p) => p.systems.map((c) => c.id))).toEqual([["a3"]]);
  });

  it("scores a post naming two systems against both systems' figures", async () => {
    // The heuristic reads both figures from the whole post; the AI filed one under each system.
    const range = { key: "range", label: "Range", value: 40, unit: "km" };
    const antennas = { key: "antennas", label: "Number of antennas", value: 12 };
    const akinci = cand("akinci", { ...ext([range], "Akinci"), matchId: "akinci" });
    const ilter = { ...cand("ilter", { ...ext([antennas], "Ilter"), matchId: "ilter" }) };
    const r = await evaluateHeuristic([akinci, ilter], [], fake(ext([range, antennas])));
    expect(r.totalItems).toBe(1);
    expect(r.summary).toMatchObject({ tp: 2, fp: 0, fn: 0 });
  });

  it("does not score figures with no canonical meaning", async () => {
    const ref = ext([{ key: "keel", label: "Keel", value: "deep V" }]);
    const r = await evaluateHeuristic([cand("a", ref)], [], fake(ext([])));
    expect(r.summary.fn).toBe(0);
    expect(r.unscoredMisses).toBe(1);
  });
});
