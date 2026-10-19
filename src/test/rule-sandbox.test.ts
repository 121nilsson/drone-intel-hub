import { describe, expect, it } from "vitest";
import { compileRuleSnapshot, ruleTerms, type DynamicRuleRow } from "@/shared/contracts/rules";
import { HeuristicExtractor } from "@/shared/infra/heuristic-ai";
import { runSandbox } from "@/features/evaluation/sandbox";
import { hypothesisId, mineHypotheses } from "@/features/evaluation/hypotheses";
import type { EvalFixture } from "@/features/evaluation/evaluation";
import type { Candidate, Extraction } from "@/entities/drone/types";

const specsOf = async (text: string, rows: DynamicRuleRow[] = []) =>
  (await new HeuristicExtractor(1, compileRuleSnapshot(rows, 2)).extract(text, [])).specs.map(
    (s) => `${s.key}=${s.value}${s.unit ?? ""}`,
  );

const extraction = (over: Partial<Extraction> = {}): Extraction =>
  ({ aliases: [], specs: [], rfBands: [], systems: [], confidence: 0.5, ...over }) as Extraction;

const candidate = (id: string, raw: string, ref: Partial<Extraction> = {}): Candidate =>
  ({
    id,
    source: `tg:test/${id}`,
    raw,
    status: "queued",
    extraction: extraction(ref),
  }) as unknown as Candidate;

const pad = " Reported by the regional desk after a field demonstration this week.";

describe("rule DSL compiler", () => {
  it("rejects regex syntax in a term, so a generated rule cannot backtrack", () => {
    const s = compileRuleSnapshot([
      { id: "evil", kind: "add_cue", payload: { target: "range", terms: ["(a+)+$"] } },
    ]);
    expect(s.cues).toEqual([]);
    expect(s.invalid).toEqual(["evil"]);
  });

  it("rejects a stem short enough to match half the dictionary", () => {
    const s = compileRuleSnapshot([
      { id: "s", kind: "add_cue", payload: { target: "range", stem: "ra" } },
    ]);
    expect(s.invalid).toEqual(["s"]);
  });

  it("rejects a cue for a key the engine has no unit set for", () => {
    const s = compileRuleSnapshot([
      { id: "c", kind: "add_cue", payload: { target: "contract_value", terms: ["deal"] } },
    ]);
    expect(s.invalid).toEqual(["c"]);
  });

  it("rejects a reroute without a valid target key and an unknown language", () => {
    const s = compileRuleSnapshot([
      {
        id: "f",
        kind: "context_filter",
        payload: { key: "altitude", triggerWords: ["x1"], action: "reroute" },
      },
      { id: "l", kind: "add_stopword", language: "de", payload: { word: "sparta" } },
    ]);
    expect(s.invalid).toEqual(["f", "l"]);
  });

  it("lists a rule's literal terms for the sandbox's affected-text filter", () => {
    expect(
      ruleTerms({ id: "f", kind: "context_filter", payload: { triggerWords: ["Hunting"] } }),
    ).toEqual(["hunting"]);
  });
});

describe("dynamic rules in the engine", () => {
  it("a cue rule adds vocabulary to an existing target", async () => {
    const text = "The drone has a strike radius of 85 km.";
    expect(await specsOf(text)).toEqual([]);
    const rule = {
      id: "c",
      kind: "add_cue",
      payload: { target: "range", terms: ["strike radius"] },
    };
    expect(await specsOf(text, [rule])).toEqual(["range=85km"]);
  });

  it("a cue rule keeps the target's cross-class guard", async () => {
    const rule = {
      id: "c",
      kind: "add_cue",
      payload: { target: "range", terms: ["strike radius"] },
    };
    expect(await specsOf("Its engagement range strike radius 85 km.", [rule])).not.toContain(
      "range=85km",
    );
  });

  it("a reroute filter moves a target ceiling out of the vehicle's own altitude", async () => {
    const text = "Its hunting altitude reaches 3 km.";
    expect(await specsOf(text)).toEqual(["altitude=3km"]);
    const rule = {
      id: "f",
      kind: "context_filter",
      payload: {
        key: "altitude",
        triggerWords: ["hunting"],
        action: "reroute",
        targetKey: "target_altitude_max",
      },
    };
    expect(await specsOf(text, [rule])).toEqual(["target_altitude_max=3km"]);
  });

  it("a suppress filter only fires within its token window", async () => {
    const rule = {
      id: "f",
      kind: "context_filter",
      payload: { key: "range", triggerWords: ["flight"], action: "suppress", maxTokenDistance: 2 },
    };
    expect(await specsOf("Flight range is 40 km.", [rule])).toEqual(["range=40km"]);
    expect(await specsOf("Flight range 40 km.", [rule])).toEqual([]);
  });
});

