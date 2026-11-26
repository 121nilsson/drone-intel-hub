/**
 * Independent holdout set for the ru / uk / en language detector.
 *
 * Written on 2026-11-26 as an independent holdout by an author who did not
 * see the detector, its corpus or its word lists. It must not be used to
 * develop or tune the detector; it is only for approval evaluation. Any rule
 * change motivated by a failure here retires this version: create a v2
 * instead of editing rows.
 */

export type HoldoutLanguage = "ru" | "uk" | "en" | "mixed_ru_uk" | "other";

export type HoldoutCategory =
  | "ru_natural"
  | "uk_natural"
  | "ru_short"
  | "uk_short"
  | "ru_with_uk_names"
  | "uk_with_ru_names"
  | "mixed_single_switch"
  | "mixed_multi_sentence"
  | "quotations"
  | "technical_short"
  | "english_with_cyrillic"
  | "other_cyrillic";

export interface HoldoutRow {
  /** Stable id, e.g. "ru_natural-01". */
  readonly id: string;
  readonly category: HoldoutCategory;
  readonly text: string;
  /** The language a native reader would assign. */
  readonly trueLanguage: HoldoutLanguage;
  /** The only language a detector may claim with confidence, or null if no confident claim is acceptable. */
  readonly allowedDecisive: "ru" | "uk" | "en" | null;
  readonly note?: string;
}

type Decisive = "ru" | "uk" | "en" | null;
type Spec = readonly [
  text: string,
  trueLanguage: HoldoutLanguage,
  allowed: Decisive,
  note?: string,
];

function block(category: HoldoutCategory, specs: readonly Spec[]): HoldoutRow[] {
  return specs.map(([text, trueLanguage, allowedDecisive, note], i) => ({
    id: `${category}-${String(i + 1).padStart(2, "0")}`,
    category,
    text,
    trueLanguage,
    allowedDecisive,
    ...(note ? { note } : {}),
  }));
}

const RU_NATURAL: Spec[] = [
  [
    `Российские войска применили против энергетической инфраструктуры около сорока беспилотников, часть из которых сбили над Одесской областью.`,
    "ru",
    "ru",
  ],
  [
    `Оператор потерял связь с аппаратом на высоте двухсот метров, после чего дрон упал в поле недалеко от шоссе.`,
    "ru",
    "ru",
  ],
  [
    `Новая зенитная ракета, по словам разработчиков, способна поражать цели на расстоянии до тридцати километров.`,
    "ru",
    "ru",
  ],
  [
    `Мы долго обсуждали, стоит ли переходить на другой тип аккумуляторов, но так и не пришли к единому мнению.`,
    "ru",
    "ru",
  ],
  [
    `Министерство обороны сообщило, что за ночь было перехвачено шесть ракет и двадцать три ударных дрона.`,
    "ru",
    "ru",
  ],
  [
    `Если сигнал GPS подавляется, навигация переключается на инерциальный блок, однако точность при этом заметно падает.`,
    "ru",
    "ru",
  ],
  [
    `Экипаж бронемашины обнаружил вражескую разведывательную группу и открыл огонь из пулемёта.`,
    "ru",
    "ru",
  ],
  [
    `Погода в выходные будет ветреной, поэтому полёты малой авиации, скорее всего, придётся отложить.`,
    "ru",
    "ru",
  ],
  [`В чём причина того, что эти аппараты так часто выходят из строя?`, "ru", "ru"],
  [
    `Предприятие наладило выпуск корпусов из композитных материалов, что позволило снизить вес изделия почти вдвое.`,
    "ru",
    "ru",
  ],
  [
    `Власти города эвакуировали жителей нескольких кварталов, пока сапёры разряжали неразорвавшийся снаряд.`,
    "ru",
    "ru",
  ],
  [
    `Ты уже видел отчёт? Там всё подробно описано, даже про то, как они крепили камеру.`,
    "ru",
    "ru",
  ],
  [`Они ждали ответа от штаба до утра.`, "ru", "ru", "no letters unique to Russian"],
  [
    `Съёмка велась с высоты, объём данных оказался огромным, а эфир был забит помехами.`,
    "ru",
    "ru",
    "heavy on ё, ъ, ы",
  ],
  [
    `Эти объявления вывесили ещё вчера, но никто их так и не прочитал.`,
    "ru",
    "ru",
    "heavy on э, ы, ё",
  ],
];

