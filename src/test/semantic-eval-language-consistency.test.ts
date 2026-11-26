import { describe, expect, it } from "vitest";
import {
  LANGUAGE_DETECTION_REASONS,
  LANGUAGE_DETECTOR_VERSION,
  LANGUAGE_REASON_OUTCOMES,
  detectLanguageWithEvidence,
  type DetectedLanguage,
} from "@/entities/normalization/language";
import {
  buildFrame,
  drawSample,
  frameIdFor,
  freezeFrame,
} from "@/entities/normalization/semantic-eval/sampling";
import { LANGUAGE_STRATUM_RULE, type FrameRow } from "@/entities/normalization/semantic-eval/types";
import { toJsonl, validateExample } from "@/entities/normalization/semantic-eval/validate";
import {
  verifyEvaluationInputs,
  verifyLanguageProvenance,
} from "@/entities/normalization/semantic-eval/verify";
import {
  CODE_SEED_SNAPSHOT,
  SEMANTIC_RESOLVER_VERSION,
} from "@/entities/normalization/semantic-resolver";
import { sha256Hex } from "@/entities/normalization/sha256";
import { ADVERSARIAL_CATEGORIES } from "./fixtures/language-detect-adversarial";
import { LANGUAGE_CORPUS } from "./fixtures/language-detect-corpus";

const UK = "Дрон вже має дальність польоту 250 км.";
const UK_UNDECIDABLE = "Корисне навантаження становить 35 кг.";

const row = (over: Partial<FrameRow> = {}): FrameRow => ({
  sourceId: "dispatch-1",
  rawKey: "range_km",
  rawValue: "250",
  excerpt: UK,
  publishedAt: "2026-03-02T00:00:00.000Z",
  ...over,
});

const build11 = (rows: FrameRow[], frameId = sha256Hex("f")) =>
  buildFrame(rows, {
    frameId,
    snapshot: CODE_SEED_SNAPSHOT,
    resolverVersion: SEMANTIC_RESOLVER_VERSION,
    isPilot: true,
    schemaVersion: "1.1.0",
  });

/** A stored 1.1.0 example with the detection fields overridden, stratum kept consistent. */
function exampleWith(
  language: DetectedLanguage,
  decisive: boolean,
  reason: string,
): Record<string, unknown> {
  const e = JSON.parse(JSON.stringify(build11([row()]).examples[0]!)) as Record<string, unknown>;
  // The stratum rule says: detected if decisive, else unknown (no declaration here).
  const stratumLanguage = decisive ? language : "unknown";
  const old = e["stratum"] as string;
  return {
    ...e,
    detectedLanguage: language,
    languageDetectionDecisive: decisive,
    languageDetectionReason: reason,
    language: stratumLanguage,
    stratum: `${stratumLanguage}${old.slice(old.indexOf("|"))}`,
    declaredLanguage: undefined,
  };
}

describe("F2: detection fields of a 1.1.0 example must agree", () => {
  it("pins the reason table to the closed reason list", () => {
    expect(Object.keys(LANGUAGE_REASON_OUTCOMES).sort()).toEqual(
      [...LANGUAGE_DETECTION_REASONS].sort(),
    );
  });

  it("accepts exactly the consistent reason x decisive x language combinations", () => {
    const languages: DetectedLanguage[] = ["en", "ru", "uk", "unknown"];
    let accepted = 0;
    for (const reason of LANGUAGE_DETECTION_REASONS) {
      for (const decisive of [true, false]) {
        for (const language of languages) {
          const outcome = LANGUAGE_REASON_OUTCOMES[reason];
          const consistent = decisive === outcome.decisive && outcome.languages.includes(language);
          let passed = true;
          try {
            validateExample(exampleWith(language, decisive, reason));
          } catch {
            passed = false;
          }
          expect(passed, `${reason} decisive=${decisive} language=${language}`).toBe(consistent);
          if (passed) accepted++;
        }
      }
    }
    // 1+1+1+1+1+1 single-language reasons, plus 3 reasons with two languages each.
    expect(accepted).toBe(6 + 3 * 2);
  });

  it("names the contradiction from the review", () => {
    expect(() => validateExample(exampleWith("uk", true, "cyrillic_undetermined"))).toThrow(
      /cyrillic_undetermined implies decisive=false/,
    );
    expect(() => validateExample(exampleWith("uk", true, "cyrillic_ru_letters"))).toThrow(
      /allows ru/,
    );
    expect(() => validateExample(exampleWith("en", true, "too_short"))).toThrow(
      /too_short implies decisive=false/,
    );
  });

  it("accepts everything the detector emits on the corpus and the adversarial texts", () => {
    // The holdout is deliberately not read here.
    const texts = [
      ...LANGUAGE_CORPUS.map((r) => r.text),
      ...Object.values(ADVERSARIAL_CATEGORIES)
        .flat()
        .map((r) => r.text),
      "", // too short
      "max_speed 120 km/h", // too short / no evidence
      "Mavic 3 Pro, DJI O3+, 43 хв, 28 км.", // mixed scripts
      "Le drone a une portée de deux cent cinquante kilomètres et plus encore.", // latin_not_english
    ];
    const reasons = new Set<string>();
    for (const text of texts) {
      if (text.trim().length === 0) continue;
      const built = build11([row({ excerpt: text })]);
      const e = built.examples[0]!;
      reasons.add(e.languageDetectionReason!);
      expect(() => validateExample(JSON.parse(JSON.stringify(e))), text).not.toThrow();
      expect(
        verifyLanguageProvenance(
          {
            languageRule: LANGUAGE_STRATUM_RULE,
            languageDetectorVersion: LANGUAGE_DETECTOR_VERSION,
          },
          [e],
        ),
        text,
      ).toEqual({ errors: [], warnings: [] });
    }
    // The property is only meaningful if the inputs reach every reason.
    expect([...reasons].sort()).toEqual([...LANGUAGE_DETECTION_REASONS].sort());
  });

  it("leaves schema 1.0.0 unaffected: provenance fields on it are still not read", () => {
    const built = buildFrame([row({ language: "uk" })], {
      frameId: sha256Hex("f"),
      snapshot: CODE_SEED_SNAPSHOT,
      resolverVersion: SEMANTIC_RESOLVER_VERSION,
    });
    const e = built.examples[0]!;
    const noisy = {
      ...JSON.parse(JSON.stringify(e)),
      detectedLanguage: "uk",
      languageDetectionDecisive: true,
      languageDetectionReason: "cyrillic_undetermined",
    };
    expect(validateExample(noisy)).toEqual(e);
  });
});

