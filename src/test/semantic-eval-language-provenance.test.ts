import { describe, expect, it } from "vitest";
import { LANGUAGE_DETECTOR_VERSION } from "@/entities/normalization/language";
import {
  CODE_SEED_SNAPSHOT,
  SEMANTIC_RESOLVER_VERSION,
} from "@/entities/normalization/semantic-resolver";
import { sha256Hex } from "@/entities/normalization/sha256";
import {
  buildFrame,
  drawSample,
  frameIdFor,
  freezeFrame,
  languageForResolver,
} from "@/entities/normalization/semantic-eval/sampling";
import { LANGUAGE_STRATUM_RULE, type FrameRow } from "@/entities/normalization/semantic-eval/types";
import {
  parseJsonl,
  toJsonl,
  validateExample,
  validateFrameRow,
} from "@/entities/normalization/semantic-eval/validate";
import { verifyEvaluationInputs } from "@/entities/normalization/semantic-eval/verify";

const UK_DECISIVE = "Дрон вже має дальність польоту 250 км.";
const UK_INITIAL_ONLY = "Дальність польоту становить 250 км.";
const UK_UNDECIDABLE = "Корисне навантаження становить 35 кг.";
const RU_DECISIVE = "Дальность полёта составляет 250 км.";

const row = (over: Partial<FrameRow> = {}): FrameRow => ({
  sourceId: "dispatch-1",
  rawKey: "range_km",
  rawValue: "250",
  excerpt: UK_DECISIVE,
  publishedAt: "2026-03-02T00:00:00.000Z",
  ...over,
});

const freeze11 = (r: FrameRow) => freezeFrame([r], { frameId: "f", schemaVersion: "1.1.0" });
const unit11 = (r: FrameRow) => freeze11(r).units[0]!;