const UK_NATURAL: Spec[] = [
  [
    `Українські сили протиповітряної оборони за ніч знищили п'ятнадцять ударних дронів, що летіли з півдня.`,
    "uk",
    "uk",
  ],
  [
    `Пілот безпілотника втратив зв'язок із апаратом на висоті двохсот метрів, і той впав у полі біля траси.`,
    "uk",
    "uk",
  ],
  [
    `Нова зенітна ракета, за словами розробників, здатна вражати цілі на відстані до тридцяти кілометрів.`,
    "uk",
    "uk",
  ],
  [
    `Ми довго обговорювали, чи варто переходити на інший тип акумуляторів, але так і не дійшли згоди.`,
    "uk",
    "uk",
  ],
  [`Міністерство оборони повідомило, що минулої доби було перехоплено шість ракет.`, "uk", "uk"],
  [
    `Коли сигнал GPS глушать, навігація перемикається на інерційний блок, проте точність помітно знижується.`,
    "uk",
    "uk",
  ],
  [
    `Екіпаж бронемашини помітив ворожу розвідувальну групу та відкрив вогонь із кулемета.`,
    "uk",
    "uk",
  ],
  [
    `Погода на вихідних буде вітряною, тому польоти, найімовірніше, доведеться відкласти.`,
    "uk",
    "uk",
  ],
  [`Чому ці апарати так часто виходять з ладу?`, "uk", "uk"],
  [
    `Підприємство налагодило випуск корпусів із композитних матеріалів, що дозволило майже вдвічі зменшити вагу виробу.`,
    "uk",
    "uk",
  ],
  [
    `Влада міста евакуювала мешканців кількох кварталів, поки сапери знешкоджували снаряд, що не розірвався.`,
    "uk",
    "uk",
  ],
  [`Ти вже бачив звіт? Там усе докладно описано, навіть те, як вони кріпили камеру.`, "uk", "uk"],
  [`Вона дуже добре знала, що робити далі.`, "uk", "uk", "no letters unique to Ukrainian"],
  [`Їхній єдиний ґанок, де ґазда тримав гілку, згорів уночі.`, "uk", "uk", "heavy on ї, є, ґ, і"],
  [
    `Хлопці зібрали дрон за вихідні, а в понеділок вирушили на випробування в поле за селом.`,
    "uk",
    "uk",
  ],
];

const RU_SHORT: Spec[] = [
  [`Ночью сбиты пять беспилотников`, "ru", "ru"],
  [`В Курске объявлена воздушная тревога`, "ru", "ru"],
  [`Власти опровергли сообщения об ударе`, "ru", "ru"],
  [`Завод возобновил выпуск техники`, "ru", "ru"],
  [`Эксперты оценили эффективность ПВО`, "ru", "ru"],
  [`Колонна техники прошла через город`, "ru", "ru"],
  [`Мост закрыт для движения`, "ru", "ru"],
  [`Что известно о новой ракете`, "ru", "ru"],
  [`Склад боеприпасов взорван ночью`, "ru", "ru"],
  [`Учения завершатся в пятницу`, "ru", "ru"],
  [`Это всё, что мы знаем`, "ru", "ru"],
];

const UK_SHORT: Spec[] = [
  [`Вночі збито п'ять безпілотників`, "uk", "uk"],
  [`У Харкові оголошено повітряну тривогу`, "uk", "uk"],
  [`Влада спростувала повідомлення про удар`, "uk", "uk"],
  [`Завод відновив випуск техніки`, "uk", "uk"],
  [`Експерти оцінили ефективність ППО`, "uk", "uk"],
  [`Колона техніки пройшла через місто`, "uk", "uk"],
  [`Міст закрито для руху`, "uk", "uk"],
  [`Що відомо про нову ракету`, "uk", "uk"],
  [`Склад боєприпасів підірвали вночі`, "uk", "uk"],
  [`Навчання завершаться у п'ятницю`, "uk", "uk"],
  [`Це все, що ми знаємо`, "uk", "uk"],
];

