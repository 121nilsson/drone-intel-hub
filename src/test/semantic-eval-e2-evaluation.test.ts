/**
 * E2 step d: the evaluation run and the whole-record verification, with an injected stub snapshot
 * that records every input it is given. Expected values are hand-written literals; the only
 * computed values are hashes and replay equality (a replay is compared with a fresh run).
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  freezeE2Adjudications,
  e2AdjudicationManifestText,
} from "../entities/normalization/semantic-eval/e2/adjudication";
import { allocateE2 } from "../entities/normalization/semantic-eval/e2/allocation";
import { drawE2Sample } from "../entities/normalization/semantic-eval/e2/draw";
import {
  e2EvaluationManifestText,
  e2ResolverInput,
  runE2Evaluation,
  verifyE2Record,
  type E2RecordFiles,
  type E2Snapshot,
} from "../entities/normalization/semantic-eval/e2/evaluation";
import {
  e2RowsJsonl,
  freezeE2Population as freezePopulationWithHash,
  type E2FreezeOptions,
} from "../entities/normalization/semantic-eval/e2/population";
import {
  E2_RESOLVER_LANGUAGE_RULE,
  type AdjudicatedLanguage,
  type E2Example,
} from "../entities/normalization/semantic-eval/e2/types";
import {
  checkE2HashChain,
  e2ManifestHash,
  validateE2EvaluationManifest,
} from "../entities/normalization/semantic-eval/e2/validate";
import type { FrameRow } from "../entities/normalization/semantic-eval/types";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const RAW = "a".repeat(64);
const freezeE2Population = (rows: readonly FrameRow[], extra: Partial<E2FreezeOptions> = {}) =>
  freezePopulationWithHash(rows, { rawExportSha256: RAW, ...extra });
const PROVENANCE = {
  evaluatedAt: "2026-11-28T12:00:00.000Z",
  frozenArtifactsCommit: "b".repeat(40),
};

const EN = "The aircraft is a long range drone that is used by the army and it has been seen";
const RU = "Беспилотник имеет максимальную скорость это километров в час при полете";
const UK = "Дрон має максимальну швидкість это кілометрів на годину і є українським";

function frameRow(i: number, excerpt: string, extra: Partial<FrameRow> = {}): FrameRow {
  return {
    sourceId: `src-${i}`,
    rawKey: `k${i}`,
    rawValue: String(i),
    excerpt: `${excerpt} ${i}`,
    publishedAt: "2026-01-01T00:00:00Z",
    ...extra,
  };
}

const FRAME: FrameRow[] = [
  frameRow(1, EN, { declaredLanguage: "uk" }),
  frameRow(2, EN),
  frameRow(3, RU),
  frameRow(4, RU, { declaredLanguage: "en" }),
  frameRow(5, UK),
  frameRow(6, "x"),
];

/** Adjudicated language by rawKey. */
const LABELS: Record<string, AdjudicatedLanguage> = {
  k1: "ru",
  k2: "ru",
  k3: "mixed",
  k4: "uk",
  k5: "unknown",
  k6: "en",
};

interface Stub extends E2Snapshot {
  readonly calls: { rawKey: string; language?: string | undefined }[];
  readonly inputs: unknown[];
}

function stub(contentHash = "stub-hash-1", tag = "a"): Stub {
  const inputs: unknown[] = [];
  const calls: Stub["calls"] = [];
  return {
    contentHash,
    calls,
    inputs,
    resolve(input) {
      inputs.push(JSON.parse(JSON.stringify(input)));
      calls.push({ rawKey: input.rawKey, language: input.language });
      return {
        status: "withheld",
        reason: `${tag}-${input.rawKey}`,
        snapshotHash: contentHash,
      } as never;
    },
  };
}

const pretty = (m: unknown) => `${JSON.stringify(m, null, 2)}\n`;