describe("F3 sibling: 1.1.0 frames are detected on the stored excerpt (F6)", () => {
  // 350 characters of evidence-free Cyrillic, then the words that carry the evidence.
  const long = `${"дрон ".repeat(70)}вже має дальність польоту`;

  it("detects differently on the full and on the truncated text, and stores the truncated one's result", () => {
    expect(long.length).toBeGreaterThan(300);
    const full = detectLanguageWithEvidence(long);
    expect(full).toMatchObject({ decisive: true, language: "uk" });
    const u = freezeFrame([row({ excerpt: long })], { frameId: "f", schemaVersion: "1.1.0" })
      .units[0]!;
    expect(u.excerpt.length).toBe(300);
    const onStored = detectLanguageWithEvidence(u.excerpt);
    expect(onStored.decisive).toBe(false);
    expect(u).toMatchObject({
      detectedLanguage: onStored.language,
      languageDetectionDecisive: false,
      languageDetectionReason: onStored.reason,
      language: "unknown",
    });
  });

  it("keeps 1.0.0 as it was: the row's language, no detection", () => {
    const u = freezeFrame([row({ excerpt: long, language: "uk" })], { frameId: "f" }).units[0]!;
    expect(u.language).toBe("uk");
    expect("detectedLanguage" in u).toBe(false);
  });
});

describe("F6: dedupe edge cases, documented", () => {
  const UPPER = UK.toUpperCase();

  it("a case-only difference shares an evidence cluster but detects differently: the cluster is excluded", () => {
    expect(detectLanguageWithEvidence(UK).decisive).toBe(true);
    expect(detectLanguageWithEvidence(UPPER).decisive).toBe(false);
    const built = freezeFrame([row({ sourceId: "a" }), row({ sourceId: "b", excerpt: UPPER })], {
      frameId: "f",
      schemaVersion: "1.1.0",
    });
    // Conservative: neither row survives, and the exclusion says why.
    expect(built.units).toHaveLength(0);
    expect(built.exclusions).toContainEqual({ reason: "conflicting_evidence_metadata", count: 1 });
  });

  it("when the stratum language matches, the dropped row's detection fields are discarded", () => {
    const rows = [
      row({ sourceId: "a", declaredLanguage: "uk" }),
      row({ sourceId: "b", excerpt: UPPER, declaredLanguage: "uk" }),
    ];
    const built = freezeFrame(rows, { frameId: "f", schemaVersion: "1.1.0" });
    expect(built.units).toHaveLength(1);
    expect(built.exclusions).toContainEqual({ reason: "duplicate_evidence", count: 1 });
    const kept = built.units[0]!;
    const own = detectLanguageWithEvidence(kept.excerpt);
    expect(kept.languageDetectionReason).toBe(own.reason);
    // The two rows detect differently, so one of the two detections is gone without a trace.
    const other = detectLanguageWithEvidence(kept.excerpt === UK ? UPPER : UK);
    expect(other.reason).not.toBe(own.reason);
    expect(JSON.stringify(kept)).not.toContain(other.reason);
  });
});