const RU_WITH_UK_NAMES: Spec[] = [
  [
    `Київ заявил о том, что системы ПВО отработали по целям в районе Житомира.`,
    "ru",
    "ru",
    "Ukrainian-spelled name first",
  ],
  [`Как сообщает Укрінформ, поезда Укрзалізниці задерживаются из-за обстрела.`, "ru", "ru"],
  [
    `Дніпро и Харків остаются под угрозой ракетных ударов, заявили в областных администрациях.`,
    "ru",
    "ru",
    "text starts with two Ukrainian-spelled names",
  ],
  [`Журналисты побывали в Ізюмі и рассказали о восстановлении школ.`, "ru", "ru"],
  [
    `Житомир сегодня утром пережил самую долгую тревогу за последний месяц.`,
    "ru",
    "ru",
    "Житомир is spelled the same in both; no Ukrainian-only letters",
  ],
  [`Колонна двигалась из Запоріжжя в сторону Мелитополя, не останавливаясь.`, "ru", "ru"],
  [`Из Миколаїва сообщили о ночной атаке дронов, пострадавших нет.`, "ru", "ru"],
  [`По данным издания Суспільне, в Чернігові повреждены три жилых дома.`, "ru", "ru"],
  [`Укрпошта временно прекратила приём отправлений в прифронтовых районах.`, "ru", "ru"],
  [
    `Львів не пострадал, но взрывы слышали и жители соседних посёлков, которые вышли на улицы.`,
    "ru",
    "ru",
  ],
  [
    `Интерфакс-Україна опубликовал расчёты, согласно которым ущерб превысил миллиард долларов.`,
    "ru",
    "ru",
  ],
];

const UK_WITH_RU_NAMES: Spec[] = [
  [
    `Москва заявила про збиття трьох безпілотників над Брянською областю.`,
    "uk",
    "uk",
    "Russian-spelled name first",
  ],
  [`Як повідомляє РИА Новости, у районі Белгорода оголошено ракетну небезпеку.`, "uk", "uk"],
  [
    `Ростех оголосив про початок серійного випуску нового комплексу, але деталей не навів.`,
    "uk",
    "uk",
  ],
  [`Газпром скоротив постачання, тому ціни на газ у регіоні зросли.`, "uk", "uk"],
  [`Уламки впали біля Новороссийска, місцева влада евакуювала людей із двох будинків.`, "uk", "uk"],
  [`Лента.ру опублікувала заяву, яку пізніше видалила з сайту.`, "uk", "uk"],
  [`Флот зосередив кораблі біля Севастополя, повідомляють аналітики.`, "uk", "uk"],
  [`Російські ЗМІ, зокрема Коммерсантъ, повідомили про затримання директора заводу.`, "uk", "uk"],
  [`Калининград перетворили на військову базу, стверджують аналітики.`, "uk", "uk"],
  [`Мешканці Сочи скаржилися на перебої з електрикою після нічної атаки.`, "uk", "uk"],
  [
    `Ростов і Краснодар опинилися під загрозою нових ударів, попередили в адміністраціях.`,
    "uk",
    "uk",
    "starts with two Russian-spelled names",
  ],
];

