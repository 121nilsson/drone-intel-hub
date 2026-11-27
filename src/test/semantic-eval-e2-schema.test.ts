/**
 * E2 schema 1.2.0 (step a): resolver-language rule, validators, hash chain, isolation.
 * Every expected value below is written by hand; none is computed with the code under test
 * (hashes are fixed 64-hex literals, and the chain test uses the one helper the chain is defined
 * by only to build a link, with the broken-link case using a literal).
 */

import { describe, expect, it } from "vitest";
import { e2ResolverLanguage } from "../entities/normalization/semantic-eval/e2/resolver-language";
import {
  E2_RESOLVER_LANGUAGE_RULE,
  E2_ROUTING_RULE,
  type E2PopulationManifest,
  type E2SampleManifest,
  type E2AdjudicationManifest,
  type E2EvaluationManifest,
} from "../entities/normalization/semantic-eval/e2/types";
import {
  checkE2Allocation,
  checkE2HashChain,
  e2ManifestHash,
  e2RoutingStratum,
  e2StoredExcerpt,
  validateE2Adjudication,
  validateE2AdjudicationManifest,
  validateE2EvaluationManifest,
  validateE2Example,
  validateE2PopulationManifest,
  validateE2SampleManifest,
} from "../entities/normalization/semantic-eval/e2/validate";
import {
  SUPPORTED_SCHEMA_VERSIONS,
  SEMANTIC_EVAL_SCHEMA_VERSION,
  SEMANTIC_EVAL_SCHEMA_VERSION_1_1,
} from "../entities/normalization/semantic-eval/types";
import { validateExample } from "../entities/normalization/semantic-eval/validate";

const H1 = "a".repeat(64);
const H2 = "b".repeat(64);
const H3 = "c".repeat(64);
const H4 = "d".repeat(64);

const EN_TEXT = "The drone is on the way to the base and it was seen by the crew";
const RU_TEXT = "Беспилотник летит над городом сегодня";
const UK_TEXT = "Безпілотник летить над містом сьогодні";

function example(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    exampleId: H1,
    sourceClusterId: "sc1",
    evidenceClusterId: "ec1",
    source: { id: "s1" },
    excerpt: EN_TEXT,
    routingStratum: "en",
    rawKey: "range",
    context: {},
    family: "range",
    origin: "historical",
    frameId: "frame-1",
    schemaVersion: "1.2.0",
    ...over,
  };
}

function adj(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    exampleId: H1,
    reviewerId: "r1",
    protocolVersion: "protocol-v1",
    reviewerLanguage: "ru",
    finalAdjudicatedLanguage: "ru",
    disagreement: false,
    ...over,
  };
}

const popManifest: E2PopulationManifest = {
  stage: "population",
  schemaVersion: "1.2.0",
  routingRule: E2_ROUTING_RULE,
  routingRuleSourceCommit: "7aea9a6",
  cutoff: "2026-11-01T00:00:00Z",
  frameId: "frame-1",
  populationRowsSha256: H1,
  populationCount: 10,
  stratumCounts: { en: 6, ru: 2, uk: 1, unknown: 1 },
  exclusions: [{ reason: "no excerpt", count: 3 }],
};

const strata = [
  { stratum: "en", populationCount: 6, sampleCount: 3, census: false, pi: "3/6", w: "6/3" },
  { stratum: "ru", populationCount: 2, sampleCount: 2, census: true, pi: "2/2", w: "2/2" },
  { stratum: "uk", populationCount: 1, sampleCount: 1, census: true, pi: "1/1", w: "1/1" },
  { stratum: "unknown", populationCount: 1, sampleCount: 1, census: true, pi: "1/1", w: "1/1" },
] as const;

function sampleManifest(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    stage: "sample",
    schemaVersion: "1.2.0",
    populationManifestSha256: H2,
    seed: "seed-1",
    n: 7,
    m: 1,
    strata,
    redistributionRounds: 0,
    drawnExampleIds: ["1", "2", "3", "4", "5", "6", "7"].map((c) => c.repeat(64)),
    drawnRowsSha256: H3,
    ...over,
  };
}

