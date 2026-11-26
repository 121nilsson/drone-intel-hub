import type { DetectedLanguage } from "@/entities/normalization/language";

/**
 * Hand-written language corpus for D0 of the v1.3.0 plan. Test data, `origin: "fixture"`: every
 * sentence is invented for this file and none is a real report.
 *
 * Each row has two labels that must not be confused:
 * - `trueLanguage`: what a person reading the text would say it is;
 * - `expectedLanguage` / `expectedDecisive`: what the detector is required to answer. For Cyrillic
 *   text with no distinguishing letter that is a non-decisive `ru` whatever the true language is
 *   (D0-Q1 option a); the point of `decisive: false` is that nobody may rely on it.
 */
export type LanguageCorpusCategory =
  | "short_uk_one_letter"
  | "short_ru_distinctive"
  | "uk_no_distinctive_letters"
  | "ru_no_distinctive_letters"
  | "mixed_ru_uk"
  | "technical_keys"
  | "transliteration"
  | "english"
  | "ru_mentions_uk_names"
  | "uk_mentions_ru_names"
  | "initial_word_only"
  | "ru_starts_with_uk_name"
  | "uk_starts_with_ru_name"
  | "quotation_only";

export interface LanguageCorpusRow {
  readonly category: LanguageCorpusCategory;
  readonly text: string;
  readonly trueLanguage: DetectedLanguage;
  readonly expectedLanguage: DetectedLanguage;
  readonly expectedDecisive: boolean;
  readonly origin: "fixture";
}

const row = (
  category: LanguageCorpusCategory,
  text: string,
  trueLanguage: DetectedLanguage,
  expectedLanguage: DetectedLanguage,
  expectedDecisive: boolean,
): LanguageCorpusRow => ({
  category,
  text,
  trueLanguage,
  expectedLanguage,
  expectedDecisive,
  origin: "fixture",
});