function makeFiles(
  n: number,
  labels: Record<string, AdjudicatedLanguage> = LABELS,
  frame: FrameRow[] = FRAME,
): E2RecordFiles & { rows: readonly E2Example[]; sampleRows: readonly E2Example[] } {
  const population = freezeE2Population(frame);
  const allocation = allocateE2(population.manifest.stratumCounts, n, 1);
  const sample = drawE2Sample(population, allocation, "t-seed");
  const entries = sample.rows.map((e) => ({ exampleId: e.exampleId, language: labels[e.rawKey]! }));
  const adj = freezeE2Adjudications({
    sampleRows: sample.rows,
    sampleManifest: sample.manifest,
    populationManifest: population.manifest,
    first: { reviewerId: "rev-1", entries },
    frozenAt: "2026-11-27T00:00:00.000Z",
  });
  return {
    rows: population.rows,
    sampleRows: sample.rows,
    populationJsonl: e2RowsJsonl(population.rows),
    populationManifestText: pretty(population.manifest),
    sampleJsonl: e2RowsJsonl(sample.rows),
    sampleManifestText: pretty(sample.manifest),
    adjudicationsJsonl: adj.jsonl,
    adjudicationManifestText: e2AdjudicationManifestText(adj.manifest),
  };
}

function evaluate(files: E2RecordFiles, snap: E2Snapshot = stub()) {
  const run = runE2Evaluation(files, snap, "9.9.9", PROVENANCE);
  return {
    run,
    full: {
      ...files,
      predictionsJsonl: run.predictionsJsonl,
      evaluationManifestText: run.manifestText,
    } satisfies E2RecordFiles,
  };
}

const verify = (files: E2RecordFiles, snap: E2Snapshot = stub()) =>
  verifyE2Record(files, snap, "9.9.9");

describe("resolver language reaches the resolver only through e2ResolverLanguage", () => {
  it("applies the declared language, else the adjudicated en/ru/uk, else none", () => {
    const s = stub();
    evaluate(makeFiles(6), s);
    const byKey = Object.fromEntries(s.inputs.map((i) => [(i as { rawKey: string }).rawKey, i]));
    expect(byKey["k1"]).toEqual({ rawKey: "k1", language: "uk" }); // declared uk, adjudicated ru
    expect(byKey["k2"]).toEqual({ rawKey: "k2", language: "ru" });
    expect(byKey["k3"]).toEqual({ rawKey: "k3" }); // mixed
    expect(byKey["k4"]).toEqual({ rawKey: "k4", language: "en" }); // declared en, adjudicated uk
    expect(byKey["k5"]).toEqual({ rawKey: "k5" }); // unknown
    expect(byKey["k6"]).toEqual({ rawKey: "k6", language: "en" });
    expect(s.inputs).toHaveLength(6);
  });

  it("changing an adjudication from ru to mixed removes the language from the input", () => {
    const ru = stub();
    evaluate(makeFiles(6, { ...LABELS, k2: "ru" }), ru);
    const mixed = stub();
    evaluate(makeFiles(6, { ...LABELS, k2: "mixed" }), mixed);
    const pick = (s: Stub) => s.inputs.find((i) => (i as { rawKey: string }).rawKey === "k2");
    expect(pick(ru)).toEqual({ rawKey: "k2", language: "ru" });
    expect(pick(mixed)).toEqual({ rawKey: "k2" });
  });

  it("two rows that differ only in routing stratum get identical resolver input", () => {
    const [a] = makeFiles(6).rows.filter((e) => e.rawKey === "k2");
    const b: E2Example = { ...a!, routingStratum: "ru" };
    expect(a!.routingStratum).toBe("en");
    expect(e2ResolverInput(a!, "uk")).toEqual(e2ResolverInput(b, "uk"));
    expect(e2ResolverInput(a!, "uk")).toEqual({ rawKey: "k2", language: "uk" });
    expect(e2ResolverInput(a!, undefined)).toEqual({ rawKey: "k2" });
  });

  it("rows from different routing strata with equal other fields get equal input in a run", () => {
    const frame = [
      frameRow(1, EN, { rawKey: "same" }),
      frameRow(2, RU, { rawKey: "same" }),
      frameRow(3, "x", { rawKey: "other" }),
    ];
    const labels = { same: "en", other: "en" } as Record<string, AdjudicatedLanguage>;
    const s = stub();
    const files = makeFiles(3, labels, frame);
    expect(new Set(files.sampleRows.map((e) => e.routingStratum)).size).toBe(3);
    evaluate(files, s);
    const same = s.inputs.filter((i) => (i as { rawKey: string }).rawKey === "same");
    expect(same).toEqual([
      { rawKey: "same", language: "en" },
      { rawKey: "same", language: "en" },
    ]);
  });
});

