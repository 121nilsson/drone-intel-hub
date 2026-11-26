import { describe, expect, it } from "vitest";
import {
  LANGUAGE_DETECTOR_VERSION,
  RUSSIAN_MARKERS,
  UKRAINIAN_MARKERS,
  detectLanguageWithEvidence,
  detectLanguageWithVariant,
} from "@/entities/normalization/language";
import { summariseDecisions } from "@/entities/normalization/language-accuracy";

/**
 * The frozen channel W table (D0 revision 3, corrected in detector 3.1.0). A change here is a
 * reviewed change and a version bump. 3.1.0 removed заявив, упав, яка and яке from the Ukrainian side.
 */
const FROZEN_RU =
  "что его как когда только сейчас очень даже или где она они которая которое которого сообщил сообщила сообщают заявил упал летел составляет около ночью также после сегодня нет".split(
    " ",
  );
const FROZEN_UK =
  "що це його якщо вже дуже або але вона вони був була було який якого близько також мають можна ще теж чому".split(
    " ",
  );

describe("channel W marker lists (D0 revision 3)", () => {
  it("is exactly the frozen table, in both languages", () => {
    expect(RUSSIAN_MARKERS.map((x) => x.word)).toEqual(FROZEN_RU);
    expect(UKRAINIAN_MARKERS.map((x) => x.word)).toEqual(FROZEN_UK);
  });

  it("gives every entry a reason and a note that it was checked against the other language", () => {
    for (const x of [...RUSSIAN_MARKERS, ...UKRAINIAN_MARKERS]) {
      expect(x.reason.length, x.word).toBeGreaterThan(3);
      expect(x.otherLanguage.length, x.word).toBeGreaterThan(10);
    }
    for (const x of RUSSIAN_MARKERS) expect(x.otherLanguage, x.word).toMatch(/^uk /);
    for (const x of UKRAINIAN_MARKERS) expect(x.otherLanguage, x.word).toMatch(/^ru /);
  });

  it("never lists a word with a distinctive letter, nor a removed or excluded word", () => {
    const all = [...RUSSIAN_MARKERS, ...UKRAINIAN_MARKERS].map((x) => x.word);
    for (const w of all) expect(w, w).not.toMatch(/[іїєґыэъё]/);
    for (const w of ["як", "становить", "та", "но", "уже", "коли", "де", "може", "зараз", "треба"])
      expect(all, w).not.toContain(w);
    // A word in both lists would be evidence for both languages.
    expect(RUSSIAN_MARKERS.filter((x) => UKRAINIAN_MARKERS.some((u) => u.word === x.word))).toEqual(
      [],
    );
    expect(new Set(all).size).toBe(all.length);
  });

  it("has 28 Russian and 22 Ukrainian markers", () => {
    expect(RUSSIAN_MARKERS).toHaveLength(28);
    expect(UKRAINIAN_MARKERS).toHaveLength(22);
  });

  it("lists neither заявив, упав, яка nor яке in either list (F1, detector 3.1.0)", () => {
    // заявив and упав are standard Russian perfective gerunds; яка and яке are case forms of the
    // Russian noun "як" (yak). Their old cross-language check was wrong, and none is replaced.
    const all = [...RUSSIAN_MARKERS, ...UKRAINIAN_MARKERS].map((x) => x.word);
    for (const w of ["заявив", "упав", "яка", "яке"]) expect(all, w).not.toContain(w);
    // The Russian perfect-tense forms stay: they are Russian-only.
    expect(RUSSIAN_MARKERS.map((x) => x.word)).toEqual(expect.arrayContaining(["заявил", "упал"]));
  });

  it("is versioned", () => {
    expect(LANGUAGE_DETECTOR_VERSION).toBe("3.1.0");
  });
});