const MIXED_SINGLE_SWITCH: Spec[] = [
  [
    `Вчера мы поехали на объект, а потім долго ждали разрешения.`,
    "ru",
    "ru",
    "Russian with one Ukrainian word",
  ],
  [
    `Ми приїхали на об'єкт, а потом довго чекали дозволу.`,
    "uk",
    "uk",
    "Ukrainian with one Russian word",
  ],
  [
    `Я вже закінчив роботу, но ще треба перевірити результати.`,
    "uk",
    "uk",
    "surzhyk conjunction in Ukrainian",
  ],
  [
    `Ситуация на фронте остаётся сложной, але командование не паникует.`,
    "ru",
    "ru",
    "one Ukrainian conjunction in Russian",
  ],
  [`Дякую, спасибо за информацию`, "mixed_ru_uk", null, "two languages in equal measure"],
  [`Це очень важливо для нас`, "mixed_ru_uk", null, "surzhyk, genuinely ambiguous"],
  [
    `Дрон пролетів над містом, а оператор не заметил перешкоди.`,
    "uk",
    "uk",
    "one Russian word with Russian-looking spelling",
  ],
  [
    `Он поїхал на склад за запчастями и вернулся к вечеру.`,
    "ru",
    "ru",
    "typo-like Ukrainian letter in Russian",
  ],
  [
    `Нові дроны надійшли до підрозділу вчора ввечері.`,
    "uk",
    "uk",
    "typo-like Russian letter ы in Ukrainian",
  ],
  [`Так, конечно, ми це зробимо завтра.`, "mixed_ru_uk", null, "half Russian, half Ukrainian"],
  [
    `Командир сказал, что треба срочно менять позицию.`,
    "ru",
    "ru",
    "one Ukrainian word in Russian",
  ],
  [
    `Командир сказав, що нужно терміново змінювати позицію.`,
    "uk",
    "uk",
    "one Russian word in Ukrainian",
  ],
];

const MIXED_MULTI_SENTENCE: Spec[] = [
  [
    `Сегодня утром сообщили о массированной атаке. Влада закликала мешканців залишатися в укриттях. Вечером ситуация стабилизировалась.`,
    "mixed_ru_uk",
    null,
    "sentences alternate, no dominant language",
  ],
  [
    `Ми отримали нове обладнання. Однако его пока не удалось протестировать.`,
    "mixed_ru_uk",
    null,
    "one sentence each",
  ],
  [
    `Предприятие в прошлом году увеличило выпуск беспилотников втрое и заключило несколько контрактов с зарубежными заказчиками. В этом году планируется открыть ещё одну производственную линию и нанять больше инженеров. Руководство уверено, что спрос на продукцию сохранится и в следующем году. Дякую за увагу.`,
    "ru",
    "ru",
    "Russian overwhelmingly dominates; one two-word Ukrainian closing",
  ],
  [
    `Підприємство торік утричі збільшило випуск безпілотників і уклало кілька контрактів із закордонними замовниками. Цього року планують відкрити ще одну виробничу лінію та найняти більше інженерів. Керівництво впевнене, що попит збережеться й наступного року. Спасибо за внимание.`,
    "uk",
    "uk",
    "Ukrainian overwhelmingly dominates; one Russian closing phrase",
  ],
  [
    `Ракетная опасность в Харькове. Повітряна тривога триває. Жителей просят не выходить на улицу. Не виходьте з укриттів.`,
    "mixed_ru_uk",
    null,
    "strict alternation",
  ],
  [
    `Вчора на заводі відбулася нарада. На ней обсуждали поставки комплектующих.`,
    "mixed_ru_uk",
    null,
    "two sentences, two languages",
  ],
  [
    `Отчёт опубликован вчера. Основні висновки такі: затримки, перевитрати та брак кадрів.`,
    "mixed_ru_uk",
    null,
  ],
  [
    `Дякуємо за запитання. Мы ответим на него в течение недели. Будь ласка, надішліть уточнення.`,
    "mixed_ru_uk",
    null,
    "uk-ru-uk, no overwhelming majority",
  ],
  [
    `Первый этап испытаний завершился успешно. Второй этап запланирован на март. Сьогодні ж, за словами представника, будуть оголошені результати.`,
    "mixed_ru_uk",
    null,
    "two Russian sentences then one longer Ukrainian one; not overwhelming",
  ],
  [
    `Спочатку пролунав вибух. Потом всё стихло. Через хвилину знову почалася стрілянина.`,
    "mixed_ru_uk",
    null,
    "uk-ru-uk",
  ],
];

