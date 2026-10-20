/**
 * Dates written the way a source writes them, read back as an ISO day.
 *
 * The catalogue keeps dates as ISO strings - a procurement's `announcedAt`, a system's
 * first flight - so a source that writes "12 жовтня 2025 року" must not end up as the
 * catalogue's value. The month names are the ones the sources this repo ingests use, in
 * the form they use them: with a day number, Russian and Ukrainian write the genitive
 * ("жовтня" for October, "жовтень" in the nominative).
 */

/** Month name to number. Both the nominative and the genitive, per language. */
const MONTHS: Record<string, number> = {
  // English
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
  // Russian
  январь: 1,
  января: 1,
  февраль: 2,
  февраля: 2,
  март: 3,
  марта: 3,
  апрель: 4,
  апреля: 4,
  май: 5,
  мая: 5,
  июнь: 6,
  июня: 6,
  июль: 7,
  июля: 7,
  август: 8,
  августа: 8,
  сентябрь: 9,
  сентября: 9,
  октябрь: 10,
  октября: 10,
  ноябрь: 11,
  ноября: 11,
  декабрь: 12,
  декабря: 12,
  // Ukrainian
  січень: 1,
  січня: 1,
  лютий: 2,
  лютого: 2,
  березень: 3,
  березня: 3,
  квітень: 4,
  квітня: 4,
  травень: 5,
  травня: 5,
  червень: 6,
  червня: 6,
  липень: 7,
  липня: 7,
  серпень: 8,
  серпня: 8,
  вересень: 9,
  вересня: 9,
  жовтень: 10,
  жовтня: 10,
  листопад: 11,
  листопада: 11,
  грудень: 12,
  грудня: 12,
};

const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
/** Day first: "12.10.2025", "12/10/2025". */
const DAY_FIRST = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/;
// `\p{L}`, not `\w`: JavaScript's `\w` is ASCII-only, so a Cyrillic month name is not a word
// character and never matches an ASCII-letter class.
/** "12 жовтня 2025 року", "12 October 2025". */
const DAY_MONTH = /^(\d{1,2})\s+(\p{L}+)\.?\s+(\d{4})(?:\s+\p{L}+)?$/iu;
/** "October 12, 2025". */
const MONTH_DAY = /^(\p{L}+)\.?\s+(\d{1,2}),?\s+(\d{4})$/iu;

function iso(year: number, month: number, day: number): string | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const d = new Date(Date.UTC(year, month - 1, day));
  // Reject a day the month does not have (31 February).
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return undefined;
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day
    .toString()
    .padStart(2, "0")}`;
}

function monthOf(name: string): number | undefined {
  return MONTHS[name.trim().toLowerCase()];
}

/**
 * The ISO day a raw value states, or undefined when it states no date.
 *
 * Strict on purpose: a value that only looks like a date ("45,000 feet", "500 kg warhead")
 * must not be read as one.
 */
export function normalizeDate(raw: string): string | undefined {
  const text = raw
    .trim()
    .replace(/[\u00a0\u202f\u2009]/g, " ")
    .replace(/[.,;:)]+$/g, "")
    .trim();
  if (!text) return undefined;

  const isoMatch = ISO.exec(text);
  if (isoMatch) return iso(+isoMatch[1]!, +isoMatch[2]!, +isoMatch[3]!);

  const dayFirst = DAY_FIRST.exec(text);
  if (dayFirst) return iso(+dayFirst[3]!, +dayFirst[2]!, +dayFirst[1]!);

  const dayMonth = DAY_MONTH.exec(text);
  if (dayMonth) {
    const month = monthOf(dayMonth[2]!);
    if (month) return iso(+dayMonth[3]!, month, +dayMonth[1]!);
  }

  const monthDay = MONTH_DAY.exec(text);
  if (monthDay) {
    const month = monthOf(monthDay[1]!);
    if (month) return iso(+monthDay[3]!, month, +monthDay[2]!);
  }
  return undefined;
}
