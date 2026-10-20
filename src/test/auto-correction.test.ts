import { describe, expect, it } from "vitest";
import { detectCorrection } from "@/entities/drone/auto-correction";
import { consensus } from "@/entities/drone/consensus";
import { autoCorrect, correctionTrust } from "@/shared/infra/ingest/auto-correct";
import { needsCheck } from "@/shared/infra/ingest/contradictions";
import { TRUST_MIN_REVIEWS } from "@/shared/infra/ingest/earned-trust";
import { createCatalogMutations } from "@/shared/infra/catalog-operations";
import type {
  AutoCorrection,
  Candidate,
  ClaimReview,
  Drone,
  SpecAttribute,
  SpecClaim,
} from "@/entities/drone/types";
import type { CandidateRepository, DroneRepository } from "@/shared/contracts/repository";

const AT = "2026-10-20T12:00:00.000Z";
const NOW = Date.parse(AT);

const point = (value: number, unit: string, source: string, over: Partial<SpecClaim> = {}) => ({
  value,
  source,
  date: "2026-10-01T00:00:00.000Z",
  normalized: {
    raw: `${value} ${unit}`,
    canonicalValue: value,
    canonicalUnit: unit,
    confidence: 1,
  },
  ...over,
});

const spec = (
  semantic: string,
  unit: string,
  claims: SpecClaim[],
  key = semantic.replace(".", "_"),
): SpecAttribute => ({
  key,
  label: key,
  unit,
  semantic,
  canonicalUnit: unit,
  discoveredBy: "ai",
  claims,
});

const range = (...claims: SpecClaim[]) => spec("range.max", "km", claims);

const drone = (id: string, specs: SpecAttribute[]): Drone => ({
  id,
  name: id,
  aliases: [],
  domain: "Air",
  origin: "RU",
  operators: [],
  propulsion: "Unknown",
  summary: "",
  specs,
  rf: [],
  components: [],
  evolution: [],
  counterpartIds: [],
  createdAt: "",
  updatedAt: "",
});

function repo(initial: Drone[]) {
  const ds = initial.map((d) => structuredClone(d));
  const drones = {
    list: () => ds,
    get: (id: string) => ds.find((d) => d.id === id),
    upsert: (d: Drone) => {
      const i = ds.findIndex((x) => x.id === d.id);
      if (i >= 0) ds[i] = d;
      else ds.push(d);
    },
    remove: () => {},
    search: () => ds,
  } as DroneRepository;
  return { drones, all: () => ds };
}

/** Two agreeing outlets and one that read metres as kilometres. */
const slipped = () =>
  range(point(40, "km", "Militarnyi"), point(41, "km", "TWZ"), point(40_000, "km", "Rybar"));

describe("detectCorrection", () => {
  it("reads a figure off by exactly a unit factor from agreeing sources as a unit slip", () => {
    expect(detectCorrection(slipped(), 2, AT)).toMatchObject({
      kind: "unit",
      basis: "consensus",
      value: 40,
      unit: "km",
      factor: 0.001,
      applied: false,
    });
    // m/s written as km/h: 30 against 108.
    const speed = spec("speed.max", "km/h", [
      point(108, "km/h", "a"),
      point(110, "km/h", "b"),
      point(30, "km/h", "c"),
    ]);
    expect(detectCorrection(speed, 2, AT)).toMatchObject({ kind: "unit", value: 108, factor: 3.6 });
  });

  it("leaves a disagreement that no conversion explains to the contradiction check", () => {
    const disputed = range(point(40, "km", "a"), point(40, "km", "b"), point(90, "km", "c"));
    expect(detectCorrection(disputed, 2, AT)).toBeUndefined();
    // Agreeing claims are never touched.
    expect(detectCorrection(slipped(), 0, AT)).toBeUndefined();
  });

  it("needs two other agreeing sources before correcting against them", () => {
    const pair = range(point(40, "km", "a"), point(40_000, "km", "b"));
    // With one other source either could be the slip; bounds decide instead.
    expect(detectCorrection(pair, 0, AT)).toBeUndefined();
    expect(detectCorrection(pair, 1, AT)).toMatchObject({
      kind: "unit",
      basis: "bounds",
      value: 40,
    });
  });

  it("corrects a lone out-of-bounds figure by the common slip, or calls it implausible", () => {
    expect(detectCorrection(range(point(0.02, "km", "a")), 0, AT)).toMatchObject({
      kind: "unit",
      basis: "bounds",
      value: 20,
      factor: 1000,
    });
    const absurd = spec("speed.max", "km/h", [point(90_000, "km/h", "a")]);
    expect(detectCorrection(absurd, 0, AT)).toMatchObject({ kind: "implausible", basis: "bounds" });
    expect(detectCorrection(range(point(40, "km", "a")), 0, AT)).toBeUndefined();
  });

  it("never flags an analyst's own value, text or a range", () => {
    const own = range(
      point(40, "km", "a"),
      point(40, "km", "b"),
      point(40_000, "km", "Analyst", { extractionEngine: "analyst" }),
    );
    expect(detectCorrection(own, 2, AT)).toBeUndefined();
    const text = range({ value: "classified", source: "a", date: AT });
    expect(detectCorrection(text, 0, AT)).toBeUndefined();
  });
});

