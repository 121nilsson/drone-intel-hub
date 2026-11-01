/**
 * Spelling-insensitive keys for system names, so the same system matches across scripts and
 * romanisations: "Ланцет-3" / "Lancet-3", "Герань-2" / "Geran-2", "Шахед" / "Shahed",
 * "Мавик" / "Mavic", "Баба Яга" / "Baba Yaga".
 *
 * Used for MATCHING only (mentions, collisions, duplicate suggestions), never for display or
 * storage: the folding is lossy on purpose, and the catalog keeps every spelling as an alias.
 */

/** Russian and Ukrainian letters to Latin, close to the romanisations OSINT sources use. */
const CYRILLIC: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  ґ: "g",
  д: "d",
  е: "e",
  ё: "e",
  є: "e",
  ж: "zh",
  з: "z",
  и: "i",
  і: "i",
  ї: "i",
  й: "i",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "shch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "iu",
  я: "ia",
};

/**
 * Lowercased, transliterated, and folded so romanisation choices agree: c/k, ts/c, kh/h, y/i,
 * w/v, ph/f, and doubled letters. Punctuation and spacing are kept as single spaces, so callers
 * can still look for a name on word boundaries.
 */
export function phoneticText(s: string): string {
  let t = "";
  for (const ch of s.normalize("NFKC").toLowerCase()) t += CYRILLIC[ch] ?? ch;
  return (
    t
      .replace(/ts|tz/g, "s")
      .replace(/c(?=[eiy])/g, "s")
      .replace(/ck|c|q/g, "k")
      .replace(/kh|h/g, "h")
      .replace(/ph/g, "f")
      .replace(/w/g, "v")
      .replace(/x/g, "ks")
      .replace(/[yj]/g, "i")
      .replace(/([a-z])\1+/g, "$1")
      // Everything that is not a letter or digit separates words.
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
  );
}

/**
 * One compact key per name: phoneticText without separators ("Shahed-136" = "Шахед 136"). A final
 * vowel after a stem of three or more letters is dropped, since English spellings often add or
 * swap one ("Vampire" / "Вампир", "Molniya" / "Молния"). Used only to decide matches and
 * collisions, where a rare false match sends a name to review rather than losing anything.
 */
export function phoneticKey(s: string): string {
  return phoneticText(s)
    .replace(/ /g, "")
    .replace(/([a-z]{3,})[aeiou]$/, "$1");
}

/**
 * The folded form of the last text searched. A post is checked against every catalog name in a
 * row, so without this the same few kilobytes would be folded thousands of times per post.
 */
let lastText = "";
let lastHay = "";

/**
 * How one name is looked for, folded once. A name is checked against every post (and, by the
 * verifier, against every sentence of every claim), so folding it per call dominated the cost.
 */
interface PhoneticNeedle {
  /** ` needle ` as it must occur in the folded text; undefined for a key too short to match. */
  exact?: string;
  /** The plural form a designation with a variant letter may also take ("F-35As"). */
  plural?: string;
  /** Case endings after a name that ends in a letter ("Ланцетом"). */
  inflected?: RegExp;
  /** A substring every inflected match contains, tested first because it is far cheaper. */
  stem?: string;
}

const needles = new Map<string, PhoneticNeedle>();

function needleFor(name: string): PhoneticNeedle {
  const cached = needles.get(name);
  if (cached) return cached;
  const needle = phoneticText(name);
  let out: PhoneticNeedle = {};
  // Very short keys ("ka", "s3") match everywhere once folded.
  if (needle.replace(/ /g, "").length >= 4) {
    out = { exact: ` ${needle} ` };
    // A designation's variant letter is identity, not a case ending: "F-35A" must not match
    // "F-35", "F-35B" or "F-35C", the way "Lancet-3" must not match "Lancet-3M" below. Only an
    // English plural is allowed ("F-35As").
    if (/\d[a-z]{1,2}$/.test(needle)) out.plural = ` ${needle}s `;
    // Russian and Ukrainian inflect names ("Шахеды", "Ланцетом", "Герани"): allow a short case
    // ending after a name that ends in a letter. Not after a digit - "Lancet-3" must not match
    // "Lancet-3M", which is a different variant.
    else if (/[a-z]$/.test(needle) && needle.length >= 5) {
      const stem = needle.replace(/[aeiou]$/, "");
      out.inflected = new RegExp(` ${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[a-z]{0,4} `);
      out.stem = ` ${stem}`;
    }
  }
  needles.set(name, out);
  return out;
}

/** True when `name` appears in `text` as whole words, in any of the spellings above. */
export function mentionsPhonetic(text: string, name: string): boolean {
  const { exact, plural, inflected, stem } = needleFor(name);
  if (!exact) return false;
  if (text !== lastText) {
    lastText = text;
    lastHay = ` ${phoneticText(text)} `;
  }
  const hay = lastHay;
  if (hay.includes(exact)) return true;
  if (plural) return hay.includes(plural);
  return inflected && stem && hay.includes(stem) ? inflected.test(hay) : false;
}

/**
 * Compiled patterns per name. The verifier checks every claim against every catalog name, and a
 * backfill multiplies that out, so each pattern is built once. Never global, so never stateful.
 */
const exactPatterns = new Map<string, RegExp>();

/** The lowercased form of the last text searched, for the substring pre-check in mentions(). */
let lastExactText = "";
let lastExactLower = "";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Exact token-boundary match: "Geran-2" never matches inside "Geran-5" or "Geran-25". */
export function mentions(text: string, name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 2) return false;
  // A name absent as a plain substring cannot match on token boundaries either; checking that
  // first skips the regex for nearly every name of a catalog scanned against one text.
  if (text !== lastExactText) {
    lastExactText = text;
    lastExactLower = text.toLowerCase();
  }
  if (!lastExactLower.includes(trimmed.toLowerCase())) return false;
  let re = exactPatterns.get(trimmed);
  if (!re) {
    re = new RegExp(`(?<![\\p{L}\\p{N}-])${escapeRe(trimmed)}(?![\\p{L}\\p{N}]|-\\p{N})`, "iu");
    exactPatterns.set(trimmed, re);
  }
  return re.test(text);
}

/**
 * mentions(), or the same name in another script or romanisation ("Ланцетом" for Lancet). The one
 * definition of "this text names that system", shared by the extractor and the verifier so the
 * two can never disagree about identity.
 */
export function mentionsName(text: string, name: string): boolean {
  return mentions(text, name) || mentionsPhonetic(text, name);
}

/**
 * URL-safe id stem for a system name, readable in any script this catalogue meets:
 * "СЁМАБОТ" is "semabot", "Калитка-КА" is "kalitka-ka". Names with no Latin or Cyrillic letters
 * (a CJK name) fall back to "system", so an id never starts with a bare hyphen.
 */
export function systemSlug(name: string): string {
  let t = "";
  for (const ch of name.normalize("NFKC").toLowerCase()) t += CYRILLIC[ch] ?? ch;
  return (
    t
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/, "") || "system"
  );
}