describe("schema 1.1.0 language provenance", () => {
  it("keeps detection separate from declaration when only detected", () => {
    const u = unit11(row());
    expect(u.schemaVersion).toBe("1.1.0");
    expect(u.declaredLanguage).toBeUndefined();
    expect("declaredLanguage" in u).toBe(false);
    expect(u).toMatchObject({
      detectedLanguage: "uk",
      languageDetectionDecisive: true,
      languageDetectionReason: "cyrillic_uk_letters",
      language: "uk",
    });
  });

  it("uses a declared language and keeps it even when detection disagrees (declared wins the stratum)", () => {
    const u = unit11(row({ declaredLanguage: "ru" }));
    expect(u.declaredLanguage).toBe("ru");
    expect(u.detectedLanguage).toBe("uk");
    expect(u.languageDetectionDecisive).toBe(true);
    expect(u.language).toBe("ru");
    expect(languageForResolver(u)).toBe("ru");
  });

  it("maps the legacy FrameRow.language to a declaration, and declaredLanguage outranks it", () => {
    expect(unit11(row({ language: "en" })).declaredLanguage).toBe("en");
    expect(unit11(row({ language: "en", declaredLanguage: "uk" })).declaredLanguage).toBe("uk");
  });

  it("stratifies a non-decisive detection as unknown and withholds the language from the resolver", () => {
    const u = unit11(row({ excerpt: UK_UNDECIDABLE }));
    expect(u).toMatchObject({
      detectedLanguage: "ru",
      languageDetectionDecisive: false,
      languageDetectionReason: "cyrillic_undetermined",
      language: "unknown",
    });
    expect(languageForResolver(u)).toBeUndefined();
  });

  it("does not let a sentence-initial word settle the language: unknown stratum, no language for the resolver", () => {
    const u = unit11(row({ excerpt: UK_INITIAL_ONLY }));
    expect(u).toMatchObject({
      detectedLanguage: "ru",
      languageDetectionDecisive: false,
      languageDetectionReason: "cyrillic_undetermined",
      language: "unknown",
    });
    expect(languageForResolver(u)).toBeUndefined();
  });

  it("is unknown for text with no language evidence", () => {
    const u = unit11(row({ excerpt: "max_speed 120 km/h", rawKey: "max_speed" }));
    expect(u).toMatchObject({
      detectedLanguage: "unknown",
      languageDetectionDecisive: false,
      language: "unknown",
    });
    expect(languageForResolver(u)).toBeUndefined();
  });

  it("a declared unknown stays unknown even when detection is decisive", () => {
    const u = unit11(row({ declaredLanguage: "unknown" }));
    expect(u.language).toBe("unknown");
    expect(languageForResolver(u)).toBeUndefined();
  });

  it("refuses to flatten a declaredLanguage into a 1.0.0 frame", () => {
    expect(() => freezeFrame([row({ declaredLanguage: "uk" })], { frameId: "f" })).toThrow(
      /schemaVersion 1\.1\.0/,
    );
  });

  it("passes only a known language to resolve()", () => {
    const seen: (string | undefined)[] = [];
    const snapshot = {
      ...CODE_SEED_SNAPSHOT,
      resolve: (input: Parameters<typeof CODE_SEED_SNAPSHOT.resolve>[0]) => {
        seen.push(input.language);
        return CODE_SEED_SNAPSHOT.resolve(input);
      },
    };
    buildFrame(
      [
        row({ rawValue: "1" }),
        row({ rawValue: "2", excerpt: UK_UNDECIDABLE }),
        row({ rawValue: "3", excerpt: UK_UNDECIDABLE, declaredLanguage: "uk" }),
        row({ rawValue: "4", excerpt: RU_DECISIVE }),
      ],
      {
        frameId: "f",
        snapshot,
        resolverVersion: SEMANTIC_RESOLVER_VERSION,
        schemaVersion: "1.1.0",
      },
    );
    expect(seen.sort()).toEqual([undefined, "ru", "uk", "uk"].sort());
  });

  it("validates a 1.1.0 example, enforces the stratum rule and the origin", () => {
    const built = buildFrame([row()], {
      frameId: "f",
      snapshot: CODE_SEED_SNAPSHOT,
      resolverVersion: SEMANTIC_RESOLVER_VERSION,
      schemaVersion: "1.1.0",
    });
    const e = built.examples[0]!;
    expect(validateExample(JSON.parse(JSON.stringify(e)))).toEqual(e);
    const bad = { ...e, language: "ru", stratum: e.stratum.replace("uk|", "ru|") };
    expect(() => validateExample(bad)).toThrow(/stratum rule/);
    expect(() => validateExample({ ...e, detectedLanguage: undefined })).toThrow(
      /detectedLanguage/,
    );
    expect(() => validateExample({ ...e, languageDetectionDecisive: "yes" })).toThrow(/boolean/);
    expect(() => validateExample({ ...e, languageDetectionReason: "guess" })).toThrow(
      /languageDetectionReason/,
    );
    expect(validateExample({ ...e, origin: "external_source" }).origin).toBe("external_source");
    // external_source is a 1.1.0 origin only.
    expect(() =>
      validateExample({
        ...e,
        origin: "external_source",
        schemaVersion: "1.0.0",
      }),
    ).toThrow(/external_source needs schema 1\.1\.0/);
  });

  it("validates FrameRow.declaredLanguage", () => {
    expect(validateFrameRow({ ...row(), declaredLanguage: "uk" }).declaredLanguage).toBe("uk");
    expect(() => validateFrameRow({ ...row(), declaredLanguage: "de" })).toThrow();
    expect(validateFrameRow({ ...row(), origin: "external_source" }).origin).toBe(
      "external_source",
    );
  });

  it("verifies a 1.1.0 frame end to end and records the stratum rule in the manifest field", () => {
    const rows = [row(), row({ rawValue: "2", excerpt: UK_UNDECIDABLE })];
    const built = buildFrame(rows, {
      frameId: "",
      snapshot: CODE_SEED_SNAPSHOT,
      resolverVersion: SEMANTIC_RESOLVER_VERSION,
      isPilot: true,
      schemaVersion: "1.1.0",
    });
    const frameId = frameIdFor(built.examples);
    const examples = built.examples.map((e) => ({ ...e, frameId }));
    const sample = drawSample(examples, { seed: "s", ceiling: 72 });
    const examplesText = toJsonl(examples);
    const predictionsText = toJsonl(built.predictions);
    const manifest = {
      manifestVersion: "1.0.0",
      frameId,
      seed: "s",
      cutoff: "2026-11-01T00:00:00Z",
      ceiling: 72,
      pilot: true,
      familyCount: 12,
      languageCount: 4,
      resolverStatusCount: 2,
      resolverVersion: SEMANTIC_RESOLVER_VERSION,
      snapshotHash: CODE_SEED_SNAPSHOT.contentHash,
      populationCount: sample.populationCount,
      drawnCount: sample.drawnCount,
      cells: sample.cells,
      emptyCells: sample.emptyCells,
      unsampledCells: sample.unsampledCells,
      coveredFraction: sample.coveredFraction,
      concentration: [],
      topShare: 0,
      exclusions: built.exclusions,
      examplesSha256: sha256Hex(examplesText),
      predictionsSha256: sha256Hex(predictionsText),
      languageRule: LANGUAGE_STRATUM_RULE,
      languageDetectorVersion: LANGUAGE_DETECTOR_VERSION,
    };
    const parsed = parseJsonl(examplesText, validateExample, "examples.jsonl");
    expect(parsed.map((e) => e.language).sort()).toEqual(["uk", "unknown"]);
    const errors = verifyEvaluationInputs({
      manifest,
      examples: parsed,
      predictions: built.predictions,
      decisions: [],
      examplesText,
      predictionsText,
    });
    expect(errors).toEqual([]);
  });
});

describe("schema 1.0.0 stays as it was", () => {
  it("emits 1.0.0 by default with none of the new fields, as before", () => {
    const u = freezeFrame([row({ language: "uk" })], { frameId: "f" }).units[0]!;
    expect(u.schemaVersion).toBe("1.0.0");
    for (const k of [
      "declaredLanguage",
      "detectedLanguage",
      "languageDetectionDecisive",
      "languageDetectionReason",
    ]) {
      expect(k in u, k).toBe(false);
    }
    expect(u.language).toBe("uk");
  });

  it("reads a 1.0.0 example without the new fields unchanged, and ignores them if present", () => {
    const built = buildFrame([row()], {
      frameId: sha256Hex("f"),
      snapshot: CODE_SEED_SNAPSHOT,
      resolverVersion: SEMANTIC_RESOLVER_VERSION,
    });
    const e = built.examples[0]!;
    const plain = JSON.parse(JSON.stringify(e));
    expect(validateExample(plain)).toEqual(e);
    const noisy = { ...plain, detectedLanguage: "ru", languageDetectionDecisive: true };
    expect(validateExample(noisy)).toEqual(e);
  });

  it("still derives the 1.0.0 language the old way (row language, else detection)", () => {
    expect(freezeFrame([row()], { frameId: "f" }).units[0]!.language).toBe("uk");
    expect(freezeFrame([row({ language: "en" })], { frameId: "f" }).units[0]!.language).toBe("en");
    // Old behaviour: any non-unknown language goes to the resolver.
    expect(languageForResolver(freezeFrame([row()], { frameId: "f" }).units[0]!)).toBe("uk");
  });
});