const QUOTATIONS: Spec[] = [
  [
    `Он только повторил: «Слава Україні!», и все засмеялись.`,
    "ru",
    "ru",
    "short Ukrainian quote inside a Russian sentence",
  ],
  [
    `Президент заявил: «Ми не відступимо, ми переможемо, бо правда за нами».`,
    "mixed_ru_uk",
    null,
    "quote is almost the whole text",
  ],
  [
    `Він лише процитував: «Не надо паники», і розвернувся.`,
    "uk",
    "uk",
    "short Russian quote inside a Ukrainian sentence",
  ],
  [
    `Речник сказав: «Мы не комментируем действия наших военных и не собираемся этого делать».`,
    "mixed_ru_uk",
    null,
    "quote is almost the whole text",
  ],
  [
    `Пилот написал в чате: "Target acquired", после чего отключился.`,
    "ru",
    "ru",
    "English quote in Russian",
  ],
  [
    `Оператор написав у чаті: "Signal lost", після чого відключився.`,
    "uk",
    "uk",
    "English quote in Ukrainian",
  ],
  [
    `The spokesman said "Мы не комментируем", and left the room without taking questions.`,
    "en",
    "en",
    "Russian quote in English",
  ],
  [
    `The soldier shouted «Слава Україні» as the convoy passed through the village.`,
    "en",
    "en",
    "Ukrainian quote in English",
  ],
  [
    `Газета вышла с заголовком «Влада приховує правду про удар», что вызвало скандал.`,
    "ru",
    "ru",
    "Ukrainian headline quoted in Russian narration",
  ],
  [
    `Видання вийшло із заголовком «Власти скрывают правду об ударе», що викликало скандал.`,
    "uk",
    "uk",
    "Russian headline quoted in Ukrainian narration",
  ],
  [
    `Журналисты спросили министра о сроках поставок, и тот неожиданно ответил по-украински: «Скоро».`,
    "ru",
    "ru",
    "quoted word is ambiguous",
  ],
  [
    `Журналісти запитали міністра про терміни, а він раптом відповів: «Потом».`,
    "uk",
    "uk",
    "quoted word is Russian",
  ],
];

const TECHNICAL_SHORT: Spec[] = [
  [`Шахед-136: дальность до 2500 км, боевая часть 40 кг, двигатель MD-550`, "ru", "ru"],
  [`Шахед-136: дальність до 2500 км, бойова частина 40 кг, двигун MD-550`, "uk", "uk"],
  [`Орлан-10, размах крыла 3,1 м, взлётная масса 18 кг`, "ru", "ru"],
  [`Орлан-10, розмах крил 3,1 м, злітна маса 18 кг`, "uk", "uk"],
  [`Mavic 3 / 5 km / 46 min`, "other", null, "too little text"],
  [`Bayraktar TB2`, "other", null, "a name only"],
  [`FPV 7" 5S 1300mAh`, "other", null, "codes only"],
  [`Навигация: GPS/ГЛОНАСС, частота 2,4 ГГц, дальность связи 10 км`, "ru", "ru"],
  [`Навігація: GPS/ГЛОНАСС, частота 2,4 ГГц, дальність зв'язку 10 км`, "uk", "uk"],
  [`RQ-11 Raven 1,4 m 1,9 kg`, "other", null, "codes only"],
  [`Су-34 / Су-35 / МиГ-31К`, "other", null, "designations only"],
  [`136-10-2500-40`, "other", null, "numbers only"],
  [
    `БПЛА Lancet-3: масса 12 кг, время полёта до 40 минут, аппаратура: оптико-электронная ГСН`,
    "ru",
    "ru",
  ],
  [
    `БпЛА Lancet-3: маса 12 кг, час польоту до 40 хвилин, апаратура: оптико-електронна ГСН`,
    "uk",
    "uk",
  ],
  [`RPG-7, 7.62x39, 5.45x39`, "other", null, "codes only"],
  [`Shahed-136 range 2,500 km, warhead 40 kg`, "en", "en"],
];

