import { describe, expect, it } from "vitest";
import { normalizeExtraction } from "@/entities/normalization/apply";
import {
  analystCorpus,
  analystFixtures,
  analystVerdicts,
  queueFixtures,
  compareSpecs,
  comparableSpecs,
  referenceSpecs,
} from "@/shared/infra/evaluation/evaluation";
import {
  CONTRADICTION_CONFIDENCE,
  EARNED_CONFIDENCE,
  TRUST_MIN_REVIEWS,
  adjudicateContradictions,
  checkTrust,
} from "@/shared/infra/ingest/contradictions";
import type { IntelExtractor } from "@/shared/contracts/ai";
import type { DroneRepository } from "@/shared/contracts/repository";
import type {
  Candidate,
  ClaimIssue,
  ClaimReview,
  Drone,
  ExtractedSpec,
  SpecClaim,
} from "@/entities/drone/types";

const AT = "2026-10-20T12:00:00.000Z";
const SOURCE = "Rybar · https://t.me/rybar/1";
const TEXT = "Lancet-3 strike near Kupiansk: range 40 km, warhead 3 kg, speed 300 km/h.";

const rejected = (issue: ClaimIssue): ClaimReview => ({
  verdict: "rejected",
  issue,
  at: AT,
  by: "analyst",
});
const confirmed: ClaimReview = { verdict: "confirmed", at: AT, by: "analyst" };