describe("runE2Evaluation", () => {
  it("writes one prediction per drawn id with the recorded language and a valid manifest", () => {
    const files = makeFiles(6);
    const s = stub();
    const { run } = evaluate(files, s);
    expect(run.predictions).toHaveLength(6);
    expect(run.predictions.map((p) => p.exampleId)).toEqual(
      files.sampleRows.map((e) => e.exampleId),
    );
    const langByKey = Object.fromEntries(
      files.sampleRows.map((e, i) => [e.rawKey, run.predictions[i]!.resolverLanguage]),
    );
    expect(langByKey).toEqual({
      k1: "uk",
      k2: "ru",
      k3: "unknown",
      k4: "en",
      k5: "unknown",
      k6: "en",
    });
    expect(run.predictions.every((p) => p.snapshotHash === "stub-hash-1")).toBe(true);
    expect(run.predictions.every((p) => p.resolverVersion === "9.9.9")).toBe(true);

    const m = validateE2EvaluationManifest(JSON.parse(run.manifestText));
    expect(m.resolverLanguageRule).toBe(E2_RESOLVER_LANGUAGE_RULE);
    expect(m.snapshotHash).toBe("stub-hash-1");
    expect(m.resolverVersion).toBe("9.9.9");
    expect(m.predictionsSha256).toBe(sha(run.predictionsJsonl));
    const adjManifest = JSON.parse(files.adjudicationManifestText!);
    expect(m.adjudicationManifestSha256).toBe(e2ManifestHash(adjManifest));
    expect(
      checkE2HashChain({
        population: JSON.parse(files.populationManifestText!),
        sample: JSON.parse(files.sampleManifestText!),
        adjudication: adjManifest,
        evaluation: m,
      }),
    ).toEqual([]);
    expect(e2EvaluationManifestText(m)).toBe(run.manifestText);
  });

  describe("refuses before any resolve() call", () => {
    const refusals: [string, (f: ReturnType<typeof makeFiles>) => E2RecordFiles][] = [
      ["adjudications file missing", (f) => ({ ...f, adjudicationsJsonl: undefined })],
      ["adjudication manifest missing", (f) => ({ ...f, adjudicationManifestText: undefined })],
      ["sample manifest missing", (f) => ({ ...f, sampleManifestText: undefined })],
      ["population file missing", (f) => ({ ...f, populationJsonl: undefined })],
      ["adjudications not JSON", (f) => ({ ...f, adjudicationsJsonl: "not json\n" })],
      [
        "adjudications tampered",
        (f) => ({
          ...f,
          adjudicationsJsonl: f.adjudicationsJsonl!.replace(
            '"finalAdjudicatedLanguage":"en"',
            '"finalAdjudicatedLanguage":"ru"',
          ),
        }),
      ],
      [
        "adjudications incomplete (hash-consistent)",
        (f) => {
          const lines = f.adjudicationsJsonl!.trimEnd().split("\n").slice(1);
          const text = `${lines.join("\n")}\n`;
          const manifest = {
            ...JSON.parse(f.adjudicationManifestText!),
            adjudicationSha256: sha(text),
          };
          return { ...f, adjudicationsJsonl: text, adjudicationManifestText: pretty(manifest) };
        },
      ],
      [
        "sample manifest seed edited (chain broken)",
        (f) => ({ ...f, sampleManifestText: f.sampleManifestText!.replace("t-seed", "other") }),
      ],
      [
        "adjudication manifest links to another sample",
        (f) => ({
          ...f,
          adjudicationManifestText: pretty({
            ...JSON.parse(f.adjudicationManifestText!),
            sampleManifestSha256: "0".repeat(64),
          }),
        }),
      ],
    ];
    for (const [name, mutate] of refusals) {
      it(name, () => {
        const s = stub();
        expect(() => runE2Evaluation(mutate(makeFiles(6)), s, "9.9.9", PROVENANCE)).toThrow(
          /refusing to run/,
        );
        expect(s.calls).toHaveLength(0);
      });
    }
  });
});

