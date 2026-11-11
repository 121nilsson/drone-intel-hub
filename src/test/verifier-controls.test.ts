import { describe, expect, it } from "vitest";
import { alteredReading, errorRateUpperBound } from "@/entities/drone/audit";
import { cleanReading } from "@/entities/drone/claim-reading";
import { entailmentQuestion } from "@/entities/drone/entailment";
import { figuresIn } from "@/entities/drone/value-in-quote";
import {
  alteredControlValue,
  controlCandidates,
  controlStrata,
  STRATUM_MIN,
  summarizeControls,
  type ControlAnswer,
} from "@/entities/drone/verifier-controls";
import type { Drone, SpecClaim } from "@/entities/drone/types";

const verified = (over: Record<string, unknown> = {}): SpecClaim =>
  ({
    id: "c1",
    value: 40,
    raw: "40 km",
    source: "Reuters",
    sourceId: "p1",
    date: "2026-11-01",
    evidence: "range of 40 km",
    verification: {
      state: "verified",
      checks: [{ kind: "unit_dimension", verdict: "pass" }],
    },
    ...over,
  }) as unknown as SpecClaim;

const drone = (claims: SpecClaim[]): Drone =>
  ({
    id: "lancet-3",
    name: "Lancet-3",
    aliases: [],
    specs: [{ key: "range", label: "Range", unit: "km", discoveredBy: "ai", claims }],
  }) as unknown as Drone;

describe("which claims a control is built from", () => {
  it("takes a verified claim with an id, a post and a passing unit check", () => {
    const out = controlCandidates([drone([verified()])], new Set());
    expect(out.map((c) => c.claim.id)).toEqual(["c1"]);
    expect(out[0]!.drone.id).toBe("lancet-3");
    expect(out[0]!.spec.key).toBe("range");
  });

  it("leaves out claims that are not verified, not measured, or not tied to a post", () => {
    const claims = [
      verified({ id: "u", verification: { state: "uncertain", checks: [] } }),
      verified({
        id: "r",
        verification: {
          state: "verified",
          checks: [{ kind: "unit_dimension", verdict: "fail" }],
        },
      }),
      verified({ id: "n", sourceId: undefined }),
      verified({ id: undefined }),
      verified({ id: "ok" }),
    ];
    expect(controlCandidates([drone(claims)], new Set()).map((c) => c.claim.id)).toEqual(["ok"]);
  });

  it("leaves out an analyst's claim, whatever its verification says", () => {
    const analyst = verified({ id: "a", source: "Analyst" });
    const engine = verified({ id: "e", extractionEngine: "analyst" });
    expect(controlCandidates([drone([analyst, engine])], new Set())).toEqual([]);
  });

  it("leaves out a claim already asked at this entailment version", () => {
    const out = controlCandidates([drone([verified(), verified({ id: "c2" })])], new Set(["c1"]));
    expect(out.map((c) => c.claim.id)).toEqual(["c2"]);
  });

  it("reads the language from the post as the audit does, and from the quote without one", () => {
    const d = drone([verified()]);
    const uk = new Map([["p1", "Дальність їх становить 40 км"]]);
    expect(controlCandidates([d], new Set(), uk)[0]!.language).toBe("uk");
    expect(controlCandidates([d], new Set())[0]!.language).toBe("en");
  });
});

describe("summarizing the controls", () => {
  const rows = (verdicts: ControlAnswer["verdict"][]): ControlAnswer[] =>
    verdicts.map((verdict) => ({ verdict }));

  it("counts the verdicts and bounds the false support over the decided answers only", () => {
    const s = summarizeControls(rows(["supported", "unsupported", "unsupported", "uncertain"]));
    expect(s).toEqual({
      asked: 4,
      supported: 1,
      unsupported: 2,
      uncertain: 1,
      falseSupportBound: errorRateUpperBound(3, 1),
    });
  });

  it("is a bound of 1 with nothing decided, not a rate of zero", () => {
    expect(summarizeControls(rows(["uncertain"])).falseSupportBound).toBe(1);
    expect(summarizeControls([]).falseSupportBound).toBe(1);
  });
});

describe("the controls per stratum", () => {
  const many = (
    n: number,
    verdict: ControlAnswer["verdict"],
    family = "range",
    language = "en",
  ): ControlAnswer[] => Array.from({ length: n }, () => ({ verdict, family, language }));

  it("is too few below the minimum of decided answers, whatever they say", () => {
    expect(STRATUM_MIN).toBe(20);
    const [s] = controlStrata(many(STRATUM_MIN - 1, "supported"));
    expect(s).toMatchObject({ status: "too_few", supported: STRATUM_MIN - 1 });
  });

  it("is over when the false-support bound is above the audit budget", () => {
    const [s] = controlStrata(many(20, "supported"));
    expect(s!.falseSupportBound).toBeGreaterThan(0.05);
    expect(s!.status).toBe("over");
  });

  it("is within when enough answers hold the bound under the budget", () => {
    const [s] = controlStrata(many(100, "unsupported"));
    expect(s!.falseSupportBound).toBeLessThanOrEqual(0.05);
    expect(s!.status).toBe("within");
  });

  it("sorts worst first: over, then too few, then within", () => {
    const rows = [
      ...many(100, "unsupported", "range", "en"),
      ...many(5, "supported", "speed", "en"),
      ...many(20, "supported", "payload", "uk"),
    ];
    expect(controlStrata(rows).map((s) => [s.family, s.language, s.status])).toEqual([
      ["payload", "uk", "over"],
      ["speed", "en", "too_few"],
      ["range", "en", "within"],
    ]);
  });

  it("splits by family and by language together", () => {
    const rows = [
      ...many(3, "unsupported", "range", "en"),
      ...many(3, "unsupported", "range", "ru"),
    ];
    expect(controlStrata(rows)).toHaveLength(2);
  });
});

describe("the question a control is asked as", () => {
  const POST = "The Lancet-3 has a range of 40 km.";

  it("is the real question with only its value changed to the altered clean reading", () => {
    const d = drone([verified()]);
    const spec = d.specs[0]!;
    const claim = spec.claims[0]!;
    const real = entailmentQuestion("1", d, spec, claim);
    const altered = alteredControlValue(spec, claim, POST);
    expect(altered).toBeDefined();
    expect(entailmentQuestion("1", d, spec, claim, altered)).toEqual({ ...real, value: altered });
    expect(real.value).toBe(cleanReading(spec, claim));
    expect(altered).toBe(alteredReading(cleanReading(spec, claim), figuresIn(POST)));
    expect(altered).not.toBe(real.value);
  });
});
