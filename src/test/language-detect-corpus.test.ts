import { describe, expect, it } from "vitest";
import {
  LANGUAGE_DETECTION_REASONS,
  detectLanguage,
  detectLanguageWithEvidence,
} from "@/entities/normalization/language";
import { languageDetectionAccuracy } from "@/entities/normalization/language-accuracy";
import { LANGUAGE_CORPUS, type LanguageCorpusCategory } from "./fixtures/language-detect-corpus";

describe("language detection corpus (hand-written, origin fixture)", () => {
  it("has at least five rows in every category", () => {
    const counts = new Map<LanguageCorpusCategory, number>();
    for (const r of LANGUAGE_CORPUS) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    expect([...counts.keys()].sort()).toEqual(
      [
        "english",
        "initial_word_only",
        "mixed_ru_uk",
        "quotation_only",
        "ru_mentions_uk_names",
        "ru_starts_with_uk_name",
        "ru_no_distinctive_letters",
        "short_ru_distinctive",
        "short_uk_one_letter",
        "technical_keys",
        "transliteration",
        "uk_mentions_ru_names",
        "uk_starts_with_ru_name",
        "uk_no_distinctive_letters",
      ].sort(),
    );
    for (const [category, n] of counts) expect(n, category).toBeGreaterThanOrEqual(5);
  });

  it("matches the expected language and decisiveness on every row", () => {
    const wrong = LANGUAGE_CORPUS.flatMap((r) => {
      const d = detectLanguageWithEvidence(r.text);
      return d.language === r.expectedLanguage && d.decisive === r.expectedDecisive
        ? []
        : [`${r.category}: ${r.text} -> ${d.language}/${d.decisive}/${d.reason}`];
    });
    expect(wrong).toEqual([]);
  });

  it("has no decisive ru<->uk confusion against the true language", () => {
    const report = languageDetectionAccuracy(
      LANGUAGE_CORPUS.map((r) => ({
        truth: r.trueLanguage,
        detection: detectLanguageWithEvidence(r.text),
      })),
    );
    expect(report.decisiveRuUkConfusions).toBe(0);
    expect(report.decisiveErrors).toBe(0);
  });

  it("changes the pre-D0 answer only where the new rule is decisive, and never for a name", () => {
    // Pre-D0 rule: Cyrillic share above 0.4, then uk iff 2 or more Ukrainian-only letters, else ru.
    const old = (t: string) => {
      const d = detectLanguageWithEvidence(t);
      if (d.reason.startsWith("cyrillic")) return d.evidence.ukrainianOnly >= 2 ? "uk" : "ru";
      return d.language;
    };
    for (const r of LANGUAGE_CORPUS) {
      const d = detectLanguageWithEvidence(r.text);
      if (d.language !== old(r.text)) expect(d.decisive, r.text).toBe(true);
      if (!d.decisive) expect(d.language, r.text).toBe(old(r.text));
    }
  });

  it("is not fooled by a Ukrainian name in Russian text, nor the reverse", () => {
    for (const t of [
      "Дрон атаковал Київ ночью, сообщили в штабе.",
      "Беспилотник упал под Харковом, пишет агентство Укрінформ.",
      "Агентство Укрінформ сообщает о новом дроне.",
      "Источник в Києві сообщил о запуске.",
      "Максимальная скорость изделия составляет 180 км/ч, передает Укрінформ.",
    ]) {
      const d = detectLanguageWithEvidence(t);
      expect(d.decisive, t).toBe(false);
      expect(d.evidence.ukrainianOnlyInNames, t).toBeGreaterThan(0);
    }
    expect(detectLanguageWithEvidence("Дрон збили над Крым, пише агентство.").decisive).toBe(false);
  });

  it("is not decisive when the distinctive letters sit only in names, first words or quotations", () => {
    // An independent, deliberately plain re-implementation of "ordinary word": not quoted, not
    // capitalised or all-caps, not the first word of the text or of a sentence (. ! ? : newline).
    const ordinaryLetters = (text: string) => {
      const unquoted = text.replace(/«[^»]*»|„[^“”]*[“”]|"[^"]*"/g, " q ");
      let uk = 0;
      let ru = 0;
      for (const segment of unquoted.split(/[.!?:\n]+/)) {
        const words = segment.split(/[^\p{L}'’ʼ]+/u).filter(Boolean);
        for (const w of words.slice(1)) {
          if (w[0] !== w[0]!.toLowerCase()) continue;
          uk += (w.match(/[іїєґ]/g) ?? []).length;
          ru += (w.match(/[ыэъё]/g) ?? []).length;
        }
      }
      return { uk, ru };
    };
    let checked = 0;
    for (const r of LANGUAGE_CORPUS) {
      const d = detectLanguageWithEvidence(r.text);
      if (!d.reason.startsWith("cyrillic")) continue;
      const { uk, ru } = ordinaryLetters(r.text);
      if (uk === 0 && ru === 0) {
        expect(d.decisive, r.text).toBe(false);
        checked++;
      } else if (uk > 0 && ru > 0) {
        expect(d.decisive, r.text).toBe(false);
      } else {
        // Since detector 3.0.0 one side's letters are necessary, not sufficient: when the result is
        // decisive it is that side's language, and both channels stand behind it (variant B).
        if (d.decisive) {
          expect(d.language, r.text).toBe(uk > 0 ? "uk" : "ru");
          const channels = uk > 0 ? d.evidence.ukrainianChannels : d.evidence.russianChannels;
          expect(channels, r.text).toEqual(["L", "W"]);
        }
      }
    }
    expect(checked).toBeGreaterThan(30);
  });

  it("never marks unknown as decisive and always gives a registered reason", () => {
    for (const r of LANGUAGE_CORPUS) {
      const d = detectLanguageWithEvidence(r.text);
      if (d.language === "unknown") expect(d.decisive, r.text).toBe(false);
      expect(LANGUAGE_DETECTION_REASONS).toContain(d.reason);
      expect(detectLanguage(r.text)).toBe(d.language);
    }
  });

  it("reports the evidence as counts and flags undecidable Cyrillic", () => {
    const d = detectLanguageWithEvidence("Корисне навантаження становить 35 кг.");
    expect(d).toMatchObject({ language: "ru", decisive: false, reason: "cyrillic_undetermined" });
    expect(d.evidence).toMatchObject({ latin: 0, ukrainianOnly: 0, russianOnly: 0 });
    expect(d.evidence.cyrillic).toBeGreaterThan(12);
    expect(JSON.stringify(d)).not.toContain("навантаження");
  });
});

describe("Language Detection Accuracy helper", () => {
  const s = (
    truth: "en" | "ru" | "uk" | "unknown",
    language: "en" | "ru" | "uk" | "unknown",
    decisive: boolean,
  ) => ({ truth, detection: { language, decisive } });

  it("builds the confusion matrix, the decisive rate and the critical cell", () => {
    const r = languageDetectionAccuracy([
      s("uk", "uk", true),
      s("uk", "ru", false), // non-decisive fallback: a miss, but not a decisive confusion
      s("ru", "uk", true), // the critical cell
      s("en", "en", true),
      s("unknown", "unknown", false),
    ]);
    expect(r.total).toBe(5);
    expect(r.matrix.uk).toEqual({ en: 0, ru: 1, uk: 1, unknown: 0 });
    expect(r.matrix.ru.uk).toBe(1);
    expect(r.decisiveCount).toBe(3);
    expect(r.decisiveRate).toBeCloseTo(0.6);
    expect(r.decisiveErrors).toBe(1);
    expect(r.decisiveRuUkConfusions).toBe(1);
  });

  it("is empty-safe", () => {
    const r = languageDetectionAccuracy([]);
    expect(r).toMatchObject({ total: 0, decisiveRate: 0, decisiveRuUkConfusions: 0 });
  });
});