describe("decision rule (D0 revision 3)", () => {
  it("is not decisive on one channel only: має and дальність are both letter evidence", () => {
    const d = detectLanguageWithEvidence("Дрон має дальність польоту 250 км.");
    // Fallback is the old rule: two Ukrainian-only letters (є, і) give uk, so routing is unchanged.
    expect(d).toMatchObject({ language: "uk", decisive: false, reason: "cyrillic_undetermined" });
    expect(d.evidence.ukrainianChannels).toEqual(["L"]);
    expect(d.evidence.ukrainianEvidenceDistinct).toBe(2);
  });

  it("is decisive uk with evidence from both channels, and decisive ru likewise", () => {
    const uk = detectLanguageWithEvidence("Дрон вже має дальність польоту 250 км.");
    expect(uk).toMatchObject({ language: "uk", decisive: true, reason: "cyrillic_uk_letters" });
    expect(uk.evidence).toMatchObject({
      ukrainianEvidenceDistinct: 3,
      ukrainianChannels: ["L", "W"],
      russianEvidenceDistinct: 0,
    });
    const ru = detectLanguageWithEvidence(
      "Дрон сообщил, что экипажа нет, а дальность около 40 км.",
    );
    expect(ru).toMatchObject({ language: "ru", decisive: true });
    expect(ru.evidence.russianChannels).toEqual(["L", "W"]);
  });

  it("counts a repeated word once, but keeps the occurrences", () => {
    const d = detectLanguageWithEvidence("Видел, что дальность большая, что вес тоже.");
    expect(d.evidence.russianEvidenceOccurrences).toBe(2);
    expect(d.evidence.russianEvidenceDistinct).toBe(1);
    expect(d.decisive).toBe(false);
  });

  it("is not decisive on one word, however often it repeats", () => {
    const d = detectLanguageWithEvidence("Штаб сказал, что, что, что и что тоже.");
    expect(d.decisive).toBe(false);
    expect(d.reason).toBe("cyrillic_undetermined");
  });

  it("lets a sentence-initial marker count, but not a capitalised mid-sentence one", () => {
    const initial = detectLanguageWithEvidence("Сейчас дрон упал над полем, сообщил штаб.");
    expect(initial.evidence.russianEvidenceDistinct).toBe(3);
    const mid = detectLanguageWithEvidence("Штаб сообщил Нет и Что сегодня над полем дрон.");
    expect(mid.evidence.russianEvidenceDistinct).toBe(2); // сообщил, сегодня
  });

  it("ignores marker words inside quotations", () => {
    const d = detectLanguageWithEvidence("Штаб написал «что нет» и «его нет» над полем дрона.");
    expect(d.evidence.russianEvidenceDistinct).toBe(0);
  });

  it("is non-decisive on conflict: cyrillic_mixed when channel L alone conflicts", () => {
    const l = detectLanguageWithEvidence("Дрон має дальність, а экипаж сообщил о запуске.");
    expect(l).toMatchObject({ decisive: false, reason: "cyrillic_mixed" });
  });

  it("is non-decisive on conflict: conflicting_evidence otherwise, with the old fallback language", () => {
    const d = detectLanguageWithEvidence("Дрон має дальність польоту, он сообщил, что нет.");
    expect(d).toMatchObject({ decisive: false, reason: "conflicting_evidence" });
    // The old rule: 2 or more Ukrainian-only letters in the whole text, else ru.
    expect(d.language).toBe(d.evidence.ukrainianOnly >= 2 ? "uk" : "ru");
  });

  it("variant B needs both channels, variant A only two distinct words", () => {
    const wOnly = "Сейчас дрон упал над полем, сообщил штаб.";
    expect(detectLanguageWithVariant(wOnly, "A")).toMatchObject({ language: "ru", decisive: true });
    expect(detectLanguageWithVariant(wOnly, "B").decisive).toBe(false);
    const lOnly = "Аппарат имеет объём бака и тяжёлую часть.";
    expect(detectLanguageWithVariant(lOnly, "A")).toMatchObject({ language: "ru", decisive: true });
    expect(detectLanguageWithVariant(lOnly, "B").decisive).toBe(false);
  });

  it("uses variant B in production", () => {
    const wOnly = "Сейчас дрон упал над полем, сообщил штаб.";
    expect(detectLanguageWithEvidence(wOnly)).toEqual(detectLanguageWithVariant(wOnly, "B"));
  });

  it("never puts text in the evidence", () => {
    const d = detectLanguageWithEvidence("Дрон вже має дальність польоту 250 км.");
    const json = JSON.stringify(d);
    expect(json).not.toContain("дальність");
    expect(json).not.toContain("вже");
  });
});