describe("rule sandbox", () => {
  const fixtures: EvalFixture[] = [
    {
      id: "fx-range",
      source: "tg:test/fx",
      text: "Flight range 40 km." + pad,
      expect: [{ semantic: "range.max", value: 40, unit: "km" }],
      status: "approved",
    },
  ];
  const sandbox = (rule: DynamicRuleRow, candidates: Candidate[]) =>
    runSandbox({
      fixtures,
      candidates,
      catalog: [],
      baseline: new HeuristicExtractor(1, compileRuleSnapshot([], 1)),
      proposed: new HeuristicExtractor(1, compileRuleSnapshot([rule], 2)),
      terms: ruleTerms(rule),
    });

  it("refuses a rule that breaks an approved fixture", async () => {
    const rule = {
      id: "bad",
      kind: "context_filter",
      payload: { key: "range", triggerWords: ["flight"], action: "suppress" },
    };
    const r = await sandbox(rule, [candidate("c1", "Flight range 40 km." + pad)]);
    expect(r.passed).toBe(false);
    expect(r.regressions.map((b) => b.id)).toEqual(["fx-range"]);
  });

  it("passes a rule that removes a false name without breaking anything", async () => {
    const rule = { id: "stop", kind: "add_stopword", payload: { word: "sparta" } };
    const text = "ZALA reported SPARTA deployment near the front." + pad;
    const ref = { name: "ZALA", systems: [{ name: "ZALA" }] };
    const r = await sandbox(rule, [candidate("c1", text, ref), candidate("c2", text, ref)]);
    expect(r.regressions).toEqual([]);
    expect(r.after.name.f1).toBeGreaterThan(r.before.name.f1);
    expect(r.passed).toBe(true);
    expect(r.preview[0]?.before).toContain("name:SPARTA");
  });

  it("refuses a rule that changes nothing", async () => {
    const rule = { id: "noop", kind: "add_stopword", payload: { word: "nonexistentword" } };
    const r = await sandbox(rule, [candidate("c1", "Flight range 40 km." + pad)]);
    expect(r.passed).toBe(false);
    expect(r.reasons).toContain("rule changes no output");
  });
});

describe("hypothesis miner", () => {
  const text = (n: number) => `ZALA reported SPARTA deployment near the front, day ${n}.` + pad;
  const ref = { name: "ZALA", systems: [{ name: "ZALA" }] };
  const h = new HeuristicExtractor(1);

  it("proposes a stopword only once several reports agree", async () => {
    const three = [1, 2, 3].map((n) => candidate(`c${n}`, text(n), ref));
    const mined = await mineHypotheses(three, [], h, { minSupport: 3 });
    const stop = mined.hypotheses.find((x) => x.kind === "add_stopword");
    expect(stop?.payload).toEqual({ word: "sparta" });
    expect(stop?.support).toBe(3);
    expect(stop?.id).toBe(hypothesisId("add_stopword", { word: "sparta" }));
  });

  it("never proposes from a single disagreement (anti-poisoning)", async () => {
    const two = [1, 2].map((n) => candidate(`c${n}`, text(n), ref));
    const mined = await mineHypotheses(two, [], h, { minSupport: 3 });
    expect(mined.hypotheses.filter((x) => x.kind === "add_stopword")).toEqual([]);
  });

  it("never stopwords a name the reference reports elsewhere", async () => {
    const three = [1, 2, 3].map((n) => candidate(`c${n}`, text(n), ref));
    const named = candidate("c9", text(9), { name: "SPARTA", systems: [{ name: "SPARTA" }] });
    const mined = await mineHypotheses([...three, named], [], h, { minSupport: 3 });
    expect(mined.hypotheses.filter((x) => x.kind === "add_stopword")).toEqual([]);
  });

  it("proposes a cue from figures the reference found and the heuristic missed", async () => {
    const miss = (n: number) =>
      candidate(`m${n}`, `The drone has a strike radius of ${80 + n} km.` + pad, {
        specs: [
          {
            key: "range",
            label: "Range",
            value: 80 + n,
            unit: "km",
            evidence: `strike radius of ${80 + n} km`,
          },
        ],
      });
    const mined = await mineHypotheses([miss(1), miss(2)], [], h, { minSupport: 3 });
    const cue = mined.hypotheses.find((x) => x.kind === "add_cue");
    expect(cue?.payload["target"]).toBe("range");
    expect(["strike", "radius"]).toContain((cue?.payload["terms"] as string[])[0]);
  });
});