describe("e2ResolverLanguage: the decided table", () => {
  it("has exactly two parameters and no place for a detected language", () => {
    expect(e2ResolverLanguage.length).toBe(2);
  });

  it.each([
    ["en", undefined, "en"],
    ["ru", undefined, "ru"],
    ["uk", undefined, "uk"],
    ["en", "ru", "en"],
    ["ru", "uk", "ru"],
    ["uk", "mixed", "uk"],
    ["en", "unknown", "en"],
    ["ru", "en", "ru"],
    [undefined, "en", "en"],
    [undefined, "ru", "ru"],
    [undefined, "uk", "uk"],
    [undefined, "mixed", undefined],
    [undefined, "unknown", undefined],
    [undefined, undefined, undefined],
  ] as const)("declared %s, adjudicated %s -> %s", (d, a, expected) => {
    expect(e2ResolverLanguage(d, a)).toBe(expected);
  });

  it("describes the rule in words and never lets detection in", () => {
    expect(E2_RESOLVER_LANGUAGE_RULE).toContain("detectedLanguage is never an input");
    expect(E2_ROUTING_RULE).toContain("allocation key only");
    expect(E2_ROUTING_RULE).toContain("7aea9a6");
  });
});

describe("routing stratum", () => {
  it("routes by hand-picked texts", () => {
    expect(e2RoutingStratum(EN_TEXT)).toBe("en");
    expect(e2RoutingStratum(RU_TEXT)).toBe("ru");
    expect(e2RoutingStratum(UK_TEXT)).toBe("uk");
    expect(e2RoutingStratum("ok")).toBe("unknown");
  });

  it("uses the stored excerpt: 300 characters at most, 299 plus an ellipsis", () => {
    expect(e2StoredExcerpt("x".repeat(300))).toBe("x".repeat(300));
    expect(e2StoredExcerpt("x".repeat(301))).toBe(`${"x".repeat(299)}…`);
    expect(e2StoredExcerpt("x".repeat(301)).length).toBe(300);
  });
});

describe("validateE2Example", () => {
  it("accepts a valid row, with and without a declared language", () => {
    expect(validateE2Example(example()).routingStratum).toBe("en");
    expect(validateE2Example(example({ declaredLanguage: "ru" })).declaredLanguage).toBe("ru");
    expect(
      validateE2Example(example({ excerpt: RU_TEXT, routingStratum: "ru" })).routingStratum,
    ).toBe("ru");
  });

  it("rejects mixed as a routing stratum", () => {
    expect(() => validateE2Example(example({ routingStratum: "mixed" }))).toThrow(
      /routingStratum: expected one of en, ru, uk, unknown, got "mixed"/,
    );
  });

  it("rejects mixed and unknown as a declared language", () => {
    expect(() => validateE2Example(example({ declaredLanguage: "mixed" }))).toThrow(
      /declaredLanguage: expected one of en, ru, uk, got "mixed"/,
    );
    expect(() => validateE2Example(example({ declaredLanguage: "unknown" }))).toThrow(
      /declaredLanguage: expected one of en, ru, uk, got "unknown"/,
    );
  });

  it("rejects a routing stratum that the rule does not give for the excerpt", () => {
    expect(() => validateE2Example(example({ routingStratum: "ru" }))).toThrow(
      /routingStratum: is ru but the routing rule gives en/,
    );
  });

  it("rejects a missing field, an unknown field and a wrong schema version", () => {
    const { family: _f, ...rest } = example();
    expect(() => validateE2Example(rest)).toThrow(/family: expected a string/);
    expect(() => validateE2Example(example({ detectedLanguage: "en" }))).toThrow(
      /detectedLanguage: unknown field/,
    );
    expect(() => validateE2Example(example({ schemaVersion: "1.1.0" }))).toThrow(
      /schemaVersion: expected 1.2.0/,
    );
  });

  it("rejects an excerpt over 300 characters", () => {
    expect(() =>
      validateE2Example(example({ excerpt: "x".repeat(301), routingStratum: "unknown" })),
    ).toThrow(/excerpt: must be at most 300 chars/);
  });
});

