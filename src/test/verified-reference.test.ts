import { describe, expect, it } from "vitest";
import { normalizeExtraction } from "@/entities/normalization/apply";
import {
  compareSpecs,
  comparableSpecs,
  comparisonCoverage,
  coverageOf,
  evaluateHeuristic,
  mergeCoverage,
  queueFixtures,
  verifiedFixtures,
  verifiedReference,
  verifiedVerdicts,
} from "@/shared/infra/evaluation/evaluation";
import type { IntelExtractor } from "@/shared/contracts/ai";
import type {
  Candidate,
  ClaimIssue,
  ClaimReview,
  ClaimVerification,
  Drone,
  ExtractedSpec,
  ExtractedSpec as Spec,
  SpecClaim,
  VerificationState,
} from "@/entities/drone/types";

const AT = "2026-10-20T12:00:00.000Z";
const SOURCE = "Rybar · https://t.me/rybar/1";
const TEXT = "Lancet-3 strike near Kupiansk: range 40 km, warhead 3 kg, speed 300 km/h.";

const review = (verdict: ClaimReview["verdict"], issue?: ClaimIssue): ClaimReview => ({
  verdict,
  ...(issue ? { issue } : {}),
  at: AT,
  by: "analyst",
});
const verified = (state: VerificationState): ClaimVerification => ({
  state,
  checks: [],
  confidence: state === "verified" ? 0.9 : 0,
  coverage: 1,
  independentSources: 1,
  verifierVersion: "deterministic-6",
  at: AT,
});

const claim = (value: number, over: Partial<SpecClaim> = {}): SpecClaim => ({
  value: `${value} km`,
  source: SOURCE,
  date: AT,
  normalized: { raw: `${value} km`, canonicalValue: value, canonicalUnit: "km", confidence: 1 },
  ...over,
});

const drone = (id: string, claims: SpecClaim[]): Drone => ({
  id,
  name: id,
  aliases: [],
  domain: "Air",
  origin: "RU",
  operators: [],
  propulsion: "Unknown",
  summary: "",
  specs: [{ key: "range", label: "Range", semantic: "range.max", discoveredBy: "ai", claims }],
  rf: [],
  components: [],
  evolution: [],
  counterpartIds: [],
  createdAt: "",
  updatedAt: "",
});

const candidate = (id: string, resolvedInto: string, specs: Spec[]): Candidate => ({
  id,
  raw: TEXT,
  source: SOURCE,
  createdAt: AT,
  tier: 1,
  status: "merged",
  resolvedInto,
  extraction: normalizeExtraction({
    aliases: [],
    operators: [],
    specs,
    rfBands: [],
    confidence: 0.9,
    rationale: "",
  }).extraction,
});

const range = (value: string, over: Partial<ExtractedSpec> = {}): ExtractedSpec => ({
  key: "range",
  label: "Range",
  value,
  ...over,
});

const heurOf = (c: Candidate) => comparableSpecs(normalizeExtraction(c.extraction).extraction);

/** Extractor that always reads the given specs, standing in for the heuristic. */
const reads = (...specs: ExtractedSpec[]): IntelExtractor => ({
  tier: 1,
  label: "heuristic",
  extract: async () => ({
    aliases: [],
    operators: [],
    specs,
    rfBands: [],
    confidence: 0.5,
    rationale: "",
  }),
});