const review = (verdict: ClaimReview["verdict"]): ClaimReview =>
  verdict === "rejected"
    ? { verdict, issue: "unit", at: AT, by: "analyst" }
    : { verdict, at: AT, by: "analyst" };

/** A drone whose slipped claim was found, and answered, before. */
const answered = (id: string, verdict: ClaimReview["verdict"]): Drone => {
  const s = slipped();
  const fix = detectCorrection(s, 2, AT)!;
  s.claims[2] = { ...s.claims[2]!, autoCorrection: fix, review: review(verdict) };
  return drone(id, [s]);
};

const history = (agreeing: number, disagreeing = 0) => [
  ...Array.from({ length: agreeing }, (_, i) => answered(`yes-${i}`, "rejected")),
  ...Array.from({ length: disagreeing }, (_, i) => answered(`no-${i}`, "confirmed")),
];

describe("autoCorrect", () => {
  it("only proposes a correction analysts have not yet earned it for", () => {
    const { drones, all } = repo([drone("lancet-3", [slipped()])]);
    const rep = autoCorrect(drones, { now: NOW });
    expect(rep).toMatchObject({ proposed: 1, applied: 0 });
    const s = all()[0]!.specs[0]!;
    expect(s.claims[2]!.autoCorrection).toMatchObject({ kind: "unit", applied: false });
    // Consensus still reads the figure as written, so the dispute stands.
    expect(consensus(s).disputed).toBe(true);
  });

  it("applies it once analysts agree, which settles the dispute without a model", () => {
    const { drones, all } = repo([drone("lancet-3", [slipped()]), ...history(TRUST_MIN_REVIEWS)]);
    expect(correctionTrust(all()).get("unit:consensus")!.state).toBe("earned");
    const rep = autoCorrect(drones, { now: NOW });
    expect(rep.applied).toBe(1);
    const s = all().find((d) => d.id === "lancet-3")!.specs[0]!;
    expect(consensus(s)).toMatchObject({ display: "40 km", disputed: false, sources: 3 });
    expect(needsCheck(s)).toBe(false);
    // The claim itself is untouched: the report said what it said.
    expect(s.claims[2]!.value).toBe(40_000);
  });

  it("keeps every finding a proposal when applying is switched off", () => {
    const { drones } = repo([drone("lancet-3", [slipped()]), ...history(TRUST_MIN_REVIEWS)]);
    expect(autoCorrect(drones, { now: NOW, apply: false }).applied).toBe(0);
  });

  it("un-applies a kind of correction as soon as agreement falls", () => {
    const { drones, all } = repo([drone("lancet-3", [slipped()]), ...history(TRUST_MIN_REVIEWS)]);
    autoCorrect(drones, { now: NOW });
    // Analysts now disagree often enough to take the trust away again.
    for (const d of history(0, 2)) drones.upsert(d);
    const rep = autoCorrect(drones, { now: NOW + 1 });
    expect(rep.withdrawn).toBe(1);
    const fix = all().find((d) => d.id === "lancet-3")!.specs[0]!.claims[2]!.autoCorrection;
    expect(fix?.applied).toBe(false);
  });

  it("leaves a claim an analyst has ruled on exactly as it is", () => {
    const before = answered("reviewed", "confirmed");
    const { drones, all } = repo([before]);
    expect(autoCorrect(drones, { now: NOW + 5 })).toMatchObject({ proposed: 0, withdrawn: 0 });
    expect(all()[0]).toEqual(before);
  });
});

describe("reviewCorrection", () => {
  const setup = () => {
    const s = slipped();
    const fix: AutoCorrection = detectCorrection(s, 2, AT)!;
    s.claims[2] = { ...s.claims[2]!, autoCorrection: fix };
    const { drones, all } = repo([drone("lancet-3", [s])]);
    const candidates = { list: () => [] as Candidate[] } as unknown as CandidateRepository;
    return { catalog: createCatalogMutations({ drones, candidates }), all, claim: s.claims[2]! };
  };

  it("accepting a unit correction rejects the misread figure and adds the corrected one", () => {
    const { catalog, all, claim } = setup();
    catalog.reviewCorrection("lancet-3", "range_max", claim, true);
    const claims = all()[0]!.specs[0]!.claims;
    expect(claims[2]!.review).toMatchObject({ verdict: "rejected", issue: "unit" });
    // The finding stays: it is what the corrector's trust is measured on.
    expect(claims[2]!.autoCorrection?.kind).toBe("unit");
    expect(claims[3]).toMatchObject({ source: "Analyst", value: 40 });
    expect(correctionTrust(all()).get("unit:consensus")).toMatchObject({ agreed: 1, disagreed: 0 });
  });

  it("keeping the figure confirms it and counts against the corrector", () => {
    const { catalog, all, claim } = setup();
    catalog.reviewCorrection("lancet-3", "range_max", claim, false);
    expect(all()[0]!.specs[0]!.claims[2]!.review?.verdict).toBe("confirmed");
    expect(correctionTrust(all()).get("unit:consensus")).toMatchObject({ agreed: 0, disagreed: 1 });
  });
});