describe("validateE2Adjudication", () => {
  it("accepts a single reviewer and an agreeing pair", () => {
    expect(validateE2Adjudication(adj()).finalAdjudicatedLanguage).toBe("ru");
    expect(
      validateE2Adjudication(
        adj({ secondReviewerId: "r2", secondReviewerLanguage: "ru", note: "n" }),
      ).disagreement,
    ).toBe(false);
  });

  it("accepts an explicitly resolved disagreement, including a final of mixed", () => {
    const r = validateE2Adjudication(
      adj({
        secondReviewerId: "r2",
        secondReviewerLanguage: "uk",
        disagreement: true,
        resolvedBy: "adjudicator-1",
        finalAdjudicatedLanguage: "mixed",
      }),
    );
    expect(r.finalAdjudicatedLanguage).toBe("mixed");
    expect(r.resolvedBy).toBe("adjudicator-1");
  });

  it("rejects an implicit disagreement (differ, but not flagged)", () => {
    expect(() =>
      validateE2Adjudication(adj({ secondReviewerId: "r2", secondReviewerLanguage: "uk" })),
    ).toThrow(/disagreement: the reviewers differ, so disagreement must be true/);
  });

  it("rejects a disagreement without an explicit resolution", () => {
    expect(() =>
      validateE2Adjudication(
        adj({ secondReviewerId: "r2", secondReviewerLanguage: "uk", disagreement: true }),
      ),
    ).toThrow(/resolvedBy: a disagreement needs an explicit resolution/);
  });

  it("rejects a flagged disagreement when the reviewers agree, and a stray resolvedBy", () => {
    expect(() => validateE2Adjudication(adj({ disagreement: true }))).toThrow(
      /disagreement is true but the reviewers do not differ/,
    );
    expect(() => validateE2Adjudication(adj({ resolvedBy: "x" }))).toThrow(
      /resolvedBy: only allowed with a disagreement/,
    );
  });

  it("rejects a final that differs from an agreed value, and bad enums", () => {
    expect(() => validateE2Adjudication(adj({ finalAdjudicatedLanguage: "en" }))).toThrow(
      /reviewers agree on ru but the final is en/,
    );
    expect(() => validateE2Adjudication(adj({ finalAdjudicatedLanguage: "de" }))).toThrow(
      /finalAdjudicatedLanguage: expected one of en, ru, uk, mixed, unknown, got "de"/,
    );
    expect(() => validateE2Adjudication(adj({ reviewerLanguage: undefined }))).toThrow(
      /reviewerLanguage: expected one of/,
    );
  });

  it("rejects a half-given second reviewer and a repeated reviewer", () => {
    expect(() => validateE2Adjudication(adj({ secondReviewerId: "r2" }))).toThrow(
      /given together or not at all/,
    );
    expect(() =>
      validateE2Adjudication(adj({ secondReviewerId: "r1", secondReviewerLanguage: "ru" })),
    ).toThrow(/second reviewer must differ/);
  });
});

describe("validateE2PopulationManifest", () => {
  it("accepts a valid manifest", () => {
    expect(validateE2PopulationManifest(popManifest).populationCount).toBe(10);
  });

  it("rejects counts that do not sum to N", () => {
    expect(() => validateE2PopulationManifest({ ...popManifest, populationCount: 11 })).toThrow(
      /counts sum to 10 but populationCount is 11/,
    );
  });

  it("rejects mixed as a stratum key, a missing stratum and a wrong rule", () => {
    expect(() =>
      validateE2PopulationManifest({
        ...popManifest,
        stratumCounts: { en: 6, ru: 2, uk: 1, unknown: 0, mixed: 1 },
      }),
    ).toThrow(/stratumCounts.mixed: unknown field/);
    expect(() =>
      validateE2PopulationManifest({ ...popManifest, stratumCounts: { en: 9, ru: 1, uk: 0 } }),
    ).toThrow(/stratumCounts.unknown: missing/);
    expect(() =>
      validateE2PopulationManifest({ ...popManifest, routingRule: "language strata" }),
    ).toThrow(/routingRule: must equal E2_ROUTING_RULE/);
  });

  it("rejects a missing field", () => {
    const { frameId: _f, ...rest } = popManifest;
    expect(() => validateE2PopulationManifest(rest)).toThrow(/frameId: expected a string/);
  });
});

