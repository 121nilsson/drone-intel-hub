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
  // Package 1 of the D0 review: other Cyrillic languages are outside the detector's two-language
  // model, so no decisive result is acceptable (allowed null). Rows that the current detector
  // stamps decisive anyway are marked: they are reproduced defects, not fixed here.
  "Other Cyrillic languages": [
    { text: "Беспілотнік упаў у поле каля вёскі, але лётчык застаўся жывы.", allowed: null },
    {
      text: "Дальнасць палёту апарата складае каля 40 кіламетраў, а вага — 12 кілаграмаў.",
      allowed: null,
    },
    { text: "Мы ўбачылі, што дрон ляцеў вельмі нізка над ракой.", allowed: null },
    { text: "Гэты апарат мае дальнасць каля 150 км і ўзлятае з любой пляцоўкі.", allowed: null },
    {
      text: "Апарат цяжкі, але мае вялікую дальнасць і ўзлятае або садзіцца без пляцоўкі.",
      allowed: null,
      knownFalseDecisive: true,
    },
    { text: "Дронът падна в полето край селото, но пилотът е жив.", allowed: null },
    { text: "Този апарат има обхват около 40 километра и тежи 12 килограма.", allowed: null },
    {
      text: "Съобщиха, че безпилотният самолет е летял много ниско над реката.",
      allowed: null,
    },
    { text: "Максималната височина на полета е четири хиляди метра.", allowed: null },
    {
      text: "Дронът има дълъг обхват, или поне така казват, около 40 км и тежи малко.",
      allowed: null,
      knownFalseDecisive: true,
    },
    {
      text: "Как лети дронът, който е дълъг два метра, около пет километра над реката?",
      allowed: null,
      knownFalseDecisive: true,
    },
    {
      text: "Самолетът е тънък и дълъг, или поне така изглежда, а тежи около 12 кг.",
      allowed: null,
      knownFalseDecisive: true,
    },
    {
      text: "Дронът е със силен двигател, който е тежък, около 8 кг, и като е дълъг, не лети далеч.",
      allowed: null,
      knownFalseDecisive: true,
    },
  ],
  // Detector 3.1.0 (package 2, finding F1): заявив and упав are standard Russian perfective gerunds
  // and яка, яке are case forms of the Russian noun "як" (yak), so none of them is Ukrainian
  // evidence. The first three rows are the independent reviewer's reproductions, verbatim.
  "Russian gerunds and Ukrainian homographs": [
    { text: "Беспилотник, упав в поле, загорелся; позже нашли обломки і детали.", allowed: "ru" },
    {
      text: "Дрон, упав на поле, взорвался, о жертвах не сообщали і пожар потушен.",
      allowed: "ru",
    },
    { text: "Губернатор, заявив об атаке, сообщил, что дрон был сбит.", allowed: "ru" },
    { text: "Министр, заявив о задержке, сказал, что поставки продолжатся.", allowed: "ru" },
    { text: "Ракета, упав в реку, не взорвалась, и экипаж остался жив.", allowed: "ru" },
    {
      text: "Мальчик, упав с велосипеда, сказал, что очень болит рука, і мама вызвала врача.",
      allowed: "ru",
    },
    { text: "Командир, прочитав приказ и заявив протест, ушёл со сцены.", allowed: "ru" },
    { text: "На ферме держат яка, а корма для яка хватает до весны.", allowed: "ru" },
    {
      text: "Туристы сфотографировали яка, пасшегося у перевала, и целое стадо яков.",
      allowed: "ru",
    },
    { text: "Губернатор заявив про атаку і повідомив, що дрон було збито вночі.", allowed: "uk" },
    { text: "Дрон упав на поле, яке належить фермеру, і вибухнув ще вночі.", allowed: "uk" },
    { text: "Ракета, яка летіла над містом, була збита вже вночі.", allowed: "uk" },
    { text: "Командир заявив, що дрон упав, а экипаж сообщил, что его нет.", allowed: null },
  ],
  // Package 2 independence check (2026-11-27): written by a separate author who was told only which
  // four words were removed and why, and who saw neither the reviewer's reproductions, the rows
  // above, the detector nor its word lists. Not tuned against the detector.
  "Russian gerunds and Ukrainian homographs, independent author": [
    {
      text: "Заявив о готовности к переговорам, министр покинул зал заседаний, не ответив на вопросы журналистов.",
      allowed: "ru",
    },
    {
      text: "Дрон потерял управление и, упав на крышу склада, повредил антенну связи.",
      allowed: "ru",
    },
    {
      text: "Командир вышел к журналистам, заявив, что операция завершена. Позже он, не получив подтверждения, отказался от комментариев.",
      allowed: "ru",
    },
    {
      text: "Когда беспилотник, упав в поле, взорвался, жители соседней деревни услышали сильный хлопок.",
      allowed: "ru",
    },
    { text: "Заявив протест и упав духом, он ушёл с собрания.", allowed: "ru" },
    { text: "Эксперт ответил, заявив, что цены вырастут.", allowed: "ru" },
    { text: "В зоопарке мы увидели яка, которого кормили сеном.", allowed: "ru" },
    {
      text: "Путешественники купили у пастуха молоко яка и сыр, сделанный из него.",
      allowed: "ru",
    },
    { text: "Фермер рассказал о яке, который пасётся на склоне.", allowed: "ru" },
    { text: "Туристы много говорили о яке, встреченном на перевале.", allowed: "ru" },
    { text: "Речник заявив, що нові дрони надійдуть до війська наприкінці місяця.", allowed: "uk" },
    { text: "Безпілотник втратив зв'язок і упав у річку неподалік від мосту.", allowed: "uk" },
    { text: "Це була компанія, яка виробляє радіостанції для підрозділів зв'язку.", allowed: "uk" },
    { text: "Це рішення, яке ухвалили вчора, викликало суперечки.", allowed: "uk" },
    {
      text: "Мер заявив про нову програму, яка допоможе родинам, що втратили домівки.",
      allowed: "uk",
    },
    { text: "Заявив, що прийде.", allowed: "uk" },
    {
      text: "Президент заявил о новых мерах поддержки. Речник заявив, що підтримка надійде вже наступного тижня.",
      allowed: null,
    },
    { text: "Упав с лестницы, он сломал руку.", allowed: "ru" },
  ],
};