describe("summariseDecisions", () => {
  it("counts rows, decisive and false-decisive per category, and lists ids only", () => {
    const fake = (text: string) =>
      text === "uk"
        ? { language: "uk" as const, decisive: true }
        : text === "ru"
          ? { language: "ru" as const, decisive: true }
          : { language: "ru" as const, decisive: false };
    const s = summariseDecisions(
      [
        { id: "a", category: "x", text: "uk", allowedDecisive: "uk" },
        { id: "b", category: "x", text: "ru", allowedDecisive: "uk" }, // wrong language
        { id: "c", category: "y", text: "ru", allowedDecisive: null }, // no claim allowed
        { id: "d", category: "y", text: "none", allowedDecisive: "ru" },
      ],
      fake,
    );
    expect(s.total).toEqual({ rows: 4, decisive: 3, falseDecisive: 2, nonDecisiveRate: 0.25 });
    expect(s.categories).toEqual([
      { category: "x", rows: 2, decisive: 2, falseDecisive: 1, nonDecisiveRate: 0 },
      { category: "y", rows: 2, decisive: 1, falseDecisive: 1, nonDecisiveRate: 0.5 },
    ]);
    expect(s.falseDecisiveIds).toEqual(["b", "c"]);
    expect(JSON.stringify(s)).not.toContain('"text"');
  });

  it("is empty-safe", () => {
    expect(summariseDecisions([], () => ({ language: "ru", decisive: false })).total).toEqual({
      rows: 0,
      decisive: 0,
      falseDecisive: 0,
      nonDecisiveRate: 0,
    });
  });
});

describe("Russian gerunds and Ukrainian homographs (detector 3.1.0)", () => {
  // Reproduced with 3.0.0: Russian text with one stray Ukrainian letter was decisive uk.
  const FIXED_FALSE_DECISIVE = [
    "Беспилотник, упав в поле, загорелся; позже нашли обломки і детали.",
    "Дрон, упав на поле, взорвался, о жертвах не сообщали і пожар потушен.",
  ];

  it("keeps Russian text with a stray Ukrainian letter and a Russian gerund non-decisive", () => {
    for (const text of FIXED_FALSE_DECISIVE) {
      const d = detectLanguageWithEvidence(text);
      expect(d.decisive, text).toBe(false);
      expect(d.reason, text).toBe("cyrillic_undetermined");
      expect(d.language, text).toBe("ru");
      expect(d.evidence.ukrainianChannels, text).toEqual(["L"]);
    }
  });

  it("no longer reports a conflict for a Russian gerund or the noun як", () => {
    for (const text of [
      "Министр, заявив о задержке, сказал, что поставки продолжатся.",
      "Ракета, упав в реку, не взорвалась, и экипаж остался жив.",
      "На ферме держат яка, а корма для яка хватает до весны.",
    ]) {
      const d = detectLanguageWithEvidence(text);
      expect(d.reason, text).not.toBe("conflicting_evidence");
      expect(d.evidence.ukrainianEvidenceDistinct, text).toBe(0);
    }
    expect(
      detectLanguageWithEvidence("Губернатор, заявив об атаке, сообщил, что дрон был сбит."),
    ).toMatchObject({ language: "ru", decisive: true, reason: "cyrillic_ru_letters" });
  });

  it("stays non-decisive on a real conflict that still has Ukrainian evidence", () => {
    for (const text of [
      "Командир заявив, що дрон упав, а экипаж сообщил, что его нет.",
      "Дрон має дальність польоту, он сообщил, что нет.",
    ]) {
      const d = detectLanguageWithEvidence(text);
      expect(d.decisive, text).toBe(false);
      expect(d.reason, text).toBe("conflicting_evidence");
    }
  });

  it("stays decisive uk on Ukrainian text that uses заявив, упав, яка or яке next to other evidence", () => {
    for (const text of [
      "Губернатор заявив про атаку і повідомив, що дрон було збито вночі.",
      "Дрон упав на поле, яке належить фермеру, і вибухнув ще вночі.",
      "Ракета, яка летіла над містом, була збита вже вночі.",
    ]) {
      expect(detectLanguageWithEvidence(text), text).toMatchObject({
        language: "uk",
        decisive: true,
      });
    }
  });
});