describe("validateE2SampleManifest and allocation", () => {
  it("accepts a valid manifest with exact rational pi and w", () => {
    const m = validateE2SampleManifest(sampleManifest());
    expect(m.n).toBe(7);
    expect(m.strata[0]?.pi).toBe("3/6");
    expect(m.strata[0]?.w).toBe("6/3");
  });

  it("rejects a pi mismatch and a w mismatch", () => {
    const bad = strata.map((s) => (s.stratum === "en" ? { ...s, pi: "3/7" } : s));
    expect(() => validateE2SampleManifest(sampleManifest({ strata: bad }))).toThrow(
      /stratum en: pi is "3\/7", expected "3\/6"/,
    );
    const badW = strata.map((s) => (s.stratum === "en" ? { ...s, w: "2/1" } : s));
    expect(() => validateE2SampleManifest(sampleManifest({ strata: badW }))).toThrow(
      /stratum en: w is "2\/1", expected "6\/3"/,
    );
  });

  it("rejects a sum of n_h that is not n", () => {
    expect(() => validateE2SampleManifest(sampleManifest({ n: 8 }))).toThrow(
      /sum of n_h is 7 but n is 8/,
    );
  });

  it("rejects a census flag inconsistent with the counts, both ways", () => {
    const a = strata.map((s) => (s.stratum === "ru" ? { ...s, census: false } : s));
    expect(() => validateE2SampleManifest(sampleManifest({ strata: a }))).toThrow(
      /stratum ru: census flag false is inconsistent with n_h 2 and N_h 2/,
    );
    const b = strata.map((s) => (s.stratum === "en" ? { ...s, census: true } : s));
    expect(() => validateE2SampleManifest(sampleManifest({ strata: b }))).toThrow(
      /stratum en: census flag true is inconsistent with n_h 3 and N_h 6/,
    );
  });

  it("rejects n_h above N_h", () => {
    const errs = checkE2Allocation(
      [
        { stratum: "en", populationCount: 2, sampleCount: 3, census: false, pi: "3/2", w: "2/3" },
        { stratum: "ru", populationCount: 0, sampleCount: 0, census: true, pi: null, w: null },
        { stratum: "uk", populationCount: 0, sampleCount: 0, census: true, pi: null, w: null },
        { stratum: "unknown", populationCount: 0, sampleCount: 0, census: true, pi: null, w: null },
      ],
      3,
    );
    expect(errs).toContain("stratum en: n_h 3 exceeds N_h 2");
  });

  it("accepts an empty stratum with null pi and w, and rejects a non-empty undrawn one", () => {
    const empty = {
      stratum: "uk",
      populationCount: 0,
      sampleCount: 0,
      census: true,
      pi: null,
      w: null,
    } as const;
    expect(
      checkE2Allocation(
        [
          { stratum: "en", populationCount: 4, sampleCount: 4, census: true, pi: "4/4", w: "4/4" },
          { stratum: "ru", populationCount: 0, sampleCount: 0, census: true, pi: null, w: null },
          empty,
          {
            stratum: "unknown",
            populationCount: 0,
            sampleCount: 0,
            census: true,
            pi: null,
            w: null,
          },
        ],
        4,
      ),
    ).toEqual([]);
    expect(
      checkE2Allocation(
        [
          { stratum: "en", populationCount: 4, sampleCount: 0, census: false, pi: null, w: null },
          { stratum: "ru", populationCount: 0, sampleCount: 0, census: true, pi: null, w: null },
          empty,
          {
            stratum: "unknown",
            populationCount: 0,
            sampleCount: 0,
            census: true,
            pi: null,
            w: null,
          },
        ],
        0,
      ),
    ).toContain("stratum en: a non-empty stratum needs n_h >= 1 so that w_h exists");
  });

  it("rejects a missing stratum, drawn ids that do not match n, and duplicates", () => {
    expect(() =>
      validateE2SampleManifest(sampleManifest({ strata: strata.slice(0, 3), n: 6 })),
    ).toThrow(/stratum unknown: missing/);
    expect(() => validateE2SampleManifest(sampleManifest({ drawnExampleIds: [H1, H2] }))).toThrow(
      /has 2 ids but n is 7/,
    );
    expect(() =>
      validateE2SampleManifest(sampleManifest({ drawnExampleIds: Array(7).fill(H1) })),
    ).toThrow(/contains duplicates/);
  });

  it("rejects a missing field", () => {
    const { seed: _s, ...rest } = sampleManifest();
    expect(() => validateE2SampleManifest(rest)).toThrow(/seed: expected a string/);
  });
});