describe("verifiedReference", () => {
  it("scores a verifier-passed claim as a positive even though the AI dropped it", () => {
    const catalog = [drone("lancet-3", [claim(40, { verification: verified("verified") })])];
    const c = candidate("c1", "lancet-3", [range("40 km", { provenance: "heuristic" })]);
    const cmp = compareSpecs(heurOf(c), verifiedReference(c, verifiedVerdicts(catalog)));
    expect(cmp.pairs).toHaveLength(1);
    expect(cmp.rejected).toHaveLength(0);
    expect(cmp.misses).toHaveLength(0);
  });

  it("scores a verifier-rejected claim as an expected negative", () => {
    const catalog = [drone("lancet-3", [claim(40, { verification: verified("rejected") })])];
    const c = candidate("c1", "lancet-3", [range("40 km")]);
    const cmp = compareSpecs(heurOf(c), verifiedReference(c, verifiedVerdicts(catalog)));
    expect(cmp.pairs).toHaveLength(0);
    expect(cmp.rejected).toHaveLength(1);
    expect(cmp.misses).toHaveLength(0);
  });

  it("leaves an uncertain claim out: neither a miss nor a false positive", () => {
    const catalog = [drone("lancet-3", [claim(40, { verification: verified("uncertain") })])];
    const c = candidate("c1", "lancet-3", [range("40 km")]);
    const cmp = compareSpecs(heurOf(c), verifiedReference(c, verifiedVerdicts(catalog)));
    expect(cmp.pairs).toHaveLength(0);
    expect(cmp.falsePositives).toHaveLength(0);
    expect(cmp.rejected).toHaveLength(0);
    expect(cmp.misses).toHaveLength(0);
    expect(cmp.excluded).toHaveLength(1);
  });

  it("an analyst's verdict overrides the verifier in both directions", () => {
    const confirmedOver = [
      drone("lancet-3", [
        claim(40, { verification: verified("rejected"), review: review("confirmed") }),
      ]),
    ];
    const c = candidate("c1", "lancet-3", [range("40 km")]);
    expect(
      compareSpecs(heurOf(c), verifiedReference(c, verifiedVerdicts(confirmedOver))).pairs,
    ).toHaveLength(1);

    const rejectedOver = [
      drone("lancet-3", [
        claim(40, { verification: verified("verified"), review: review("rejected", "unit") }),
      ]),
    ];
    const cmp = compareSpecs(heurOf(c), verifiedReference(c, verifiedVerdicts(rejectedOver)));
    expect(cmp.pairs).toHaveLength(0);
    expect(cmp.rejected).toHaveLength(1);
  });

  it("keeps the stored reading when nobody has judged the claim", () => {
    const catalog = [drone("lancet-3", [claim(40)])];
    const c = candidate("c1", "lancet-3", [range("40 km")]);
    const ref = verifiedReference(c, verifiedVerdicts(catalog));
    expect(ref[0]!.verdict).toBeUndefined();
    expect(ref[0]!.verification).toBeUndefined();
    expect(compareSpecs(heurOf(c), ref).pairs).toHaveLength(1);
  });

  it("ignores hand-entered claims, which have no report", () => {
    const catalog = [
      drone("lancet-3", [
        claim(40, { source: "Analyst", extractionEngine: "analyst", review: review("confirmed") }),
      ]),
    ];
    const c = candidate("c1", "lancet-3", [range("40 km")]);
    expect(verifiedVerdicts(catalog).size).toBe(0);
    expect(verifiedReference(c, verifiedVerdicts(catalog))).toHaveLength(1);
  });
});

