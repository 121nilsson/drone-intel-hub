import { describe, expect, it } from "vitest";
import { combineExtractions } from "@/entities/drone/extraction-gates";
import { compareSpecs, comparableSpecs } from "@/shared/infra/evaluation/evaluation";
import {
  breakerTrips,
  newShadowMetrics,
  promotionVerdict,
  shadowStep,
  trustScores,
  type RuleDecision,
  type ShadowMetrics,
} from "@/shared/infra/evaluation/autonomy";
import type { SandboxResult } from "@/shared/infra/evaluation/sandbox";
import { compileRuleSnapshot } from "@/shared/contracts/rules";
import { HeuristicExtractor } from "@/shared/infra/heuristic-ai";
import type { Candidate, ExtractedSpec, Extraction } from "@/entities/drone/types";

const ex = (specs: ExtractedSpec[], engine: string, over: Partial<Extraction> = {}): Extraction =>
  ({
    aliases: [],
    operators: [],
    specs,
    rfBands: [],
    systems: [],
    confidence: 0.5,
    metadata: { schemaVersion: 2, engine },
    ...over,
  }) as unknown as Extraction;

const spec = (key: string, value: number, unit: string, label = key): ExtractedSpec => ({
  key,
  label,
  value,
  unit,
  evidence: `${label} ${value} ${unit}`,
});

describe("spec provenance from the AI's verdict", () => {
  const heuristic = ex([spec("range", 120, "km"), spec("altitude", 40, "km")], "heuristic");

  it("marks restated claims both, dropped ones heuristic and new ones ai", () => {
    // The AI renames the key and rewrites the unit; that is still a restatement.
    const ai = ex(
      [spec("max_range", 120000, "m", "Maximum range"), spec("speed", 90, "km/h")],
      "ai",
    );
    const by = Object.fromEntries(
      combineExtractions(heuristic, ai).specs.map((s) => [`${s.key}`, s.provenance]),
    );
    expect(by).toEqual({ range: "both", altitude: "heuristic", max_range: "ai", speed: "ai" });
  });

  it("records nothing when the refinement is not an AI verdict", () => {
    const merged = combineExtractions(heuristic, ex([spec("speed", 90, "km/h")], "heuristic"));
    expect(merged.specs.every((s) => s.provenance === undefined)).toBe(true);
  });

  it("keeps an earlier AI confirmation through a second AI pass", () => {
    const t1 = combineExtractions(heuristic, ex([spec("range", 120, "km")], "ai"));
    const t2 = combineExtractions(t1, ex([], "ai"));
    expect(t2.specs.find((s) => s.key === "range")?.provenance).toBe("both");
    expect(t2.specs.find((s) => s.key === "altitude")?.provenance).toBe("heuristic");
  });
});

describe("evaluation against an AI-judged reference", () => {
  const ref = combineExtractions(
    ex([spec("range", 120, "km"), spec("altitude", 40, "km")], "heuristic"),
    ex([spec("range", 120, "km")], "ai"),
  );

  it("scores a claim the AI dropped as rejected, not as a match", () => {
    const heur = ex([spec("range", 120, "km"), spec("altitude", 40, "km")], "heuristic");
    const cmp = compareSpecs(comparableSpecs(heur), comparableSpecs(ref));
    expect(cmp.pairs.map((p) => p.h.key)).toEqual(["range"]);
    expect(cmp.rejected.map((x) => x.h.key)).toEqual(["altitude"]);
  });

  it("does not count a dropped claim the heuristic stopped making as a miss", () => {
    const heur = ex([spec("range", 120, "km")], "heuristic");
    const cmp = compareSpecs(comparableSpecs(heur), comparableSpecs(ref));
    expect(cmp.misses).toEqual([]);
  });
});

describe("trust calibration", () => {
  const d = (
    decision: RuleDecision["decision"],
    actor: RuleDecision["actor"],
    origin = "autonomous_sandbox",
  ): RuleDecision => ({
    category: "add_stopword:system_name",
    origin,
    decision,
    actor,
  });

  it("counts analyst verdicts and quarantines, never the system vouching for itself", () => {
    const t = trustScores([
      d("activated", "analyst"),
      d("activated", "analyst"),
      d("rejected", "analyst"),
      d("auto_activated", "autonomous"),
      d("rejected", "sandbox"),
      d("quarantined", "circuit_breaker"),
      d("activated", "analyst", "analyst"),
    ]);
    expect(t["add_stopword:system_name"]).toEqual({ score: 0.5, decisions: 4 });
  });
});