describe("verifyE2Record", () => {
  it("passes on an untampered record, and a replay equals a fresh run", () => {
    const { full } = evaluate(makeFiles(4));
    expect(verify(full)).toEqual([]);
    const again = evaluate(makeFiles(4));
    expect(again.full.predictionsJsonl).toBe(full.predictionsJsonl);
  });

  it("refuses to run when the evaluation claims to predate the adjudication freeze", () => {
    const snap = stub();
    expect(() =>
      runE2Evaluation(makeFiles(4), snap, "9.9.9", {
        ...PROVENANCE,
        evaluatedAt: "2026-11-26T00:00:00.000Z",
      }),
    ).toThrow(/precedes adjudication frozenAt/);
    expect(snap.calls).toHaveLength(0);
  });

  const tampers: [
    string,
    (f: E2RecordFiles, rows: readonly E2Example[]) => E2RecordFiles,
    RegExp,
  ][] = [
    [
      "a population row edited",
      (f) => ({
        ...f,
        populationJsonl: f.populationJsonl!.replace('"rawKey":"k2"', '"rawKey":"kX"'),
      }),
      /population: population\.jsonl SHA-256/,
    ],
    [
      "a routing stratum edited",
      (f) => ({
        ...f,
        populationJsonl: f.populationJsonl!.replace(
          '"routingStratum":"unknown"',
          '"routingStratum":"en"',
        ),
      }),
      /routingStratum: is en but the routing rule gives unknown for the stored excerpt/,
    ],
    [
      "a sample manifest seed edited",
      (f) => ({ ...f, sampleManifestText: f.sampleManifestText!.replace("t-seed", "other") }),
      /draw with the recorded seed gives different ids|sampleManifestSha256 does not match/,
    ],
    [
      "an adjudication value edited",
      (f) => ({
        ...f,
        adjudicationsJsonl: f.adjudicationsJsonl!.replace(
          '"finalAdjudicatedLanguage":"en"',
          '"finalAdjudicatedLanguage":"uk"',
        ),
      }),
      /adjudication: adjudications\.jsonl SHA-256/,
    ],
    [
      "a prediction edited",
      (f) => ({ ...f, predictionsJsonl: f.predictionsJsonl!.replace("a-k1", "a-kZ") }),
      /predictions: predictions\.jsonl SHA-256/,
    ],
    [
      "a recorded resolver language edited (hash-consistent)",
      (f) => {
        const text = f.predictionsJsonl!.replace(
          '"resolverLanguage":"uk"',
          '"resolverLanguage":"ru"',
        );
        return {
          ...f,
          predictionsJsonl: text,
          evaluationManifestText: pretty({
            ...JSON.parse(f.evaluationManifestText!),
            predictionsSha256: sha(text),
          }),
        };
      },
      /recorded resolver language ru, the frozen values give uk/,
    ],
    [
      "extra whitespace in the population manifest text",
      (f) => ({ ...f, populationManifestText: `${f.populationManifestText}\n` }),
      /population: population-manifest\.json SHA-256/,
    ],
    [
      "extra whitespace in adjudications.jsonl",
      (f) => ({ ...f, adjudicationsJsonl: `${f.adjudicationsJsonl}\n` }),
      /adjudication: adjudications\.jsonl SHA-256/,
    ],
    [
      "a flagged conflict id edited in an otherwise valid manifest",
      (f) => ({
        ...f,
        adjudicationManifestText: pretty({
          ...JSON.parse(f.adjudicationManifestText!),
          flaggedDeclaredAdjudicatedConflictCount: 1,
          flaggedDeclaredAdjudicatedExampleIds: ["f".repeat(64)],
        }),
      }),
      /flagged declared\/adjudicated conflicts do not match/,
    ],
    [
      "a broken link",
      (f) => ({
        ...f,
        evaluationManifestText: pretty({
          ...JSON.parse(f.evaluationManifestText!),
          adjudicationManifestSha256: "1".repeat(64),
        }),
      }),
      /evaluation\.adjudicationManifestSha256 does not match/,
    ],
  ];
  for (const [name, mutate, expected] of tampers) {
    it(`detects ${name}`, () => {
      const base = makeFiles(6);
      const { full } = evaluate(base);
      expect(verify(full)).toEqual([]);
      const errors = verify(mutate(full, base.rows));
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.join("\n")).toMatch(expected);
    });
  }

  it("detects a drawn id swapped for an undrawn population row", () => {
    const base = makeFiles(4);
    const { full } = evaluate(base);
    const drawn = JSON.parse(base.sampleManifestText!).drawnExampleIds as string[];
    expect(drawn).toHaveLength(4);
    const outside = base.rows.find((e) => !drawn.includes(e.exampleId))!;
    const swapped = full.sampleJsonl!.replace(
      `"exampleId":"${drawn[0]}"`,
      `"exampleId":"${outside.exampleId}"`,
    );
    expect(swapped).not.toBe(full.sampleJsonl);
    const errors = verify({ ...full, sampleJsonl: swapped });
    expect(errors.join("\n")).toMatch(/sample: sample\.jsonl SHA-256/);
  });

  it("detects a population row whose own stratum was edited in the sample too", () => {
    // sample rows are compared with population rows byte for byte
    const base = makeFiles(6);
    const { full } = evaluate(base);
    const errors = verify({
      ...full,
      sampleJsonl: full.sampleJsonl!.replace('"rawKey":"k2"', '"rawKey":"kX"'),
    });
    expect(errors.join("\n")).toMatch(/differs from its population row/);
  });

  it("refuses to replay with a different snapshot, and does not call it", () => {
    const { full } = evaluate(makeFiles(4));
    const other = stub("stub-hash-2");
    const errors = verify(full, other);
    expect(errors.join("\n")).toMatch(/replay refused/);
    expect(other.calls).toHaveLength(0);
  });

  it("detects predictions that no longer replay (a different resolver, same hash)", () => {
    const { full } = evaluate(makeFiles(4), stub("stub-hash-1", "a"));
    const errors = verify(full, stub("stub-hash-1", "b"));
    expect(errors.join("\n")).toMatch(/replaying the resolver gives different predictions/);
  });

  it("does not call the resolver when the frozen record is invalid", () => {
    const { full } = evaluate(makeFiles(4));
    const s = stub();
    const errors = verify({ ...full, adjudicationsJsonl: "garbage\n" }, s);
    expect(errors.length).toBeGreaterThan(0);
    expect(s.calls).toHaveLength(0);
  });

  it("reports missing files as errors", () => {
    const errors = verify({});
    expect(errors.join("\n")).toMatch(/population manifest: file is missing/);
    expect(errors.join("\n")).toMatch(/adjudications\.jsonl: file is missing/);
  });
});
