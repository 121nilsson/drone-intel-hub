import { parseNumber } from "@/entities/normalization/numeric";
import type {
  DetectedSystem,
  Domain,
  Drone,
  ExtractedSpec,
  Extraction,
} from "@/entities/drone/types";
import type { BriefingSummarizer, IntelExtractor } from "@/shared/contracts/ai";

/** Same grouping rules as the normalization parser, so intake and consensus agree. */
function num(s: string): number {
  return parseNumber(s) ?? Number.NaN;
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Exact token-boundary match: "Geran-2" never matches inside "Geran-5" or "Geran-25". */
export function mentions(text: string, name: string) {
  if (name.trim().length < 2) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}-])${esc(name.trim())}(?![\\p{L}\\p{N}]|-\\p{N})`, "iu").test(
    text,
  );
}

const STOP = new Set(
  (
    "Telegram Russian Russia Ukrainian Ukraine Iranian Iran Chinese China The A An In On At Of And Or But New Our We They It This That These Those " +
    "Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December " +
    "MHz GHz CRPA GNSS GPS FPV UAV UAVs USV UGV EW AI RF HD km kg USD EUR UAH RUB Air Land Sea Defense Defence Forces Army Navy Report Dispatch Update Source Sources " +
    "Also New One Two Three Several Later Then After Before Near Meanwhile Reportedly Estimated Price Cost Unit Russians Ukrainians Kyiv Moscow Kharkiv Odesa Donetsk Crimea Black Front Western Eastern Southern Northern Sea Oblast"
  )
    .split(" ")
    .map((w) => w.toLowerCase()),
);

/** Find proper nouns, acronyms and model designations without requiring quotes. */
export function detectNames(raw: string): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    const words = s
      .trim()
      .replace(/[.,;:!?)]+$/, "")
      .split(/\s+/);
    while (words.length > 1 && STOP.has(words[0]!.toLowerCase())) words.shift();
    const n = words.join(" ");
    if (n.length < 2 || STOP.has(n.toLowerCase())) return;
    if (n.split(/\s+/).every((w) => STOP.has(w.toLowerCase()))) return;
    if (!out.some((o) => o.toLowerCase() === n.toLowerCase())) out.push(n);
  };
  for (const m of raw.matchAll(/["«“']([^"»”']{2,40})["»”']/g)) add(m[1]!);
  // Designations: Geran-5, Molniya-1, FP-1, Lancet-3M, Shahed-238
  for (const m of raw.matchAll(
    /\b([A-Z\u0410-\u042F][\p{L}]*(?:\s[A-Z][\p{L}]+)?-\p{N}+[A-Za-z]?)\b/gu,
  ))
    add(m[1]!);
  // Acronym names, optionally with a single-letter variant: STING S, MAGURA V5
  for (const m of raw.matchAll(/\b([A-Z]{3,}(?:\s(?:[A-Z]\d*|V\d+)\b)?)/g)) add(m[1]!);
  // Capitalised 1–2 word phrases not at sentence start: Baba Yaga, Bars, Magura V5
  for (const m of raw.matchAll(/\b([A-Z][a-z]{2,}\s(?:[A-Z][a-z]{2,}|[A-Z]\d+))\b/g)) add(m[1]!);
  for (const m of raw.matchAll(/(?<=[a-z0-9,;:()]\s)([A-Z][a-z]{2,})\b/g)) add(m[1]!);
  // Drop names that are prefixes of a longer detected designation (Geran vs Geran-5)
  return dropContained(out, out);
}

/** Remove names that are a word-part of a longer name (Geran ⊂ Geran-5, Yaga ⊂ Baba Yaga). */
function dropContained(names: string[], against: string[]) {
  return names.filter(
    (n) =>
      !against.some(
        (o) =>
          o.toLowerCase() !== n.toLowerCase() &&
          mentions(o.replace(/-/g, " "), n.replace(/-/g, " ")) &&
          o.length > n.length,
      ),
  );
}

const catalogNames = (d: Drone) =>
  [...d.name.split(/\s*\/\s*/), d.name, d.cyrillic ?? "", ...d.aliases].filter((n) => n.length > 2);
const base = (n: string) => {
  const m = n.toLowerCase().match(/^(.*?)-(\p{N}+\w*)$/u);
  return m ? { stem: m[1]!, variant: m[2]! } : null;
};

export function resolveSystems(raw: string, catalog: Drone[]): DetectedSystem[] {
  const systems: DetectedSystem[] = [];
  const seen = new Set<string>();
  // 1. Exact catalog mentions
  for (const d of catalog) {
    const hit = catalogNames(d).find((n) => mentions(raw, n));
    if (hit && !seen.has(d.id)) {
      seen.add(d.id);
      systems.push({ name: hit, matchId: d.id });
    }
  }
  // 2. Detected names not already covered — check for variant-of relations
  for (const n of dropContained(
    detectNames(raw),
    systems.map((s) => s.name),
  )) {
    if (systems.some((s) => s.name.toLowerCase() === n.toLowerCase())) continue;
    if (catalog.some((d) => catalogNames(d).some((c) => c.toLowerCase() === n.toLowerCase())))
      continue;
    const b = base(n);
    const parent = b
      ? catalog.find((d) =>
          catalogNames(d).some((c) => {
            const cb = base(c);
            return cb?.stem === b.stem && cb.variant !== b.variant;
          }),
        )
      : undefined;
    systems.push({ name: n, ...(parent ? { variantOf: parent.id } : {}) });
  }
  return systems;
}

const CUR = "[$€£₽]";
const AMT = `(\\d[\\d,. ]*\\d|\\d)\\s*(k|K|m|M|bn|million|thousand)?`;
export function extractPrice(raw: string): string | undefined {
  const re = new RegExp(`(${CUR})\\s?${AMT}(?:\\s*(?:-|–|—|to)\\s*${CUR}?\\s?${AMT})?`);
  const m = raw.match(re);
  if (m) {
    const fmt = (a: string, s?: string) =>
      `${m[1]}${a.trim()}${s ? (s.length > 2 ? ` ${s}` : s) : ""}`;
    return m[4] ? `${fmt(m[2]!, m[3])} - ${fmt(m[4], m[5])}` : fmt(m[2]!, m[3]);
  }
  const w = raw.match(
    /(\d[\d,.]*)\s*(k|million|thousand)?\s*(USD|dollars|EUR|euros|rubles|roubles|UAH|hryvnia)/i,
  );
  return w ? `${w[1]}${w[2] ? ` ${w[2]}` : ""} ${w[3]!.toUpperCase()}` : undefined;
}

function scan(raw: string, catalog: Drone[], deep: boolean): Extraction {
  const t = raw.toLowerCase();
  const specs: ExtractedSpec[] = [];
  const grab = (re: RegExp, key: string, label: string, unit: string) => {
    const m = raw.match(re);
    if (m?.[1]) specs.push({ key, label, value: num(m[1]), unit });
  };
  grab(/(\d+(?:[.,]\d+)?)\s*km\/h/i, "speed", "Cruise speed", "km/h");
  grab(/range[^\d]{0,20}(\d+(?:[.,]\d+)?)\s*km/i, "range", "Range", "km");
  grab(/(\d+(?:[.,]\d+)?)\s*kg\b/i, "payload", "Payload", "kg");
  grab(
    /(\d+(?:[.,]\d+)?)\s*km\s+(?:of\s+)?(?:fiber|fibre|spool)/i,
    "fiber_spool",
    "Fiber spool length",
    "km",
  );
  for (const m of raw.matchAll(/(\d+)\s+(jammers?|cameras?|missiles?|rotors?|antennas?)/gi)) {
    const noun = m[2]!.toLowerCase().replace(/s$/, "");
    specs.push({ key: `${noun}s`, label: `Number of ${noun}s`, value: Number(m[1]) });
  }
  const price = extractPrice(raw);
  if (price) specs.push({ key: "unit_cost", label: "Unit Cost / Price", value: price });

  const rfBands = [...raw.matchAll(/(\d+(?:[.,]\d+)?)\s*(mhz|ghz)/gi)].map(
    (m) => `${m[1]} ${m[2]!.toUpperCase()}`,
  );
  if (/crpa|kometa/i.test(raw)) rfBands.push("CRPA");
  const domain: Domain | undefined = /usv|boat|naval|sea drone|maritime/.test(t)
    ? "Sea"
    : /ugv|tracked|ground robot/.test(t)
      ? "Land"
      : /uav|fpv|drone|loitering|wing|interceptor|bomber/.test(t)
        ? "Air"
        : undefined;
  const origin = /russia|russian|рос/.test(t)
    ? "RU"
    : /ukrain|укр/.test(t)
      ? "UA"
      : /iran/.test(t)
        ? "IR"
        : undefined;

  const systems = resolveSystems(raw, catalog);
  const matched = systems.filter((s) => s.matchId);
  const novel = systems.filter((s) => !s.matchId);
  // Single unambiguous catalog match only when no new/variant system is the subject
  const matchId = matched.length === 1 && novel.length === 0 ? matched[0]!.matchId : undefined;
  const primary = novel[0] ?? matched[0];

  let confidence =
    0.2 +
    specs.length * 0.1 +
    (domain ? 0.1 : 0) +
    (matchId ? 0.3 : 0) +
    (rfBands.length ? 0.08 : 0);
  if (systems.length > 1) confidence -= 0.1;
  if (deep) confidence += 0.1;
  confidence = Math.max(0.05, Math.min(0.97, confidence));
  const variants = novel
    .filter((s) => s.variantOf)
    .map((s) => `${s.name} (variant of ${s.variantOf})`);
  return {
    ...(primary ? { name: primary.name } : {}),
    aliases: [],
    ...(domain ? { domain } : {}),
    ...(origin ? { origin } : {}),
    operators: origin ? [origin] : [],
    specs,
    rfBands,
    systems,
    ...(matchId ? { matchId } : {}),
    confidence,
    rationale: `${deep ? "Tier 2 reasoning" : "Tier 1 screening"}: ${systems.length} system(s) detected, ${specs.length} specs, ${rfBands.length} RF refs${matchId ? `, matched ${matchId}` : ""}${variants.length ? `; new variant: ${variants.join(", ")}` : ""}.`,
  };
}

export class HeuristicExtractor implements IntelExtractor {
  readonly label: string;
  constructor(readonly tier: 1 | 2) {
    this.label = tier === 1 ? "Local screener" : "Local deep matcher";
  }
  async extract(raw: string, catalog: Drone[]) {
    return scan(raw, catalog, this.tier === 2);
  }
}

export class HeuristicSummarizer implements BriefingSummarizer {
  async summarize(context: string) {
    return `Automated digest (local engine — connect an AI provider in Settings for narrative analysis).\n\n${context}`;
  }
}
