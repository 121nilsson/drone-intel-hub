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

/** True when `name` appears in `text` as whole words, in any of the spellings above. */
export function mentionsPhonetic(text: string, name: string): boolean {
  const needle = phoneticText(name);
  // Very short keys ("ka", "s3") match everywhere once folded.
  if (needle.replace(/ /g, "").length < 4) return false;
  if (text !== lastText) {
    lastText = text;
    lastHay = ` ${phoneticText(text)} `;
  }
  const hay = lastHay;
  if (hay.includes(` ${needle} `)) return true;
  // Russian and Ukrainian inflect names ("Шахеды", "Ланцетом", "Герани"): allow a short case
  // ending after a name that ends in a letter. Not after a digit - "Lancet-3" must not match
  // "Lancet-3M", which is a different variant.
  if (!/[a-z]$/.test(needle) || needle.length < 5) return false;
  const stem = needle.replace(/[aeiou]$/, "");
  const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(` ${escaped}[a-z]{0,4} `).test(hay);
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