const km = (value: number, over: Partial<SpecClaim> = {}): SpecClaim => ({
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

const candidate = (id: string, resolvedInto: string, specs: ExtractedSpec[]): Candidate => ({
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

describe("the evaluation reference with analyst verdicts", () => {
  it("scores a heuristic figure the analyst rejected as rejected, not as agreement", () => {
    const catalog = [drone("lancet-3", [km(40, { review: rejected("unit") })])];
    const c = candidate("c1", "lancet-3", [range("40 km")]);
    const heur = comparableSpecs(normalizeExtraction(c.extraction).extraction);

    // Without the verdict the heuristic agrees with the stored extraction.
    expect(compareSpecs(heur, comparableSpecs(c.extraction)).pairs).toHaveLength(1);
    const cmp = compareSpecs(heur, referenceSpecs(c, analystVerdicts(catalog)));
    expect(cmp.pairs).toHaveLength(0);
    expect(cmp.rejected).toHaveLength(1);
    expect(cmp.misses).toHaveLength(0);
  });

  it("counts a confirmed figure even though the AI dropped it", () => {
    const catalog = [drone("lancet-3", [km(40, { review: confirmed })])];
    const c = candidate("c1", "lancet-3", [range("40 km", { provenance: "heuristic" })]);
    const heur = comparableSpecs(normalizeExtraction(c.extraction).extraction);
    expect(compareSpecs(heur, comparableSpecs(c.extraction)).rejected).toHaveLength(1);
    expect(compareSpecs(heur, referenceSpecs(c, analystVerdicts(catalog))).pairs).toHaveLength(1);
  });

  it("applies a verdict only to the candidate that fed that entry", () => {
    // One report, two systems: the figure was rejected on one entry only.
    const catalog = [
      drone("lancet-3", [km(40, { review: rejected("system") })]),
      drone("geran-2", [km(40)]),
    ];
    const verdicts = analystVerdicts(catalog);
    const other = candidate("c2", "geran-2", [range("40 km")]);
    expect(referenceSpecs(other, verdicts)[0]!.verdict).toBeUndefined();
    expect(
      referenceSpecs(candidate("c1", "lancet-3", [range("40 km")]), verdicts)[0]!.verdict,
    ).toBe("rejected");
  });
});

describe("analystFixtures", () => {
  it("turns confirmed figures into expectations and rejected ones into forbids", () => {
    const catalog = [
      drone("lancet-3", [
        km(40, { review: confirmed }),
        km(4, { review: rejected("unit") }),
        km(400, { review: rejected("system") }),
        // A hand-entered correction is the analyst's own claim, not a verdict on the report.
        km(41, { source: "Analyst", extractionEngine: "analyst", review: confirmed }),
      ]),
    ];
    const c = candidate("c1", "lancet-3", [range("40 km"), range("4 km"), range("400 km")]);
    const fixtures = analystFixtures([c], analystVerdicts(catalog));
    expect(fixtures).toEqual([
      expect.objectContaining({
        id: "review-c1",
        text: TEXT,
        expect: [{ semantic: "range.max", value: 40, unit: "km" }],
      }),
      expect.objectContaining({
        id: "review-neg-c1",
        expect: [],
        // "About another system" is not forbidden: the figure may be right for the other system.
        forbid: [{ semantic: "range.max", value: 4, unit: "km" }],
      }),
    ]);
  });

  it("sorts fixtures for the git corpora by what today's heuristic does", async () => {
    const catalog = [
      drone("lancet-3", [km(40, { review: confirmed }), km(4, { review: rejected("value") })]),
    ];
    const c = candidate("c1", "lancet-3", [range("40 km"), range("4 km")]);
    // Still produces the rejected figure: the negative is pending a fix, the positive passes.
    const still = await analystCorpus([c], catalog, reads(range("40 km"), range("4 km")));
    expect(still.positive.map((f) => f.id)).toEqual(["review-c1"]);
    expect(still.negative).toEqual([expect.objectContaining({ status: "pending_fix" })]);
    // Lost the confirmed figure and stopped producing the rejected one.
    const fixed = await analystCorpus([c], catalog, reads());
    expect(fixed.positive).toEqual([]);
    expect(fixed.negative).toEqual([expect.objectContaining({ status: "approved" })]);
  });
});

describe("contradiction-check trust", () => {
  const judged = (agree: boolean, i: number): SpecClaim =>
    km(40 + i, {
      source: `outlet-${i}`,
      adjudication: { verdict: "outlier", confidence: 0.9, at: AT },
      review: agree ? rejected("value") : confirmed,
    });

  it("is earned per family from analysts agreeing with the check", () => {
    const agreeing = Array.from({ length: TRUST_MIN_REVIEWS }, (_, i) => judged(true, i));
    expect(checkTrust([drone("a", agreeing)]).get("range")).toMatchObject({
      state: "earned",
      bar: EARNED_CONFIDENCE,
    });
    expect(checkTrust([drone("a", agreeing.slice(1))]).get("range")!.state).toBe("default");
    const split = Array.from({ length: 10 }, (_, i) => judged(i % 2 === 0, i));
    expect(checkTrust([drone("a", split)]).get("range")!.state).toBe("distrusted");
  });

  it("lets an earned family record a less certain pick", async () => {
    const history = drone(
      "history",
      Array.from({ length: TRUST_MIN_REVIEWS }, (_, i) => judged(true, i)),
    );
    const contested = drone("lancet-3", [
      km(40, { source: "a" }),
      km(40, { source: "b" }),
      km(90, { source: "c" }),
    ]);
    const confidence = (EARNED_CONFIDENCE + CONTRADICTION_CONFIDENCE) / 2;
    const run = async (catalog: Drone[]) => {
      const ds = catalog.map((d) => structuredClone(d));
      const repo = {
        list: () => ds,
        get: (id: string) => ds.find((d) => d.id === id),
        upsert: (d: Drone) => {
          ds[ds.findIndex((x) => x.id === d.id)] = d;
        },
        remove: () => {},
        search: () => ds,
      } as DroneRepository;
      return adjudicateContradictions(repo, {
        adjudicate: async () => ({ supported: 0, confidence }),
        now: Date.parse(AT) + 1000,
      });
    };
    expect((await run([contested])).outliers).toBe(0);
    expect((await run([contested, history])).outliers).toBe(2);
  });
});

describe("queueFixtures", () => {
  const speed = (value: string, over: Partial<ExtractedSpec> = {}): ExtractedSpec => ({
    key: "speed",
    label: "Speed",
    value,
    ...over,
  });

  it("keeps the figures of a report an analyst promoted or merged, as the reference reads them", () => {
    const catalog = [drone("lancet-3", [km(40, { review: rejected("value") })])];
    const c = {
      ...candidate("c1", "lancet-3", [
        range("40 km"),
        speed("300 km/h"),
        // The AI dropped this one: it is not a figure the analyst accepted.
        speed("3 km/h", { key: "speed_cruise", label: "Cruise speed", provenance: "heuristic" }),
      ]),
      resolvedBy: "analyst" as const,
    };
    const [fx] = queueFixtures([c], analystVerdicts(catalog));
    // Range is out too: an analyst rejected that figure on the catalog entry.
    expect(fx).toMatchObject({
      id: "queue-c1",
      text: TEXT,
      status: "approved",
      expect: [{ semantic: "speed.stated", value: 300, unit: "km/h" }],
    });
  });

  it("yields nothing for a discarded report, or one resolved automatically", () => {
    const base = candidate("c1", "lancet-3", [range("40 km")]);
    const verdicts = analystVerdicts([]);
    expect(
      queueFixtures([{ ...base, status: "discarded", resolvedBy: "analyst" }], verdicts),
    ).toEqual([]);
    expect(queueFixtures([{ ...base, resolvedBy: "auto" }], verdicts)).toEqual([]);
    expect(queueFixtures([{ ...base, resolvedBy: "analyst" }], verdicts)).toHaveLength(1);
  });
});
