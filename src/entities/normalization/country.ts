/**
 * Country fields hold ISO 3166-1 alpha-2 codes, but models answer with whatever the report said:
 * "UK", "Japan", "Russian Federation". Those are the same countries as GB, JP and RU, and a
 * catalog that keeps both spellings shows two facets and two flags for one operator.
 *
 * What is not a country stays as written: "??" (unknown), blocs such as EU and NATO, and SU for
 * Soviet-era designs - folding the Soviet Union into Russia is a judgement, not a spelling fix.
 */

/** Spellings Intl does not give, or gives differently ("Türkiye", "Czechia"). */
const NAME_ALIASES: Record<string, string> = {
  uk: "GB",
  "great britain": "GB",
  britain: "GB",
  england: "GB",
  usa: "US",
  "u.s.": "US",
  "u.s.a.": "US",
  america: "US",
  "united states of america": "US",
  "russian federation": "RU",
  turkey: "TR",
  "czech republic": "CZ",
  "republic of korea": "KR",
  "korea, south": "KR",
  dprk: "KP",
  "korea, north": "KP",
  uae: "AE",
  "people's republic of china": "CN",
  prc: "CN",
  "islamic republic of iran": "IR",
};

let byName: Map<string, string> | undefined;

/** English region name → code, for every code Intl treats as current (so not UK, SU, DD). */
function regionNames(): Map<string, string> {
  if (byName) return byName;
  byName = new Map();
  let names: Intl.DisplayNames | undefined;
  try {
    names = new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return byName;
  }
  const A = 65;
  for (let i = 0; i < 26; i++)
    for (let j = 0; j < 26; j++) {
      const code = String.fromCharCode(A + i, A + j);
      let name: string | undefined;
      try {
        if (Intl.getCanonicalLocales(`und-${code}`)[0] !== `und-${code}`) continue;
        name = names.of(code);
      } catch {
        continue;
      }
      if (name && name !== code) byName.set(name.toLowerCase(), code);
    }
  return byName;
}

/** The ISO2 code for a country written as a code or a name; anything else unchanged. */
export function countryCode(value: string): string {
  const v = value.trim();
  if (!v) return v;
  const lower = v.toLowerCase();
  if (NAME_ALIASES[lower]) return NAME_ALIASES[lower];
  if (/^[a-z]{2}$/i.test(v)) return v.toUpperCase();
  return regionNames().get(lower) ?? v;
}

/** Each country once, by code, in first-seen order. */
export function countryCodes(values: readonly string[]): string[] {
  return [...new Set(values.map(countryCode).filter(Boolean))];
}