describe("adjudication and evaluation manifests", () => {
  const adjM: E2AdjudicationManifest = {
    stage: "adjudication",
    schemaVersion: "1.2.0",
    sampleManifestSha256: H3,
    adjudicationSha256: H4,
    protocolVersion: "protocol-v1",
    reviewerIds: ["r1", "r2"],
    secondReviewerUsed: true,
    disagreementCount: 2,
    frozenAt: "2026-12-01T10:00:00Z",
  };
  const evalM: E2EvaluationManifest = {
    stage: "evaluation",
    schemaVersion: "1.2.0",
    adjudicationManifestSha256: H1,
    resolverLanguageRule: E2_RESOLVER_LANGUAGE_RULE,
    snapshotHash: "snap-1",
    resolverVersion: "1.3.0",
    predictionsSha256: H2,
  };

  it("accepts valid manifests", () => {
    expect(validateE2AdjudicationManifest(adjM).disagreementCount).toBe(2);
    expect(validateE2EvaluationManifest(evalM).resolverVersion).toBe("1.3.0");
  });

  it("rejects inconsistent reviewers and disagreements", () => {
    expect(() => validateE2AdjudicationManifest({ ...adjM, reviewerIds: ["r1"] })).toThrow(
      /exactly 2 reviewer id\(s\) are expected/,
    );
    expect(() =>
      validateE2AdjudicationManifest({
        ...adjM,
        reviewerIds: ["r1"],
        secondReviewerUsed: false,
      }),
    ).toThrow(/disagreementCount: must be 0 without a second reviewer/);
    expect(() => validateE2AdjudicationManifest({ ...adjM, reviewerIds: ["r1", "r1"] })).toThrow(
      /contains duplicates/,
    );
  });

  it("rejects a wrong language rule and a missing field", () => {
    expect(() => validateE2EvaluationManifest({ ...evalM, resolverLanguageRule: "x" })).toThrow(
      /resolverLanguageRule: must equal E2_RESOLVER_LANGUAGE_RULE/,
    );
    const { predictionsSha256: _p, ...rest } = evalM;
    expect(() => validateE2EvaluationManifest(rest)).toThrow(
      /predictionsSha256: expected a string/,
    );
  });
});

