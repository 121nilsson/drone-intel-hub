import { describe, expect, it } from "vitest";
import { detectLanguageWithEvidence } from "@/entities/normalization/language";

/**
 * Adversarial review set for D0 (2026-11-26), written independently of the detector and its corpus.
 *
 * The question is not "how many texts get a language" but "does every decisive stamp deserve it".
 * `allowed` is the only language a decisive result may claim; `null` means the text genuinely mixes
 * Russian and Ukrainian, so no decisive result is acceptable.
 *
 * Rows marked `knownFalseDecisive` are reproduced defects of the committed rule (a single
 * distinctive letter in one ordinary word is enough to be decisive). They use `it.fails`, so the
 * suite stays green while the defect exists and turns red the moment a rule change fixes it — at
 * that point move the row to the passing set. Do not "fix" a row by changing its `allowed` value.
 */
interface AdversarialRow {
  readonly text: string;
  readonly allowed: "ru" | "uk" | "en" | null;
  readonly knownFalseDecisive?: true;
}

const CATEGORIES: Readonly<Record<string, readonly AdversarialRow[]>> = {
  "Russian with one Ukrainian-only letter in an ordinary word": [
    { text: "Дрон пролетел над рекой і упал в поле.", allowed: "ru", knownFalseDecisive: true },
    { text: "По данным розвідки, дрон сбит над городом.", allowed: "ru" },
    { text: "Беспилотник атаковал позиции, сили ПВО отработали.", allowed: "ru" },
    {
      text: "Аппарат весит 12 кг, его дальність около 40 км.",
      allowed: "ru",
      knownFalseDecisive: true,
    },
    { text: "В сводке сказано, что дрон упал на поле, а пiлот жив.", allowed: "ru" },
    { text: "Скорость дрона 120 км/ч, висота полета около 2 км.", allowed: "ru" },
  ],
  "Ukrainian with one Russian-only letter in an ordinary word": [
    { text: "Дрон збито над морем, экипаж врятовано.", allowed: "uk", knownFalseDecisive: true },
    { text: "Апарат має вагу 12 кг, а объем баку 5 л.", allowed: "uk" },
    { text: "Дрон упав на поле, обломки зібрали саперы.", allowed: "uk" },
    { text: "Швидкість дрона становить 120 км/год, ёмність батареї мала.", allowed: "uk" },
    { text: "Ворожий дрон летів низько, его збили.", allowed: "uk" },
  ],
  "Mixed text where one language form occurs once": [
    { text: "Дрон летел 300 км, потім упал.", allowed: null, knownFalseDecisive: true },
    { text: "Ракета попала в склад, загинув охоронець.", allowed: null },
    { text: "Дрон збито, сообщили военные.", allowed: null, knownFalseDecisive: true },
    { text: "Апарат пролетів 200 км и упал.", allowed: null, knownFalseDecisive: true },
  ],
  "Several sentences where the language switches": [
    {
      text: "Дрон сбит над городом. Дрон збито над містом.",
      allowed: null,
      knownFalseDecisive: true,
    },
    { text: "Скорость дрона 120 км/ч. Швидкість дрона 120 км/год.", allowed: null },
    { text: "Дальность полета 300 км. Дальність польоту 300 км.", allowed: null },
    {
      text: "Ворожий дрон збито вночі. Подробности уточняются.",
      allowed: null,
      knownFalseDecisive: true,
    },
    {
      text: "Подробности уточняются. Ворожий дрон збито вночі над містом.",
      allowed: null,
      knownFalseDecisive: true,
    },
    {
      text: "Дрон упал. Его обломки нашли. Уламки дрона зібрали вранці.",
      allowed: null,
      knownFalseDecisive: true,
    },
  ],
  "Short technical text with foreign words and model designations": [
    { text: "Shahed-136: дальность 2500 км, скорость 185 км/ч.", allowed: "ru" },
    { text: "Shahed-136: дальність 2500 км, швидкість 185 км/год.", allowed: "uk" },
    { text: "Ланцет-3 (Izdeliye 53), масса БЧ 3 кг.", allowed: "ru" },
    { text: "Bayraktar TB2 має розмах крил 12 м і дальність 150 км.", allowed: "uk" },
    { text: "Orlan-10: MTOW 18 кг, потолок 5000 м, GPS/ГЛОНАСС.", allowed: "ru" },
    { text: "Mavic 3 Pro, DJI O3+, 43 хв, 28 км.", allowed: null },
    { text: "Герань-2 / Shahed-136, 50 кг, 2500 км.", allowed: null },
    { text: "Модель FPV-дрона з дальністю 10 км та камерою Caddx.", allowed: "uk" },
  ],
};

/** A decisive stamp is deserved only when it names the one allowed language. */
function deservesItsStamp(row: AdversarialRow): boolean {
  const d = detectLanguageWithEvidence(row.text);
  return !d.decisive || (row.allowed !== null && d.language === row.allowed);
}

describe("D0 adversarial review: every decisive language stamp is deserved", () => {
  for (const [category, rows] of Object.entries(CATEGORIES)) {
    describe(category, () => {
      for (const row of rows) {
        const title = `${row.allowed ?? "mixed"}: ${row.text}`;
        if (row.knownFalseDecisive) {
          it.fails(`KNOWN FALSE-DECISIVE (open D0 defect) — ${title}`, () => {
            expect(deservesItsStamp(row)).toBe(true);
          });
        } else {
          it(title, () => {
            expect(deservesItsStamp(row)).toBe(true);
          });
        }
      }
    });
  }

  it("records the size of the open defect (update deliberately when the rule changes)", () => {
    const all = Object.values(CATEGORIES).flat();
    expect(all).toHaveLength(29);
    expect(all.filter((r) => r.knownFalseDecisive)).toHaveLength(10);
  });
});
