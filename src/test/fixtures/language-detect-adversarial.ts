/**
 * Adversarial review set for D0 (2026-11-26), written independently of the detector and its corpus.
 *
 * The question is not "how many texts get a language" but "does every decisive stamp deserve it".
 * `allowed` is the only language a decisive result may claim; `null` means the text genuinely mixes
 * Russian and Ukrainian, so no decisive result is acceptable.
 *
 * Revision 3 (two evidence channels, variant B) cleared all ten rows that the committed rule
 * got wrong, so no row is marked any more. `knownFalseDecisive` stays available: a row that is a
 * reproduced defect uses `it.fails`, which turns red the moment a fix lands. Do not "fix" a row by
 * changing its `allowed` value.
 */
export interface AdversarialRow {
  readonly text: string;
  readonly allowed: "ru" | "uk" | "en" | null;
  readonly knownFalseDecisive?: true;
}

export const ADVERSARIAL_CATEGORIES: Readonly<Record<string, readonly AdversarialRow[]>> = {
  "Russian with one Ukrainian-only letter in an ordinary word": [
    { text: "Дрон пролетел над рекой і упал в поле.", allowed: "ru" },
    { text: "По данным розвідки, дрон сбит над городом.", allowed: "ru" },
    { text: "Беспилотник атаковал позиции, сили ПВО отработали.", allowed: "ru" },
    {
      text: "Аппарат весит 12 кг, его дальність около 40 км.",
      allowed: "ru",
    },
    { text: "В сводке сказано, что дрон упал на поле, а пiлот жив.", allowed: "ru" },
    { text: "Скорость дрона 120 км/ч, висота полета около 2 км.", allowed: "ru" },
  ],
  "Ukrainian with one Russian-only letter in an ordinary word": [
    { text: "Дрон збито над морем, экипаж врятовано.", allowed: "uk" },
    { text: "Апарат має вагу 12 кг, а объем баку 5 л.", allowed: "uk" },
    { text: "Дрон упав на поле, обломки зібрали саперы.", allowed: "uk" },
    { text: "Швидкість дрона становить 120 км/год, ёмність батареї мала.", allowed: "uk" },
    { text: "Ворожий дрон летів низько, его збили.", allowed: "uk" },
  ],
  "Mixed text where one language form occurs once": [
    { text: "Дрон летел 300 км, потім упал.", allowed: null },
    { text: "Ракета попала в склад, загинув охоронець.", allowed: null },
    { text: "Дрон збито, сообщили военные.", allowed: null },
    { text: "Апарат пролетів 200 км и упал.", allowed: null },
  ],
  "Several sentences where the language switches": [
    {
      text: "Дрон сбит над городом. Дрон збито над містом.",
      allowed: null,
    },
    { text: "Скорость дрона 120 км/ч. Швидкість дрона 120 км/год.", allowed: null },
    { text: "Дальность полета 300 км. Дальність польоту 300 км.", allowed: null },
    {
      text: "Ворожий дрон збито вночі. Подробности уточняются.",
      allowed: null,
    },
    {
      text: "Подробности уточняются. Ворожий дрон збито вночі над містом.",
      allowed: null,
    },
    {
      text: "Дрон упал. Его обломки нашли. Уламки дрона зібрали вранці.",
      allowed: null,
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
