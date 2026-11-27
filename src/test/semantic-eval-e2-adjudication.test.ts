/**
 * E2 step c: blind adjudication export, import and the frozen stage (pure functions).
 *
 * Expected values are hand-written literals. The only computed values are hashes, which are
 * defined as `e2ManifestHash` or SHA-256 of file text.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeCsv } from "../entities/normalization/semantic-eval/csv";
import {
  buildE2AdjudicationExport,
  e2AdjudicationsJsonl,
  freezeE2Adjudications,
  parseResolutions,
  parseReviewerCsv,
  type E2AdjudicationInput,
  type E2Resolution,
} from "../entities/normalization/semantic-eval/e2/adjudication";
import { allocateE2 } from "../entities/normalization/semantic-eval/e2/allocation";
import { drawE2Sample } from "../entities/normalization/semantic-eval/e2/draw";
import {
  freezeE2Population as freezePopulationWithHash,
  type E2FreezeOptions,
} from "../entities/normalization/semantic-eval/e2/population";
import type { AdjudicatedLanguage } from "../entities/normalization/semantic-eval/e2/types";
import {
  checkE2HashChain,
  e2ManifestHash,
  validateE2Adjudication,
  validateE2AdjudicationManifest,
} from "../entities/normalization/semantic-eval/e2/validate";
import type { FrameRow } from "../entities/normalization/semantic-eval/types";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const RAW = "a".repeat(64);
const freezeE2Population = (rows: readonly FrameRow[], extra: Partial<E2FreezeOptions> = {}) =>
  freezePopulationWithHash(rows, { rawExportSha256: RAW, ...extra });

const EN = "The aircraft is a long range drone that is used by the army and it has been seen";
const RU = "Беспилотник имеет максимальную скорость сто километров в час при полете";
const UK = "Дрон має максимальну швидкість сто кілометрів на годину і є українським";

function frameRow(i: number, excerpt: string, extra: Partial<FrameRow> = {}): FrameRow {
  return {
    sourceId: `srcid-secret-${i}`,
    url: `https://secret-host-${i}.example/page-${i}`,
    rawKey: `zzkey_${i}`,
    rawLabel: `zzlabel ${i}`,
    rawValue: String(i),
    excerpt: `${excerpt} ${i}`,
    publishedAt: `2026-0${(i % 9) + 1}-01T00:00:00Z`,
    ...extra,
  };
}

// 3 en, 2 ru, 1 uk, 1 unknown; declared languages deliberately unlike the text.
const FRAME: FrameRow[] = [
  frameRow(1, EN, { declaredLanguage: "uk" }),
  frameRow(2, EN, { declaredLanguage: "ru" }),
  frameRow(3, EN),
  frameRow(4, RU, { declaredLanguage: "en" }),
  frameRow(5, RU),
  frameRow(6, UK),
  frameRow(7, "x"),
];

const population = freezeE2Population(FRAME);
const allocation = allocateE2(population.manifest.stratumCounts, 7, 1);
const sample = drawE2Sample(population, allocation, "adj-seed");
const IDS = sample.rows.map((e) => e.exampleId); // sorted by exampleId

function entries(values: readonly AdjudicatedLanguage[]) {
  return IDS.map((exampleId, i) => ({ exampleId, language: values[i]! }));
}

const ALL_FIVE: readonly AdjudicatedLanguage[] = ["en", "ru", "uk", "mixed", "unknown", "en", "ru"];

// Hand-derived from the fixture above: declared rows 1 (uk), 2 (ru) and 4 (en) are compared with
// the final value at the same position in the sorted blind export.
const DECLARED_CONFLICT_IDS = sample.rows
  .filter(
    (e) =>
      e.declaredLanguage !== undefined && ALL_FIVE[IDS.indexOf(e.exampleId)] !== e.declaredLanguage,
  )
  .map((e) => e.exampleId)
  .sort();

function base(over: Partial<E2AdjudicationInput> = {}): E2AdjudicationInput {
  return {
    sampleRows: sample.rows,
    sampleManifest: sample.manifest,
    populationManifest: population.manifest,
    first: { reviewerId: "rev-1", entries: entries(ALL_FIVE) },
    frozenAt: "2026-11-27T12:00:00Z",
    ...over,
  };
}

describe("fixture", () => {
  it("draws all seven examples (census)", () => {
    expect(IDS.length).toBe(7);
  });
});

describe("blind export", () => {
  const csv = buildE2AdjudicationExport(sample.rows);
  const table = decodeCsv(csv);

  it("has exactly the header example_id,excerpt,language and cells id, excerpt, empty", () => {
    expect(table[0]).toEqual(["example_id", "excerpt", "language"]);
    expect(table.length).toBe(8);
    for (const [i, cells] of table.slice(1).entries()) {
      const e = sample.rows.find((r) => r.exampleId === cells[0])!;
      expect(cells).toEqual([e.exampleId, e.excerpt, ""]);
      expect(cells[0]).toBe(IDS[i]);
    }
  });

  it("holds none of the forbidden values or column names", () => {
    const forbiddenValues: string[] = [];
    for (const e of sample.rows) {
      forbiddenValues.push(
        e.source.id,
        e.source.url ?? "",
        e.source.publishedAt ?? "",
        e.rawKey,
        e.rawLabel ?? "",
        e.sourceClusterId,
        e.evidenceClusterId,
        e.family,
        e.frameId,
      );
    }
    for (const v of forbiddenValues.filter((x) => x.length > 0)) {
      expect(csv, `leaked ${v}`).not.toContain(v);
    }
    expect(csv).not.toContain("secret");
    expect(csv).not.toContain("zzkey");
    expect(csv).not.toContain("2026-");
    const forbiddenWords = [
      "routing",
      "stratum",
      "declared",
      "detect",
      "resolver",
      "expected",
      "url",
      "source",
      "published",
      "rawKey",
      "rawLabel",
      "rawValue",
      "family",
      "origin",
      "weight",
      "frame",
      "cluster",
      "claim",
    ];
    for (const w of forbiddenWords) {
      expect(csv.toLowerCase(), `has ${w}`).not.toContain(w.toLowerCase());
    }
  });

  it("orders rows by exampleId (a hash), not by stratum", () => {
    const ids = table.slice(1).map((r) => r[0]!);
    expect(ids).toEqual([...ids].sort());
    const strata = ids.map((id) => sample.rows.find((r) => r.exampleId === id)!.routingStratum);
    expect(new Set(strata).size).toBeGreaterThan(1);
    expect(strata).not.toEqual([...strata].sort());
  });

  it("refuses a sample with two examples in one evidence cluster", () => {
    const dup = [
      sample.rows[0]!,
      { ...sample.rows[1]!, evidenceClusterId: sample.rows[0]!.evidenceClusterId },
    ];
    expect(() => buildE2AdjudicationExport(dup)).toThrow(/share evidenceClusterId/);
  });
});

describe("importing one reviewer", () => {
  it("freezes all five values, sorted by exampleId, and chains", () => {
    const f = freezeE2Adjudications(base());
    expect(f.rows.map((r) => r.exampleId)).toEqual(IDS);
    expect(f.rows.map((r) => r.finalAdjudicatedLanguage)).toEqual([
      "en",
      "ru",
      "uk",
      "mixed",
      "unknown",
      "en",
      "ru",
    ]);
    expect(f.rows.every((r) => !r.disagreement && r.protocolVersion === "e2-lang-1")).toBe(true);
    expect(f.rows[0]!.secondReviewerId).toBeUndefined();
    expect(f.manifest).toEqual({
      stage: "adjudication",
      schemaVersion: "1.2.0",
      sampleManifestSha256: e2ManifestHash(sample.manifest),
      adjudicationSha256: sha(f.jsonl),
      protocolVersion: "e2-lang-1",
      reviewerIds: ["rev-1"],
      secondReviewerUsed: false,
      disagreementCount: 0,
      flaggedDeclaredAdjudicatedConflictCount: DECLARED_CONFLICT_IDS.length,
      flaggedDeclaredAdjudicatedExampleIds: DECLARED_CONFLICT_IDS,
      flaggedIdenticalExcerptConflictCount: 0,
      flaggedIdenticalExcerptConflicts: [],
      frozenAt: "2026-11-27T12:00:00Z",
    });
    expect(f.jsonl).toBe(e2AdjudicationsJsonl(f.rows));
    expect(f.jsonl.endsWith("\n")).toBe(true);
    for (const l of f.jsonl.trim().split("\n")) validateE2Adjudication(JSON.parse(l));
    validateE2AdjudicationManifest(JSON.parse(JSON.stringify(f.manifest)));
  });

  it("does not depend on the order of the reviewer's entries", () => {
    const a = freezeE2Adjudications(base());
    const b = freezeE2Adjudications(
      base({ first: { reviewerId: "rev-1", entries: [...base().first.entries].reverse() } }),
    );
    expect(b.jsonl).toBe(a.jsonl);
  });
});

describe("importing two reviewers", () => {
  it("agreement: no disagreement, final equals the agreed value", () => {
    const f = freezeE2Adjudications(
      base({ second: { reviewerId: "rev-2", entries: entries(ALL_FIVE) } }),
    );
    expect(f.manifest.secondReviewerUsed).toBe(true);
    expect(f.manifest.reviewerIds).toEqual(["rev-1", "rev-2"]);
    expect(f.manifest.disagreementCount).toBe(0);
    expect(f.rows.every((r) => r.secondReviewerId === "rev-2" && !r.disagreement)).toBe(true);
  });

  it("disagreement with explicit resolutions, including a final mixed", () => {
    const second: AdjudicatedLanguage[] = ["ru", "ru", "uk", "unknown", "unknown", "en", "ru"];
    const resolutions: E2Resolution[] = [
      {
        exampleId: IDS[0]!,
        finalAdjudicatedLanguage: "mixed",
        resolvedBy: "rev-3",
        note: "two parts",
      },
      { exampleId: IDS[3]!, finalAdjudicatedLanguage: "unknown", resolvedBy: "rev-3" },
    ];
    const f = freezeE2Adjudications(
      base({ second: { reviewerId: "rev-2", entries: entries(second) }, resolutions }),
    );
    expect(f.manifest.disagreementCount).toBe(2);
    expect(f.rows.map((r) => r.disagreement)).toEqual([
      true,
      false,
      false,
      true,
      false,
      false,
      false,
    ]);
    expect(f.rows[0]).toMatchObject({
      reviewerLanguage: "en",
      secondReviewerLanguage: "ru",
      finalAdjudicatedLanguage: "mixed",
      resolvedBy: "rev-3",
      note: "two parts",
    });
    expect(f.rows[3]).toMatchObject({
      reviewerLanguage: "mixed",
      secondReviewerLanguage: "unknown",
      finalAdjudicatedLanguage: "unknown",
      resolvedBy: "rev-3",
    });
    expect(f.rows[1]!.resolvedBy).toBeUndefined();
  });

  it("refuses a disagreement without a resolution (never picked by order)", () => {
    const second: AdjudicatedLanguage[] = ["ru", "ru", "uk", "mixed", "unknown", "en", "ru"];
    expect(() =>
      freezeE2Adjudications(base({ second: { reviewerId: "rev-2", entries: entries(second) } })),
    ).toThrow(/unresolved disagreement/);
  });

  it("refuses a resolution for a non-disagreement", () => {
    expect(() =>
      freezeE2Adjudications(
        base({
          second: { reviewerId: "rev-2", entries: entries(ALL_FIVE) },
          resolutions: [
            { exampleId: IDS[0]!, finalAdjudicatedLanguage: "ru", resolvedBy: "rev-3" },
          ],
        }),
      ),
    ).toThrow(/not a disagreement/);
  });

  it("refuses resolutions without a second reviewer", () => {
    expect(() =>
      freezeE2Adjudications(
        base({
          resolutions: [{ exampleId: IDS[0]!, finalAdjudicatedLanguage: "ru", resolvedBy: "r" }],
        }),
      ),
    ).toThrow(/no second reviewer/);
  });

  it("refuses a reviewer set mismatch", () => {
    expect(() =>
      freezeE2Adjudications(
        base({ second: { reviewerId: "rev-2", entries: entries(ALL_FIVE).slice(1) } }),
      ),
    ).toThrow(/id sets differ/);
  });

  it("refuses a second reviewer id equal to the first", () => {
    expect(() =>
      freezeE2Adjudications(base({ second: { reviewerId: "rev-1", entries: entries(ALL_FIVE) } })),
    ).toThrow(/must differ/);
  });
});

describe("refused inputs", () => {
  it("a missing id", () => {
    expect(() =>
      freezeE2Adjudications(
        base({ first: { reviewerId: "r", entries: base().first.entries.slice(1) } }),
      ),
    ).toThrow(/not adjudicated/);
  });

  it("an unknown id", () => {
    const bad = [
      ...base().first.entries.slice(1),
      { exampleId: "f".repeat(64), language: "en" as const },
    ];
    expect(() => freezeE2Adjudications(base({ first: { reviewerId: "r", entries: bad } }))).toThrow(
      /not in the drawn sample/,
    );
  });

  it("a duplicate id within a reviewer", () => {
    const e = base().first.entries;
    expect(() =>
      freezeE2Adjudications(base({ first: { reviewerId: "r", entries: [...e, e[0]!] } })),
    ).toThrow(/duplicate/);
  });

  it("a sample with two examples in one evidence cluster", () => {
    const rows = [
      sample.rows[0]!,
      { ...sample.rows[1]!, evidenceClusterId: sample.rows[0]!.evidenceClusterId },
      ...sample.rows.slice(2),
    ];
    expect(() => freezeE2Adjudications(base({ sampleRows: rows }))).toThrow(/evidenceClusterId/);
  });
});

describe("reviewer CSV and resolution parsing", () => {
  const hdr = "example_id,excerpt,language\n";

  it("parses all five values and trims", () => {
    const text = `${hdr}${["en", " ru", "uk", "mixed", "unknown "]
      .map((l, i) => `id${i},"a, b",${l}`)
      .join("\n")}\n`;
    expect(parseReviewerCsv(text).map((e) => e.language)).toEqual([
      "en",
      "ru",
      "uk",
      "mixed",
      "unknown",
    ]);
  });

  it.each(["be", "Russian", "RU", "", "en-US"])("refuses the value %j", (v) => {
    expect(() => parseReviewerCsv(`${hdr}id0,text,${v}\n`)).toThrow(/invalid language/);
  });

  it("refuses a duplicate id, a wrong header and ragged rows", () => {
    expect(() => parseReviewerCsv(`${hdr}a,t,en\na,t,ru\n`)).toThrow(/duplicate example_id/);
    expect(() => parseReviewerCsv("id,text,lang\na,t,en\n")).toThrow(
      /missing column|unexpected column/,
    );
    expect(() => parseReviewerCsv(`${hdr}a,en\n`)).toThrow(/cells/);
  });

  it("parses resolutions as CSV and as JSONL", () => {
    const csv =
      "example_id,final_language,resolved_by,note\nid1,mixed,rev-3,two parts\nid2,uk,rev-3,\n";
    expect(parseResolutions(csv, "csv")).toEqual([
      {
        exampleId: "id1",
        finalAdjudicatedLanguage: "mixed",
        resolvedBy: "rev-3",
        note: "two parts",
      },
      { exampleId: "id2", finalAdjudicatedLanguage: "uk", resolvedBy: "rev-3" },
    ]);
    const jsonl = '{"exampleId":"id1","finalAdjudicatedLanguage":"mixed","resolvedBy":"rev-3"}\n';
    expect(parseResolutions(jsonl, "jsonl")).toEqual([
      { exampleId: "id1", finalAdjudicatedLanguage: "mixed", resolvedBy: "rev-3" },
    ]);
  });

  it("refuses an invalid resolution value, a missing resolver and a duplicate", () => {
    expect(() =>
      parseResolutions("example_id,final_language,resolved_by\na,be,r\n", "csv"),
    ).toThrow(/invalid language/);
    expect(() => parseResolutions("example_id,final_language,resolved_by\na,en,\n", "csv")).toThrow(
      /empty resolvedBy/,
    );
    expect(() =>
      parseResolutions("example_id,final_language,resolved_by\na,en,r\na,ru,r\n", "csv"),
    ).toThrow(/duplicate resolution/);
  });
});

describe("flagged conflicts", () => {
  it("reports identical excerpts with conflicting finals without picking a winner", () => {
    const rows: FrameRow[] = [
      { ...frameRow(11, EN), excerpt: EN },
      { ...frameRow(12, EN), excerpt: EN },
    ];
    const population2 = freezeE2Population(rows);
    const allocation2 = allocateE2(population2.manifest.stratumCounts, 2, 1);
    const sample2 = drawE2Sample(population2, allocation2, "dup-excerpt");
    const ids2 = sample2.rows.map((e) => e.exampleId);
    const frozen = freezeE2Adjudications({
      sampleRows: sample2.rows,
      sampleManifest: sample2.manifest,
      populationManifest: population2.manifest,
      first: {
        reviewerId: "rev-1",
        entries: ids2.map((exampleId, i) => ({
          exampleId,
          language: (i === 0 ? "en" : "ru") as AdjudicatedLanguage,
        })),
      },
      frozenAt: "2026-11-27T12:00:00Z",
    });
    expect(frozen.rows.map((r) => r.finalAdjudicatedLanguage)).toEqual(["en", "ru"]);
    expect(frozen.manifest.flaggedIdenticalExcerptConflictCount).toBe(1);
    expect(frozen.manifest.flaggedIdenticalExcerptConflicts).toEqual([
      { excerptSha256: sha(EN), exampleIds: ids2 },
    ]);
    expect(frozen.manifest.flaggedDeclaredAdjudicatedConflictCount).toBe(0);
    expect(frozen.manifest.disagreementCount).toBe(0);
  });
});

describe("hash chain", () => {
  const f = freezeE2Adjudications(base());

  it("population -> sample -> adjudication validates", () => {
    expect(
      checkE2HashChain({
        population: population.manifest,
        sample: sample.manifest,
        adjudication: f.manifest,
      }),
    ).toEqual([]);
  });

  it("detects a tampered sample manifest", () => {
    const tampered = { ...sample.manifest, seed: "other" };
    const errors = checkE2HashChain({
      population: population.manifest,
      sample: tampered,
      adjudication: f.manifest,
    });
    expect(errors.join()).toMatch(/adjudication\.sampleManifestSha256/);
  });

  it("detects a tampered adjudications.jsonl through its hash", () => {
    const tamperedText = f.jsonl.replace('"en"', '"ru"');
    expect(tamperedText).not.toBe(f.jsonl);
    expect(sha(tamperedText)).not.toBe(f.manifest.adjudicationSha256);
    expect(sha(f.jsonl)).toBe(f.manifest.adjudicationSha256);
  });
});