describe("F4: verifying language provenance", () => {
  const stamp = {
    languageRule: LANGUAGE_STRATUM_RULE,
    languageDetectorVersion: LANGUAGE_DETECTOR_VERSION,
  };
  const examples = () => build11([row(), row({ rawValue: "2", excerpt: UK_UNDECIDABLE })]).examples;

  it("passes a consistent frame stamped with the current detector", () => {
    expect(verifyLanguageProvenance(stamp, examples())).toEqual({ errors: [], warnings: [] });
  });

  it("requires the manifest's languageDetectorVersion and languageRule", () => {
    const noVersion = verifyLanguageProvenance({ languageRule: stamp.languageRule }, examples());
    expect(noVersion.errors).toContain("schema 1.1.0 manifest has no languageDetectorVersion");
    const noRule = verifyLanguageProvenance(
      { languageDetectorVersion: stamp.languageDetectorVersion },
      examples(),
    );
    expect(noRule.errors).toContain("schema 1.1.0 manifest has no languageRule");
    const wrongRule = verifyLanguageProvenance({ ...stamp, languageRule: "always ru" }, examples());
    expect(wrongRule.errors.join()).toMatch(/not the rule this verifier knows/);
  });

  it("refuses a directory that mixes 1.0.0 and 1.1.0 examples", () => {
    const e11 = examples();
    const e10 = buildFrame([row({ rawValue: "3", language: "uk" })], {
      frameId: sha256Hex("f"),
      snapshot: CODE_SEED_SNAPSHOT,
      resolverVersion: SEMANTIC_RESOLVER_VERSION,
    }).examples;
    const { errors } = verifyLanguageProvenance(stamp, [...e11, ...e10]);
    expect(errors.join()).toMatch(/mix schema versions \(1\.0\.0, 1\.1\.0\)/);
  });

  it("checks that the provenance fields agree with each other", () => {
    const [good] = examples();
    const bad = {
      ...good!,
      languageDetectionDecisive: true,
      languageDetectionReason: "too_short" as const,
    };
    expect(verifyLanguageProvenance(stamp, [bad]).errors.join()).toMatch(/contradictory/);
    const missing = { ...good!, languageDetectionReason: undefined };
    expect(verifyLanguageProvenance(stamp, [missing]).errors.join()).toMatch(/lacks its language/);
  });

  it("re-runs detection on the stored excerpt when the stamp is the current version", () => {
    const [good] = examples();
    // The stored text was changed after freezing: same fields, different excerpt.
    const tampered = { ...good!, excerpt: "Дальність польоту становить 250 км." };
    const { errors } = verifyLanguageProvenance(stamp, [tampered]);
    expect(errors.join()).toMatch(/does not re-detect from its stored excerpt/);
  });

  it("reports another detector version as a warning, not an error, and does not re-detect", () => {
    const [good] = examples();
    const tampered = { ...good!, excerpt: "Дальність польоту становить 250 км." };
    const r = verifyLanguageProvenance({ ...stamp, languageDetectorVersion: "2.0.0" }, [tampered]);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([
      `language detector 2.0.0 is not the current ${LANGUAGE_DETECTOR_VERSION}: stored detection is not re-verifiable with this detector`,
    ]);
  });

  it("does not look at a pure 1.0.0 directory", () => {
    const e10 = buildFrame([row({ language: "uk" })], {
      frameId: sha256Hex("f"),
      snapshot: CODE_SEED_SNAPSHOT,
      resolverVersion: SEMANTIC_RESOLVER_VERSION,
    }).examples;
    expect(verifyLanguageProvenance({}, e10)).toEqual({ errors: [], warnings: [] });
  });

  it("is part of the whole-directory verification", () => {
    const built = build11([row(), row({ rawValue: "2", excerpt: UK_UNDECIDABLE })], "");
    const frameId = frameIdFor(built.examples);
    const ex = built.examples.map((e) => ({ ...e, frameId }));
    const sample = drawSample(ex, { seed: "s", ceiling: 72 });
    const examplesText = toJsonl(ex);
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
    };
    const run = (m: object) =>
      verifyEvaluationInputs({
        manifest: m,
        examples: ex,
        predictions: built.predictions,
        decisions: [],
        examplesText,
        predictionsText,
      });
    // Unstamped 1.1.0 directory: the hashes and the draw are fine, the stamp is what fails.
    expect(run(manifest).sort()).toEqual([
      "schema 1.1.0 manifest has no languageDetectorVersion",
      "schema 1.1.0 manifest has no languageRule",
    ]);
    expect(run({ ...manifest, ...stamp0() })).toEqual([]);
  });
});

function stamp0() {
  return {
    languageRule: LANGUAGE_STRATUM_RULE,
    languageDetectorVersion: LANGUAGE_DETECTOR_VERSION,
  };
}

describe("F4: a new 1.0.0 freeze must declare its language", () => {
  it("refuses a row without a language, and says to use schema 1.1.0", () => {
    expect(() => freezeFrame([row()], { frameId: "f" })).toThrow(
      "row dispatch-1/range_km has no language; schema 1.0.0 does not record a detector, use schemaVersion 1.1.0",
    );
  });

  it("still freezes a row that declares one", () => {
    expect(freezeFrame([row({ language: "unknown" })], { frameId: "f" }).units).toHaveLength(1);
  });
});