export const LANGUAGE_CORPUS: readonly LanguageCorpusRow[] = [
  // Short Ukrainian whose distinctive letter is in an ordinary word (lower-case, not the first word
  // of a sentence, not quoted): decisive uk. A letter that only the first word carries is not enough
  // (see initial_word_only).
  row("short_uk_one_letter", "Ця дальність польоту — 250 км.", "uk", "ru", false),
  row("short_uk_one_letter", "Ця потужність двигуна — 80 кВт.", "uk", "ru", false),
  row("short_uk_one_letter", "Заявлена швидкість польоту — 120 км/год.", "uk", "ru", false),
  row("short_uk_one_letter", "Розрахункова вартість одного борту — 35 тисяч.", "uk", "ru", false),
  row(
    "short_uk_one_letter",
    "Максимальна висота польоту — 4000 м, а швидкість мала.",
    "uk",
    "ru",
    false,
  ),
  row("short_uk_one_letter", "Дрон має дальність польоту 250 км.", "uk", "uk", false),

  // Short Russian with ы, э, ъ or ё in an ordinary word: decisive ru.
  row("short_ru_distinctive", "Дальность полёта составляет 250 км.", "ru", "ru", true),
  row("short_ru_distinctive", "Эта модель оснащена двигателем, а экипажа нет.", "ru", "ru", true),
  row("short_ru_distinctive", "Аппарат имеет объём бака 12 литров.", "ru", "ru", false),
  row("short_ru_distinctive", "Крылья аппарата складываются вдоль корпуса.", "ru", "ru", false),
  row("short_ru_distinctive", "Время подъёма на высоту — шесть минут.", "ru", "ru", false),
  row("short_ru_distinctive", "Ракета оснащена тяжёлой боевой частью.", "ru", "ru", false),

  // Ukrainian with no Ukrainian-only letter (no і, ї, є, ґ): the detector must not claim certainty.
  row("uk_no_distinctive_letters", "Корисне навантаження становить 35 кг.", "uk", "ru", false),
  row("uk_no_distinctive_letters", "Максимальна висота польоту — 4000 м.", "uk", "ru", false),
  row("uk_no_distinctive_letters", "Розмах крила становить 2,5 метра.", "uk", "ru", false),
  row("uk_no_distinctive_letters", "Двигун на валу — 80 кВт.", "uk", "ru", false),
  row("uk_no_distinctive_letters", "Бойова частина важить 50 кг.", "uk", "ru", false),
  row("uk_no_distinctive_letters", "Маса апарата становить 200 кг.", "uk", "ru", false),

  // Russian with no ы, э, ъ, ё: also not decisive (the same letters could be Ukrainian).
  row("ru_no_distinctive_letters", "Максимальная скорость составляет 120 км/ч.", "ru", "ru", false),
  row("ru_no_distinctive_letters", "Дальность действия составляет 40 км.", "ru", "ru", false),
  row("ru_no_distinctive_letters", "Масса боевой части составляет 50 кг.", "ru", "ru", false),
  row("ru_no_distinctive_letters", "Время полета достигает двух часов.", "ru", "ru", false),
  row(
    "ru_no_distinctive_letters",
    "Двигатель мощностью 80 кВт установлен сзади.",
    "ru",
    "ru",
    false,
  ),
  row(
    "ru_no_distinctive_letters",
    "Размах плоскости составляет два с половиной метра.",
    "ru",
    "ru",
    false,
  ),
  row("ru_no_distinctive_letters", "Мощность двигателя составляет 80 кВт.", "ru", "ru", false),

  // Mixed: Russian quoting a Ukrainian name (both letter sets: not decisive), and the reverse.
  row(
    "mixed_ru_uk",
    "Аппарат запустили из Київ, сообщили в штабе, дальность полёта 250 км.",
    "ru",
    "ru",
    false,
  ),
  row(
    "mixed_ru_uk",
    "Издание процитировало слова из Києва: объём поставок вырос втрое.",
    "ru",
    "ru",
    false,
  ),
  row(
    "mixed_ru_uk",
    "Агентство из Харкiв пишет, что мощность двигателя выросла, как сообщил Їжак.",
    "ru",
    "ru",
    true,
  ),
  row(
    "mixed_ru_uk",
    "Видання навело слова «подъём» і «объём» з російського повідомлення про дрон.",
    "uk",
    "uk",
    false,
  ),
  row(
    "mixed_ru_uk",
    "У повідомленні, процитованому українською, сказано: «экипаж отсутствует», а дальність становить 40 км.",
    "uk",
    "uk",
    false,
  ),
  row(
    "mixed_ru_uk",
    "Російське видання вживає слово «объём», а українське — обсяг, їх легко сплутати.",
    "uk",
    "uk",
    false,
  ),

  // Technical keys and English values: never a Cyrillic or English claim.
  row("technical_keys", "max_speed 120 km/h", "unknown", "unknown", false),
  row("technical_keys", "Geran-2", "unknown", "unknown", false),
  row("technical_keys", "range_km: 1000 | endurance_h: 6", "unknown", "unknown", false),
  row("technical_keys", "payload_kg=50", "unknown", "unknown", false),
  row("technical_keys", "wingspan 2.5 m; MTOW 200 kg", "unknown", "unknown", false),
  row("technical_keys", "Shahed-136 RU", "unknown", "unknown", false),

  // Transliterated Russian or Ukrainian: not English.
  row("transliteration", "dalnost", "unknown", "unknown", false),
  row("transliteration", "maksimalnaya skorost", "unknown", "unknown", false),
  row(
    "transliteration",
    "dalnost poleta sostavlyaet dvesti pyatdesyat kilometrov",
    "unknown",
    "unknown",
    false,
  ),
  row(
    "transliteration",
    "maksymalna shvydkist polotu stanovyt sto dvadtsat kilometriv na hodynu",
    "unknown",
    "unknown",
    false,
  ),
  row("transliteration", "poleznaya nagruzka 35 kg", "unknown", "unknown", false),
  row("transliteration", "potuzhnist dvyhuna", "unknown", "unknown", false),

  // English stays as it was: decisive.
  row(
    "english",
    "The drone has a range of 250 km and it can be launched from a truck by the crew.",
    "en",
    "en",
    true,
  ),
  row(
    "english",
    "Maximum speed is 120 km/h, which is more than the earlier model could reach.",
    "en",
    "en",
    true,
  ),
  row(
    "english",
    "The system, known in Russian as Герань, was used against the port in the south.",
    "en",
    "en",
    true,
  ),
  row(
    "english",
    "It was reported that the warhead of the aircraft is about 50 kg in weight.",
    "en",
    "en",
    true,
  ),
  row(
    "english",
    "The manufacturer says that the airframe can stay in the air for more than six hours.",
    "en",
    "en",
    true,
  ),
  // Both letter sets in ordinary words (not names, not quotations): not decisive.
  row("mixed_ru_uk", "Ця штука вже вышла на ринок, а потужність зросла.", "uk", "ru", false),
  row("mixed_ru_uk", "Это изделие вже вышло на рынок, а мощність выросла.", "ru", "ru", false),

  // Russian with no ы, э, ъ, ё that mentions Ukrainian names or outlets. A name never settles the
  // language: not decisive, and the language is the old rule's answer (2+ Ukrainian-only letters
  // in the whole text: uk, else ru), so routing is as before D0. The pre-fix detector called
  // several of these decisive uk.
  row("ru_mentions_uk_names", "Дрон атаковал Київ ночью, сообщили в штабе.", "ru", "ru", false),
  row(
    "ru_mentions_uk_names",
    "Беспилотник упал под Харковом, пишет агентство Укрінформ.",
    "ru",
    "ru",
    false,
  ),
  row("ru_mentions_uk_names", "Агентство Укрінформ сообщает о новом дроне.", "ru", "ru", false),
  row("ru_mentions_uk_names", "Источник в Києві сообщил о запуске.", "ru", "uk", false),
  row(
    "ru_mentions_uk_names",
    "Максимальная скорость изделия составляет 180 км/ч, передает Укрінформ.",
    "ru",
    "ru",
    false,
  ),
  row("ru_mentions_uk_names", "Из Дніпро сообщили о ночной атаке на склад.", "ru", "ru", false),
  row("ru_mentions_uk_names", "В Харків прилетели два дрона, сообщили жители.", "ru", "ru", false),
  row(
    "ru_mentions_uk_names",
    "Новость опубликовало издание Українська Правда вчера вечером.",
    "ru",
    "ru",
    false,
  ),

  // Ukrainian that mentions Russian names or outlets with ы or ё. Decisive uk only when an ordinary
  // word still carries a Ukrainian-only letter; otherwise not decisive (and never decisive ru).
  row("uk_mentions_ru_names", "Дрон збили над Крым, пише агентство.", "uk", "ru", false),
  row("uk_mentions_ru_names", "Ракета впала над Сызрань, пише агентство.", "uk", "ru", false),
  row("uk_mentions_ru_names", "Корисне навантаження вказано для Сызрань.", "uk", "ru", false),
  row("uk_mentions_ru_names", "Завод Ростех випускає двигуни для апарата.", "uk", "ru", false),
  row("uk_mentions_ru_names", "Агентство повідомляє про збій у Сызрань.", "uk", "uk", false),
  row("uk_mentions_ru_names", "Про «объём» поставок написали українські ЗМІ.", "uk", "uk", false),
  row(
    "uk_mentions_ru_names",
    "Дані про масу апарата з Крым наведені у таблиці.",
    "uk",
    "uk",
    false,
  ),
  row("uk_mentions_ru_names", "Дрон впав біля Ростех, повідомили у Ярославль.", "uk", "uk", false),

  // A distinctive letter that only the first word of a sentence carries is not evidence: that word
  // may be a name. Not decisive, and the language is the old rule's answer on the whole text.
  row("initial_word_only", "Швидкість польоту — 120 км/год.", "uk", "ru", false),
  row("initial_word_only", "Дальність польоту становить 250 км.", "uk", "ru", false),
  row("initial_word_only", "Потужність двигуна становить 80 кВт.", "uk", "ru", false),
  row("initial_word_only", "Экипаж аппарата отсутствует полностью.", "ru", "ru", false),
  row("initial_word_only", "Объём топливного бака — 12 литров.", "ru", "ru", false),
  row("initial_word_only", "Дрон упал под городом. Объём ущерба уточняется.", "ru", "ru", false),
  row("initial_word_only", "Дрон упав у воду. Швидкість польоту — 120 км.", "uk", "ru", false),

  // Russian that STARTS with a Ukrainian name, outlet or place: never decisive uk.
  row("ru_starts_with_uk_name", "Укрзалізниця сообщила о задержке поезда.", "ru", "ru", false),
  row(
    "ru_starts_with_uk_name",
    "Київ подвергся атаке дронов ночью, сообщили власти.",
    "ru",
    "ru",
    false,
  ),
  row(
    "ru_starts_with_uk_name",
    "Укрінформ: дальность полета дрона составляет 300 км.",
    "ru",
    "ru",
    false,
  ),
  row(
    "ru_starts_with_uk_name",
    "Дніпро атаковали беспилотники, пострадавших нет.",
    "ru",
    "ru",
    false,
  ),
  row(
    "ru_starts_with_uk_name",
    "Новости дня\nКиїв атакован дронами, сообщают власти.",
    "ru",
    "ru",
    false,
  ),
  row("ru_starts_with_uk_name", "Харків атакован дронами, сообщили власти.", "ru", "ru", false),
  row("ru_starts_with_uk_name", "Ізюм остался без света, сообщили власти.", "ru", "ru", false),

  // Ukrainian that STARTS with a Russian name, outlet or place carrying ы, ё, э or ъ: never decisive
  // ru. Where an ordinary word has a Ukrainian-only letter it is decisive uk, which is right.
  row("uk_starts_with_ru_name", "Крым атакували дрони, пише агентство.", "uk", "ru", false),
  row("uk_starts_with_ru_name", "Сызрань атакували дрони, пише агентство.", "uk", "ru", false),
  row("uk_starts_with_ru_name", "Ростех: корисне навантаження вказано.", "uk", "ru", false),
  row(
    "uk_starts_with_ru_name",
    "Новини дня\nСызрань атакували дрони, пишуть ЗМІ.",
    "uk",
    "ru",
    false,
  ),
  row(
    "uk_starts_with_ru_name",
    "Объединённая корпорація заявила про запуск дрона.",
    "uk",
    "ru",
    false,
  ),
  row("uk_starts_with_ru_name", "Ёлкин повідомив про запуск дрона.", "uk", "ru", false),
  row("uk_starts_with_ru_name", "Крым: дрон збили над морем, пише агентство.", "uk", "ru", false),

  // Quotations never settle the language. Where the ordinary words have no distinctive letter the
  // result is not decisive.
  row(
    "quotation_only",
    "Он ответил: «Дальність польоту становить 250 км» и ушел.",
    "ru",
    "ru",
    false,
  ),
  row("quotation_only", "Автор написав: «объём вырос» і додав ще слово.", "uk", "uk", true),
  row("quotation_only", "Автор написав: «объём вырос», додав автор.", "uk", "ru", false),
  row(
    "quotation_only",
    "Министр заявил: „Потужність двигуна становить 80 кВт“, передали СМИ.",
    "ru",
    "ru",
    false,
  ),
  row(
    "quotation_only",
    'Редакция привела цитату "Корисне навантаження 35 кг" полностью.',
    "ru",
    "ru",
    false,
  ),
];