describe("reference coverage", () => {
  it("buckets every reference claim exactly once", () => {
    const catalog = [
      drone("lancet-3", [
        claim(40, { verification: verified("verified") }),
        claim(4, { verification: verified("rejected") }),
        claim(400, { verification: verified("uncertain") }),
        claim(41, { review: review("confirmed") }),
        claim(42),
        claim(43),
      ]),
    ];
    const c = candidate("c1", "lancet-3", [
      range("40 km"),
      range("4 km"),
      range("400 km"),
      range("41 km"),
      range("42 km"),
      range("43 km", { provenance: "heuristic" }),
    ]);
    const cmp = compareSpecs(heurOf(c), verifiedReference(c, verifiedVerdicts(catalog)));
    const cov = comparisonCoverage(cmp);
    expect(cov).toMatchObject({
      scored: 5,
      verified: 1,
      rejected: 1,
      analyst: 1,
      unverified: 1,
      dropped: 1,
      uncertain: 1,
    });
    expect(cov.ratio).toBeCloseTo(3 / 5);
  });

  it("reports 0 ratio on an unverified fallback and merges across runs", () => {
    const cov = coverageOf(
      comparableSpecs(candidate("c1", "lancet-3", [range("40 km")]).extraction),
    );
    expect(cov).toMatchObject({ scored: 1, unverified: 1, ratio: 0 });
    expect(mergeCoverage(cov, cov).scored).toBe(2);
  });

  it("is reported next to the scores in an evaluation run", async () => {
    const catalog = [drone("lancet-3", [claim(40, { verification: verified("verified") })])];
    const c = candidate("c1", "lancet-3", [range("40 km")]);
    const r = await evaluateHeuristic([c], catalog, reads(range("40 km")), { sampleSize: 10 });
    expect(r.summary.tp).toBe(1);
    expect(r.reference).toMatchObject({ scored: 1, verified: 1, ratio: 1 });
    expect(r.perKeyReference["range.max"]).toMatchObject({ verified: 1 });

    const unverified = await evaluateHeuristic([c], [], reads(range("40 km")), { sampleSize: 10 });
    expect(unverified.reference).toMatchObject({ scored: 1, unverified: 1, ratio: 0 });
  });

  it("counts an uncertain claim as left out, not as a miss or a hit", async () => {
    const catalog = [drone("lancet-3", [claim(40, { verification: verified("uncertain") })])];
    const c = candidate("c1", "lancet-3", [range("40 km")]);
    const r = await evaluateHeuristic([c], catalog, reads(range("40 km")), { sampleSize: 10 });
    expect(r.summary).toMatchObject({ tp: 0, fp: 0, fn: 0 });
    expect(r.reference).toMatchObject({ scored: 0, uncertain: 1, ratio: 0 });
  });
});

describe("verifiedFixtures", () => {
  it("turns verified figures into expectations and rejected ones into forbids", () => {
    const catalog = [
      drone("lancet-3", [
        claim(40, { verification: verified("verified") }),
        claim(4, { verification: verified("rejected") }),
        claim(400, { verification: verified("uncertain") }),
      ]),
    ];
    const c = candidate("c1", "lancet-3", [range("40 km"), range("4 km"), range("400 km")]);
    const fixtures = verifiedFixtures([c], verifiedVerdicts(catalog));
    expect(fixtures).toEqual([
      expect.objectContaining({
        id: "verified-c1",
        expect: [{ semantic: "range.max", value: 40, unit: "km" }],
      }),
      expect.objectContaining({
        id: "verified-neg-c1",
        expect: [],
        forbid: [{ semantic: "range.max", value: 4, unit: "km" }],
      }),
    ]);
  });

  it("keeps the review- fixture id when an analyst ruled, beside machine verification", () => {
    const catalog = [
      drone("lancet-3", [
        claim(40, { verification: verified("verified"), review: review("confirmed") }),
        claim(4, { verification: verified("rejected") }),
      ]),
    ];
    const c = candidate("c1", "lancet-3", [range("40 km"), range("4 km")]);
    const fixtures = verifiedFixtures([c], verifiedVerdicts(catalog));
    expect(fixtures.map((f) => f.id)).toEqual(["review-c1", "review-neg-c1"]);
  });

  it("yields nothing when verification could not decide", () => {
    const catalog = [drone("lancet-3", [claim(40, { verification: verified("uncertain") })])];
    const c = candidate("c1", "lancet-3", [range("40 km")]);
    expect(verifiedFixtures([c], verifiedVerdicts(catalog))).toEqual([]);
  });
});

describe("queueFixtures with verified claims", () => {
  it("leaves an uncertain figure out of a promoted report's expectations", () => {
    const catalog = [drone("lancet-3", [claim(40, { verification: verified("uncertain") })])];
    const c = {
      ...candidate("c1", "lancet-3", [
        range("40 km"),
        { key: "speed", label: "Speed", value: "300 km/h" } as ExtractedSpec,
      ]),
      resolvedBy: "analyst" as const,
    };
    const [fx] = queueFixtures([c], verifiedVerdicts(catalog));
    expect(fx!.expect).toEqual([{ semantic: "speed.stated", value: 300, unit: "km/h" }]);
  });
});