describe("auto-promotion policy", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const metrics: ShadowMetrics = {
    ...newShadowMetrics("2026-10-17T12:00:00Z"),
    evaluated: 400,
    hits: 12,
    concordant: 12,
  };
  const ok = {
    origin: "autonomous_sandbox",
    metrics,
    trust: { score: 0.96, decisions: 25 },
    autoActivatedLast24h: 0,
    now,
  };

  it("promotes only when every condition holds", () => {
    expect(promotionVerdict(ok)).toEqual({ promote: true, reasons: [] });
  });

  it.each([
    ["too young", { metrics: { ...metrics, startedAt: "2026-10-19T12:00:00Z" } }],
    ["a single conflict", { metrics: { ...metrics, conflicts: 1 } }],
    ["too few hits", { metrics: { ...metrics, hits: 2, concordant: 2 } }],
    ["too few analyst decisions", { trust: { score: 1, decisions: 5 } }],
    ["low trust", { trust: { score: 0.9, decisions: 40 } }],
    ["the daily cap", { autoActivatedLast24h: 2 }],
    ["an analyst-authored rule", { origin: "analyst" }],
  ])("refuses with %s", (_, over) => {
    expect(promotionVerdict({ ...ok, ...over }).promote).toBe(false);
  });
});

describe("shadow scoring", () => {
  const pad = " Reported by the regional desk after a field demonstration this week.";
  const cand = (id: string, createdAt: string): Candidate =>
    ({
      id,
      source: `tg:test/${id}`,
      raw: "ZALA reported SPARTA deployment near the front." + pad,
      createdAt,
      status: "queued",
      extraction: ex([], "combined", { name: "ZALA", systems: [{ name: "ZALA" }] }),
    }) as unknown as Candidate;
  const active = new HeuristicExtractor(1, compileRuleSnapshot([]));
  const shadow = new HeuristicExtractor(
    1,
    compileRuleSnapshot([{ id: "s", kind: "add_stopword", payload: { word: "sparta" } }]),
  );

  it("only scores reports newer than its watermark and advances it", async () => {
    const m = newShadowMetrics("2026-10-18T00:00:00Z");
    const next = await shadowStep(
      m,
      [
        cand("old", "2026-10-17T00:00:00Z"),
        cand("b", "2026-10-18T02:00:00Z"),
        cand("a", "2026-10-18T01:00:00Z"),
      ],
      [],
      active,
      shadow,
    );
    expect(next).toMatchObject({ evaluated: 2, hits: 2, concordant: 2, conflicts: 0 });
    expect(next.watermark).toBe("2026-10-18T02:00:00Z");
    const again = await shadowStep(next, [cand("b", "2026-10-18T02:00:00Z")], [], active, shadow);
    expect(again.evaluated).toBe(2);
  });
});

describe("circuit breaker", () => {
  const prf = (f1: number) => ({ precision: f1, recall: f1, f1, tp: 0, fp: 0, fn: 0 });
  const result = (spec: [number, number], regressions = 0) =>
    ({
      regressions: Array.from({ length: regressions }, (_, i) => ({
        id: `fx${i}`,
        source: "",
        failures: [],
      })),
      before: { spec: prf(spec[0]), name: prf(0.8), matchId: prf(0.7) },
      after: { spec: prf(spec[1]), name: prf(0.8), matchId: prf(0.7) },
    }) as unknown as SandboxResult;

  it("tolerates noise within the threshold and trips beyond it or on any broken fixture", () => {
    expect(breakerTrips(result([0.75, 0.74])).trips).toBe(false);
    expect(breakerTrips(result([0.75, 0.72])).trips).toBe(true);
    expect(breakerTrips(result([0.75, 0.75], 1)).trips).toBe(true);
  });
});

describe("sandbox with AI-judged references", () => {
  it("passes a suppress filter once the reference shows the AI dropped the claim", async () => {
    const { runSandbox } = await import("@/shared/infra/evaluation/sandbox");
    const raw = "Its hunting altitude reaches 3 km." + " Reported by the regional desk this week.";
    const stored = (n: number) =>
      ({
        id: `c${n}`,
        source: `tg:test/c${n}`,
        raw,
        createdAt: "2026-10-18T00:00:00Z",
        status: "queued",
        extraction: combineExtractions(
          ex([{ ...spec("altitude", 3, "km"), label: "Maximum altitude" }], "heuristic"),
          ex([], "ai"),
        ),
      }) as unknown as Candidate;
    const rule = {
      id: "f",
      kind: "context_filter",
      payload: { key: "altitude", triggerWords: ["hunting"], action: "suppress" },
    };
    const r = await runSandbox({
      fixtures: [],
      candidates: [stored(1), stored(2)],
      catalog: [],
      baseline: new HeuristicExtractor(1, compileRuleSnapshot([])),
      proposed: new HeuristicExtractor(1, compileRuleSnapshot([rule])),
      terms: ["hunting"],
    });
    expect(r.before.spec.fp).toBe(2);
    expect(r.after.spec.fp).toBe(0);
    expect(r.passed).toBe(true);
  });
});
