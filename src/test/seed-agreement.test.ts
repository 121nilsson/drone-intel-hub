import { describe, expect, it } from "vitest";
import {
  readWith,
  scoreSeedAnswers,
  seedExpectations,
  type SeedAnswerRow,
} from "@/shared/infra/evaluation/seed-agreement";
import type { IntelExtractor } from "@/shared/contracts/ai";
import type { ExtractedSpec, Extraction } from "@/entities/drone/types";

const row = (over: Partial<SeedAnswerRow>): SeedAnswerRow => ({
  specKey: "range",
  specLabel: "Range",
  value: "40 km",
  postText: "Lancet-3 strike: range 40 km near Kupiansk. Reported by the regional desk this week.",
  answer: "yes",
  ...over,
});

const extraction = (specs: Extraction["specs"]): Extraction => ({
  aliases: [],
  operators: [],
  specs,
  rfBands: [],
  confidence: 0.5,
  rationale: "",
});

const reader = (specs: ExtractedSpec[]): IntelExtractor => ({
  tier: 1,
  label: "fake",
  extract: async () => extraction(specs),
});

const range = (value: string): ExtractedSpec => ({ key: "range", label: "Range", value });

describe("seedExpectations", () => {
  it("reads the source's own figure, and accepts the catalogue's conversion beside it", () => {
    const e = seedExpectations(row({ value: "40 kn (≈ 74.08 km/h)" }));
    // Both readings canonicalize the same way, so a post stating either figure matches.
    expect(e.length).toBeGreaterThanOrEqual(1);
    expect(e[0]).toMatchObject({ semantic: "range.max", value: 74.08, unit: "km/h" });
  });

  it("keeps a text value as a string", () => {
    const e = seedExpectations(
      row({ specKey: "guidance", specLabel: "Guidance", value: "optical" }),
    );
    expect(e[0]).toMatchObject({ value: "optical" });
  });
});

describe("scoreSeedAnswers", () => {
  it("counts a stated figure the heuristic reads as found", async () => {
    const r = await scoreSeedAnswers([row({})], (t) => readWith(reader([range("40 km")]), [], t));
    expect(r).toMatchObject({ scored: 1, found: 1, missed: 0, errors: 0, agreement: 1 });
  });

  it("counts a stated figure the heuristic lost as an error", async () => {
    const r = await scoreSeedAnswers([row({})], (t) => readWith(reader([]), [], t));
    expect(r).toMatchObject({ scored: 1, found: 0, missed: 1, errors: 1, agreement: 0 });
  });

  it("counts a figure the post does not state, but the heuristic produces, as an error", async () => {
    const r = await scoreSeedAnswers([row({ answer: "no", value: "4 km" })], (t) =>
      readWith(reader([range("4 km")]), [], t),
    );
    expect(r).toMatchObject({ scored: 1, avoided: 0, invented: 1, errors: 1 });
  });

  it("counts a figure the heuristic correctly leaves out as avoided", async () => {
    const r = await scoreSeedAnswers([row({ answer: "no", value: "4 km" })], (t) =>
      readWith(reader([range("40 km")]), [], t),
    );
    expect(r).toMatchObject({ scored: 1, avoided: 1, invented: 0, errors: 0 });
  });

  it("excludes cannot-tell answers and reports them", async () => {
    const r = await scoreSeedAnswers([row({ answer: "cannot_tell" }), row({})], (t) =>
      readWith(reader([range("40 km")]), [], t),
    );
    expect(r).toMatchObject({ cannotTell: 1, scored: 1, found: 1 });
  });

  it("scores an obviously-wrong stated figure as a reading, not an error", async () => {
    const r = await scoreSeedAnswers([row({ obviouslyWrong: true })], (t) =>
      readWith(reader([range("40 km")]), [], t),
    );
    expect(r).toMatchObject({ obviouslyWrong: 1, found: 1, errors: 0 });
  });

  it("skips a failed read instead of calling it an error", async () => {
    const r = await scoreSeedAnswers([row({})], async () => null);
    expect(r).toMatchObject({ scored: 0, skipped: 1, errors: 0 });
  });

  it("reads a post shared by two seed claims once", async () => {
    let reads = 0;
    const r = await scoreSeedAnswers([row({}), row({ answer: "no", value: "4 km" })], async (t) => {
      reads++;
      return readWith(reader([range("40 km")]), [], t);
    });
    expect(reads).toBe(1);
    expect(r).toMatchObject({ scored: 2, found: 1, avoided: 1 });
  });
});