const ENGLISH_WITH_CYRILLIC: Spec[] = [
  [`The strike hit a depot near Харків late on Tuesday, local officials said.`, "en", "en"],
  [`According to Укрінформ, the railway operator Укрзалізниця delayed three trains.`, "en", "en"],
  [`Analysts compared the Орлан-10 with cheaper commercial quadcopters.`, "en", "en"],
  [`Residents of Мелітополь reported loud explosions overnight.`, "en", "en"],
  [
    `The documents, written in Russian, repeatedly mention the word «беспилотник» in the context of logistics.`,
    "en",
    "en",
  ],
  [`He kept saying спасибо, but nobody in the room understood why.`, "en", "en"],
  [`The Ukrainian word «дрон» is now used in many languages.`, "en", "en"],
  [`Our correspondent in Дніпро confirmed that air defence was active for two hours.`, "en", "en"],
  [
    `The ministry published its statement on the website of РИА Новости before deleting it.`,
    "en",
    "en",
  ],
  [`Is the Су-34 really as vulnerable as the General Staff suggests?`, "en", "en"],
  [`Please translate the phrases «потім» and «потом» and tell me whether they differ.`, "en", "en"],
];

const OTHER_CYRILLIC: Spec[] = [
  [
    `Беларускія пагранічнікі паведамілі, што ўначы праз мяжу ляцеў беспілотнік.`,
    "other",
    null,
    "Belarusian",
  ],
  [
    `Мінскі завод вырабляе запчасткі для сельскагаспадарчай тэхнікі ўжо больш за трыццаць гадоў.`,
    "other",
    null,
    "Belarusian",
  ],
  [
    `Я не ведаю, што рабіць далей, але мы абавязкова вырашым гэтую праблему.`,
    "other",
    null,
    "Belarusian",
  ],
  [`Българските военновъздушни сили проведоха учение над Черно море.`, "other", null, "Bulgarian"],
  [
    `Министърът каза, че новите самолети ще пристигнат до края на годината.`,
    "other",
    null,
    "Bulgarian",
  ],
  [
    `Днес времето в София ще бъде облачно, а следобед се очакват превалявания.`,
    "other",
    null,
    "Bulgarian",
  ],
  [
    `Војска Србије је јуче саопштила да ће вежба трајати три дана.`,
    "other",
    null,
    "Serbian Cyrillic",
  ],
  [
    `Министар одбране је рекао да ће нови хеликоптери стићи до краја године.`,
    "other",
    null,
    "Serbian Cyrillic",
  ],
  [`Данас је у Београду облачно, а поподне се очекује киша.`, "other", null, "Serbian Cyrillic"],
  [`Београдски аеродром привремено је затворен због магле.`, "other", null, "Serbian Cyrillic"],
  [
    `Денеска во Скопје ќе врне дожд, а температурите ќе бидат пониски.`,
    "other",
    null,
    "Macedonian",
  ],
  [
    `Дронът падна на полето, а операторът не можа да го намери.`,
    "other",
    null,
    "Bulgarian, definite-article suffix",
  ],
];

export const LANGUAGE_DETECT_HOLDOUT: readonly HoldoutRow[] = Object.freeze([
  ...block("ru_natural", RU_NATURAL),
  ...block("uk_natural", UK_NATURAL),
  ...block("ru_short", RU_SHORT),
  ...block("uk_short", UK_SHORT),
  ...block("ru_with_uk_names", RU_WITH_UK_NAMES),
  ...block("uk_with_ru_names", UK_WITH_RU_NAMES),
  ...block("mixed_single_switch", MIXED_SINGLE_SWITCH),
  ...block("mixed_multi_sentence", MIXED_MULTI_SENTENCE),
  ...block("quotations", QUOTATIONS),
  ...block("technical_short", TECHNICAL_SHORT),
  ...block("english_with_cyrillic", ENGLISH_WITH_CYRILLIC),
  ...block("other_cyrillic", OTHER_CYRILLIC),
]);