describe("checkE2HashChain", () => {
  // Links are built with the chain's own hash function (a link is defined as that hash); the
  // negative cases below use literals, so a wrong implementation cannot make them pass.
  const sampleOk = validateE2SampleManifest(
    sampleManifest({ populationManifestSha256: e2ManifestHash(popManifest) }),
  ) as E2SampleManifest;
  const adjOk: E2AdjudicationManifest = {
    stage: "adjudication",
    schemaVersion: "1.2.0",
    sampleManifestSha256: e2ManifestHash(sampleOk),
    adjudicationSha256: H4,
    protocolVersion: "protocol-v1",
    reviewerIds: ["r1"],
    secondReviewerUsed: false,
    disagreementCount: 0,
    frozenAt: "2026-12-01T10:00:00Z",
  };
  const evalOk: E2EvaluationManifest = {
    stage: "evaluation",
    schemaVersion: "1.2.0",
    adjudicationManifestSha256: e2ManifestHash(adjOk),
    resolverLanguageRule: E2_RESOLVER_LANGUAGE_RULE,
    snapshotHash: "snap-1",
    resolverVersion: "1.3.0",
    predictionsSha256: H2,
  };

  it("passes an intact chain, and a partial chain", () => {
    expect(
      checkE2HashChain({
        population: popManifest,
        sample: sampleOk,
        adjudication: adjOk,
        evaluation: evalOk,
      }),
    ).toEqual([]);
    expect(checkE2HashChain({ population: popManifest, sample: sampleOk })).toEqual([]);
  });

  it("hashes canonical JSON, so key order does not matter", () => {
    const reordered = {
      ...popManifest,
      stratumCounts: { unknown: 1, uk: 1, ru: 2, en: 6 },
      frameId: popManifest.frameId,
      stage: popManifest.stage,
    };
    expect(e2ManifestHash(reordered)).toBe(e2ManifestHash(popManifest));
    expect(e2ManifestHash(popManifest)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reports each broken link", () => {
    expect(
      checkE2HashChain({
        population: popManifest,
        sample: { ...sampleOk, populationManifestSha256: H1 },
      }),
    ).toEqual(["chain: sample.populationManifestSha256 does not match the population manifest"]);
    expect(
      checkE2HashChain({
        population: popManifest,
        sample: sampleOk,
        adjudication: { ...adjOk, sampleManifestSha256: H1 },
      }),
    ).toEqual(["chain: adjudication.sampleManifestSha256 does not match the sample manifest"]);
    expect(
      checkE2HashChain({
        population: popManifest,
        sample: sampleOk,
        adjudication: adjOk,
        evaluation: { ...evalOk, adjudicationManifestSha256: H1 },
      }),
    ).toEqual([
      "chain: evaluation.adjudicationManifestSha256 does not match the adjudication manifest",
    ]);
  });

  it("detects a rewritten earlier stage", () => {
    const rewritten = {
      ...popManifest,
      populationCount: 11,
      stratumCounts: { en: 7, ru: 2, uk: 1, unknown: 1 },
    };
    const errs = checkE2HashChain({ population: rewritten, sample: sampleOk });
    expect(errs).toContain(
      "chain: sample.populationManifestSha256 does not match the population manifest",
    );
  });

  it("reports N_h that differs from the population, a stage gap and n above N", () => {
    const skewed = {
      ...popManifest,
      stratumCounts: { en: 5, ru: 2, uk: 1, unknown: 1 },
      populationCount: 9,
    };
    const s2 = { ...sampleOk, populationManifestSha256: e2ManifestHash(skewed) };
    expect(checkE2HashChain({ population: skewed, sample: s2 })).toEqual([
      "chain: stratum en has N_h 6 in the sample but 5 in the population",
    ]);
    expect(checkE2HashChain({ population: popManifest, evaluation: evalOk })).toEqual([
      "chain: a later stage is present without the sample manifest",
      "chain: the evaluation manifest is present without the adjudication manifest",
    ]);
  });
});

describe("isolation from schemas 1.0.0 and 1.1.0", () => {
  it("keeps the supported versions unchanged", () => {
    expect(SEMANTIC_EVAL_SCHEMA_VERSION).toBe("1.0.0");
    expect(SEMANTIC_EVAL_SCHEMA_VERSION_1_1).toBe("1.1.0");
    expect([...SUPPORTED_SCHEMA_VERSIONS]).toEqual(["1.0.0", "1.1.0"]);
  });

  it("rejects a 1.2.0 record in the old validateExample, even with every old field present", () => {
    const old = {
      exampleId: H1,
      sourceClusterId: "sc1",
      evidenceClusterId: "ec1",
      source: { id: "s1" },
      excerpt: EN_TEXT,
      language: "en",
      rawKey: "range",
      context: {},
      family: "range",
      stratum: "en|range|resolved",
      resolverStatus: "resolved",
      origin: "historical",
      isPilot: true,
      frameId: "frame-1",
      schemaVersion: "1.0.0",
    };
    expect(validateExample(old).schemaVersion).toBe("1.0.0");
    expect(() => validateExample({ ...old, schemaVersion: "1.2.0" })).toThrow(
      /schemaVersion: expected one of 1.0.0, 1.1.0, got 1.2.0/,
    );
    expect(() => validateExample(example())).toThrow();
  });

  it("rejects a 1.0.0 or 1.1.0 record in the E2 validator", () => {
    expect(() => validateE2Example(example({ schemaVersion: "1.0.0" }))).toThrow(
      /schemaVersion: expected 1.2.0/,
    );
  });
});
