import type { ExtractedSpec } from "@/entities/drone/types";

/**
 * Specifications from Wikipedia infoboxes and Wikidata quantity statements.
 *
 * Deterministic on purpose: a spec template is already structured data ("max takeoff weight kg =
 * 15"), so parsing it costs nothing and cannot hallucinate, where running the article through a
 * model would spend provider quota on a few hundred pages per import. Each value keeps the
 * template line it came from as evidence, and the caller records the article revision as the
 * claim's source, so a figure on a dossier can be traced back to the exact wikitext.
 *
 * Pure: no I/O, so the parser is tested against captured wikitext.
 */

/** Templates that carry specifications. Others (flags, citations, navboxes) are ignored. */
const SPEC_TEMPLATE =
  /^(?:infobox\s+(?:weapon|aircraft|uav|unmanned|military vehicle|ship|missile|aircraft type)|aircraft specs|картка:\s*(?:бпла|бла|літак|літальний апарат|ракета|зброя|військова техніка|корабель)|карточка\s+(?:ла|бпла|оружия|ракеты|самолёта|корабля|военной техники)|лтх)/i;

type Field = {
  key: string;
  label: string;
  /** Unit assumed for a bare number, e.g. "Максимальна злітна маса = 650". */
  unit?: string;
  /** A free-text field (engine, guidance) rather than a measurement. */
  text?: boolean;
};

/**
 * Parameter names (lowercased, underscores as spaces, unit suffix removed) to spec keys. Keys and
 * labels are the ones semanticKeyFor already understands, so a weight imported here and a weight
 * extracted from a Telegram post land on the same attribute and are compared by consensus().
 */
const FIELDS: [RegExp, Field][] = [
  [
    /^(?:max(?:imum)? take ?off (?:weight|mass)|mtow|максимальн\p{L}* зл[іi]тн\p{L}* мас\p{L}*|максимальн\p{L}* взл[её]тн\p{L}* мас\p{L}*)$/u,
    { key: "weight_mtow", label: "Maximum takeoff weight", unit: "kg" },
  ],
  [
    /^(?:empty (?:weight|mass)|dry (?:weight|mass)|мас\p{L}* порожн\p{L}*|масс\p{L}* пуст\p{L}*)$/u,
    { key: "weight_empty", label: "Empty weight", unit: "kg" },
  ],
  [/^(?:gross (?:weight|mass))$/u, { key: "weight_gross", label: "Gross weight", unit: "kg" }],
  [
    /^(?:weight|mass|launch weight|маса|масса|стартов\p{L}* мас\p{L}*)$/u,
    { key: "weight_launch", label: "Launch weight", unit: "kg" },
  ],
  [
    /^(?:payload|payload capacity|useful load|capacity|корисн\p{L}* навантаження|мас\p{L}* корисн\p{L}* навантаження|полезн\p{L}* нагрузк\p{L}*|масс\p{L}* полезн\p{L}* нагрузк\p{L}*)$/u,
    { key: "payload", label: "Payload", unit: "kg" },
  ],
  [
    /^(?:filling weight|warhead weight|мас\p{L}* бч|масс\p{L}* бч|мас\p{L}* бойов\p{L}* частин\p{L}*|масс\p{L}* боев\p{L}* част\p{L}*)$/u,
    { key: "warhead", label: "Warhead", unit: "kg" },
  ],
  [
    /^(?:warhead|filling|бойов\p{L}* частин\p{L}*|боев\p{L}* част\p{L}*)$/u,
    { key: "warhead_type", label: "Warhead type", text: true },
  ],
  [
    /^(?:max(?:imum)? speed|максимальн\p{L}* швидк\p{L}*|максимальн\p{L}* скорост\p{L}*)$/u,
    { key: "max_speed", label: "Maximum speed", unit: "km/h" },
  ],
  [
    /^(?:cruise speed|крейсерськ\p{L}* швидк\p{L}*|крейсерск\p{L}* скорост\p{L}*)$/u,
    { key: "cruise_speed", label: "Cruise speed", unit: "km/h" },
  ],
  [/^(?:speed|швидк[іi]сть|скорость)$/u, { key: "speed", label: "Speed", unit: "km/h" }],
  [
    /^(?:range|vehicle range|operational range|дальн[іi]сть(?: польоту| дії)?|дальность(?: пол[её]та| действия)?|практическ\p{L}* дальность|практичн\p{L}* дальн[іi]сть)$/u,
    { key: "range", label: "Range", unit: "km" },
  ],
  [/^(?:combat range)$/u, { key: "combat_range", label: "Combat range", unit: "km" }],
  [
    /^(?:combat radius|бойов\p{L}* рад[іi]ус|боев\p{L}* радиус|рад[іi]ус д[іi]ї|радиус действия)$/u,
    { key: "combat_radius", label: "Combat radius", unit: "km" },
  ],
  [
    /^(?:ferry range|перегоночн\p{L}* дальность)$/u,
    { key: "ferry_range", label: "Ferry range", unit: "km" },
  ],
  [
    /^(?:endurance|flight time|тривал[іi]сть польоту|час польоту|продолжительность пол[её]та|время пол[её]та)$/u,
    { key: "endurance", label: "Endurance", unit: "h" },
  ],
  [
    /^(?:ceiling|service ceiling|практичн\p{L}* стел\p{L}*|стеля|практическ\p{L}* потолок|потолок)$/u,
    { key: "service_ceiling", label: "Service ceiling", unit: "m" },
  ],
  [
    /^(?:altitude|max(?:imum)? altitude|operating altitude|висота польоту|высота пол[её]та)$/u,
    { key: "max_altitude", label: "Maximum altitude", unit: "m" },
  ],
  [/^(?:length|довжина|длина)$/u, { key: "length", label: "Length", unit: "m" }],
  [
    /^(?:wingspan|span|wing span|розмах крила|размах крыла)$/u,
    { key: "wingspan", label: "Wingspan", unit: "m" },
  ],
  [/^(?:height|висота|высота)$/u, { key: "height", label: "Height", unit: "m" }],
  [/^(?:diameter|д[іi]аметр|диаметр)$/u, { key: "diameter", label: "Diameter", unit: "m" }],
  [/^(?:width|beam|ширина)$/u, { key: "width", label: "Width", unit: "m" }],
  [
    /^(?:engine|eng1 name|powerplant|двигун|двигатель|силов\p{L}* установк\p{L}*)$/u,
    { key: "engine", label: "Engine", text: true },
  ],
  [/^(?:eng1 (?:kw|hp)|engine power)$/u, { key: "engine_power", label: "Engine power" }],
  [
    /^(?:guidance|guidance system|система наведення|система наведения)$/u,
    { key: "guidance", label: "Guidance", text: true },
  ],
  [
    /^(?:unit cost|cost|price|вартість одиниці|вартість|стоимость единицы|стоимость)$/u,
    { key: "unit_cost", label: "Unit cost", text: true },
  ],
];

/**
 * {{Aircraft specs}} puts the unit in the parameter name: "max speed kmh", "range km". The suffix
 * is split off so the name matches FIELDS, and becomes the value's unit.
 */
const NAME_UNIT: Record<string, string> = {
  kg: "kg",
  lb: "lb",
  kmh: "km/h",
  mph: "mph",
  kn: "kn",
  kts: "kn",
  km: "km",
  mi: "mi",
  nmi: "nmi",
  m: "m",
  ft: "ft",
  kw: "kW",
  hp: "hp",
};
const METRIC = new Set(["kg", "km/h", "km", "m", "kW"]);

const MAX_VALUE = 200;
const MAX_TEXT = 120;
const MAX_EVIDENCE = 300;

/** "Max. take-off mass:" and "max_takeoff_weight" both become "max takeoff mass/weight". */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/take-off/g, "takeoff")
    .replace(/[_.:'-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Specifications in an article's wikitext, at most one per key. Infobox and spec templates come
 * first; a bulleted "Specifications" section (how many English aviation articles render
 * {{Aircraft specs}} after substitution) fills in what they lack.
 */
export function specsFromWikitext(wikitext: string): ExtractedSpec[] {
  const out = new Map<string, ExtractedSpec>();
  const seenTemplates = new Set<string>();
  for (const tpl of templates(wikitext)) {
    // Not normalizeName: the namespace colon in "Картка:БПЛА" is part of the template name.
    const name = tpl.name.toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
    if (!SPEC_TEMPLATE.test(name)) continue;
    // A second infobox of the same kind usually describes a variant further down the article
    // (Shahed-136 then Shahed-238); its figures belong to that variant, not this card.
    if (seenTemplates.has(name)) continue;
    seenTemplates.add(name);
    for (const spec of specsFromParams(tpl.name, tpl.params)) {
      if (!out.has(spec.key)) out.set(spec.key, spec);
    }
  }
  for (const spec of specsFromParams("Specifications", specSectionLines(wikitext))) {
    if (!out.has(spec.key)) out.set(spec.key, spec);
  }
  return [...out.values()];
}

/** Headings that open a specification section, in the languages the import reads. */
const SPEC_HEADING =
  /^(==+)\s*(?:specifications?|technical (?:data|specifications)|characteristics|тактико-техн\p{L}* характеристик\p{L}*|техн\p{L}* характеристик\p{L}*|льотно-техн\p{L}* характеристик\p{L}*|л[её]тно-техн\p{L}* характеристик\p{L}*|характеристик\p{L}*)\b/iu;

/**
 * `* '''Length:''' 6.5 m` lines from the FIRST specification section, as label/value pairs. Only
 * the first, because a later one usually covers a variant; and only until the next heading of
 * the same or higher level, so sub-headings ("General characteristics", "Performance") stay in.
 */
function specSectionLines(wikitext: string): [string, string][] {
  const lines = wikitext.split("\n");
  for (let start = 0; start < lines.length; start++) {
    if (!SPEC_HEADING.test(lines[start]!.trim())) continue;
    const level = lines[start]!.trim().match(/^=+/)![0].length;
    const out: [string, string][] = [];
    for (const line of lines.slice(start + 1)) {
      const heading = line.trim().match(/^(=+)[^=]/);
      if (heading && heading[1]!.length <= level) break;
      const m = line.match(/^\*\s*'''([^']{2,60}?)'''\s*:?\s*(.+)$/);
      if (m) out.push([m[1]!.replace(/:\s*$/, ""), m[2]!]);
    }
    // "Characteristics" is often prose about the airframe; keep looking for the section that
    // actually lists figures.
    if (out.length >= 2) return out;
  }
  return [];
}

function specsFromParams(template: string, params: [string, string][]): ExtractedSpec[] {
  // Group "{{Aircraft specs}}" unit variants ("range km", "range mi") so the metric one wins.
  const byBase = new Map<string, { unit?: string; raw: string; param: string }[]>();
  for (const [param, raw] of params) {
    const norm = normalizeName(param);
    const m = norm.match(/^(.*?)\s+([a-z]+)$/);
    const unit = m && NAME_UNIT[m[2]!] ? NAME_UNIT[m[2]!] : undefined;
    const base = unit ? m![1]! : norm;
    const list = byBase.get(base) ?? [];
    list.push({ ...(unit ? { unit } : {}), raw, param });
    byBase.set(base, list);
  }
  const specs: ExtractedSpec[] = [];
  for (const [base, variants] of byBase) {
    const field = FIELDS.find(([re]) => re.test(base))?.[1];
    if (!field) continue;
    const pick =
      variants.find((v) => v.unit && METRIC.has(v.unit) && clean(v.raw)) ??
      variants.find((v) => clean(v.raw));
    if (!pick) continue;
    const spec = toSpec(field, clean(pick.raw), pick.unit, `${template}: ${pick.param} = `);
    if (spec) specs.push(spec);
  }
  return specs;
}

function toSpec(
  field: Field,
  value: string,
  nameUnit: string | undefined,
  evidencePrefix: string,
): ExtractedSpec | undefined {
  // "Warhead = 50 kg HE-FRAG" is a weight, not a type.
  if (field.text && field.key === "warhead_type" && /\d\s*kg\b/i.test(value))
    return toSpec(
      { key: "warhead", label: "Warhead", unit: "kg" },
      value,
      nameUnit,
      evidencePrefix,
    );
  const evidence = `${evidencePrefix}${value}`.slice(0, MAX_EVIDENCE);
  if (field.text) {
    if (value.length > MAX_TEXT) return undefined;
    return { key: field.key, label: field.label, value, evidence };
  }
  if (!/\d/.test(value)) return undefined;
  const unit = nameUnit ?? field.unit;
  // The first quantity is the value ("6 kg payload" -> "6 kg", "50 kg; 90 kg (2024)" -> "50 kg");
  // the whole line stays in the evidence. A bare number takes the parameter's unit.
  const quantity = firstQuantity(value) ?? value;
  const text = /^[\d.,\s~≈–-]+$/.test(quantity) && unit ? `${quantity} ${unit}` : quantity;
  return {
    key: field.key,
    label: field.label,
    value: text.slice(0, MAX_VALUE),
    ...(unit ? { unit } : {}),
    evidence,
  };
}

/**
 * The first number-with-unit in a value, with "around"/"about" turned into the "~" the quantity
 * parser reads as approximate. Money is left whole: "$193,000 (export...)" is parsed as currency
 * downstream, and cutting it would lose the qualifier.
 */
function firstQuantity(value: string): string | undefined {
  if (/[$€£₽]|\b(?:usd|eur|rub|uah)\b/i.test(value)) return undefined;
  const m = value.match(
    /(?:(?:~|≈|>|≥|<|≤|around|about|approx(?:imately|\.)?|up to|over|more than|до|около|близько)\s*)?\d[\d.,]*(?:\s*(?:–|-|to)\s*\d[\d.,]*)?(?:\s*(?:km\/h|m\/s|[a-zа-яіїє°]+(?:\/[a-zа-яіїє]+)?))?/iu,
  );
  // Spelled the way parseRange reads its qualifiers, so ">20 hours" stays a lower bound.
  return m?.[0]
    .replace(/^(?:around|about)\s*/i, "~")
    .replace(/^>\s*/, "more than ")
    .replace(/^≥\s*/, "at least ")
    .replace(/^<\s*/, "less than ")
    .replace(/^≤\s*/, "up to ")
    .trim();
}

/** Wikitext markup reduced to the text a reader sees, with unit templates spelled out. */
export function clean(value: string): string {
  let s = value
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref[^>]*\/>/gi, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/<br\s*\/?>/gi, "; ");
  s = s.replace(/\{\{\s*(?:cvt|convert)\s*\|([^{}]*)\}\}/gi, (_, body: string) =>
    convertText(body),
  );
  s = s.replace(/\{\{\s*(?:nowrap|nobr)\s*\|([^{}|]*)\}\}/gi, "$1");
  // Anything else templated (citations, flags, notes) is not part of the value. Innermost first.
  for (let prev = ""; prev !== s;) {
    prev = s;
    s = s.replace(/\{\{[^{}]*\}\}/g, "");
  }
  return (
    s
      .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
      .replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, "$1")
      .replace(/'{2,}/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;|&#160;/g, " ")
      // "6,5" is a decimal in Ukrainian and Russian; "1,000" (three digits) stays a separator.
      .replace(/(\d),(\d{1,2})(?!\d)/g, "$1.$2")
      // "50 kg;<br>90 kg" would otherwise read "50 kg;; 90 kg".
      .replace(/;(?:\s*;)+/g, ";")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[;,\s]+|[;,\s]+$/g, "")
  );
}

/** {{cvt|2.5|m|ft}} -> "2.5 m"; {{convert|110|-|300|km/h}} -> "110–300 km/h". */
function convertText(body: string): string {
  const parts = body.split("|").map((p) => p.trim());
  const nums: string[] = [];
  let unit = "";
  for (const p of parts) {
    if (p.includes("=")) continue;
    if (/^[\d.,]+$/.test(p)) {
      if (!unit) nums.push(p);
      continue;
    }
    if (/^(?:-|–|to|and|x|×|or)$/i.test(p)) continue;
    if (!unit) unit = p === "kmh" ? "km/h" : p;
  }
  if (!nums.length) return "";
  const written = `${nums.join("–")}${unit ? ` ${unit}` : ""}`;
  // Articles often give knots or feet first. The quantity parser reads metric, so the metric
  // figure leads and the written one stays alongside for the evidence.
  const metric = TO_METRIC[unit];
  if (!metric) return written;
  const converted = nums.map((n) => roundMetric(Number(n.replace(/,/g, "")) * metric.factor));
  if (converted.some((n) => !Number.isFinite(n))) return written;
  return `${converted.join("–")} ${metric.unit} (${written})`;
}

const TO_METRIC: Record<string, { unit: string; factor: number }> = {
  kn: { unit: "km/h", factor: 1.852 },
  mph: { unit: "km/h", factor: 1.609344 },
  ft: { unit: "m", factor: 0.3048 },
  mi: { unit: "km", factor: 1.609344 },
  nmi: { unit: "km", factor: 1.852 },
  lb: { unit: "kg", factor: 0.45359237 },
};

function roundMetric(n: number): number {
  return n >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
}

/** Top-level and nested templates as name plus named parameters, in document order. */
function templates(wikitext: string): { name: string; params: [string, string][] }[] {
  const out: { name: string; params: [string, string][] }[] = [];
  for (let i = wikitext.indexOf("{{"); i >= 0; i = wikitext.indexOf("{{", i + 2)) {
    const end = matchingClose(wikitext, i);
    if (end < 0) break;
    const body = wikitext.slice(i + 2, end);
    const parts = splitTopLevel(body);
    const name = parts[0]?.trim() ?? "";
    if (!name || name.length > 60) continue;
    const params: [string, string][] = [];
    for (const part of parts.slice(1)) {
      const eq = part.indexOf("=");
      if (eq <= 0) continue;
      params.push([part.slice(0, eq).trim(), part.slice(eq + 1)]);
    }
    out.push({ name, params });
  }
  return out;
}

/** Index of the `}}` closing the template opened at `start`, or -1. */
function matchingClose(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length - 1; i++) {
    if (text[i] === "{" && text[i + 1] === "{") {
      depth++;
      i++;
    } else if (text[i] === "}" && text[i + 1] === "}") {
      depth--;
      if (depth === 0) return i;
      i++;
    }
  }
  return -1;
}

/** Split a template body on `|` outside nested templates and links. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === "{{" || two === "[[") {
      depth++;
      i++;
    } else if ((two === "}}" || two === "]]") && depth > 0) {
      depth--;
      i++;
    } else if (body[i] === "|" && depth === 0) {
      parts.push(body.slice(last, i));
      last = i + 1;
    }
  }
  parts.push(body.slice(last));
  return parts;
}

/**
 * Wikidata quantity properties. Sparse for drones - most items carry none - but present on some
 * that have no infobox, so they fill in rather than compete: the caller keeps the article's value
 * when both exist.
 */
const WIKIDATA_QUANTITIES: Record<string, Field> = {
  P2067: { key: "weight_launch", label: "Launch weight" },
  P2050: { key: "wingspan", label: "Wingspan" },
  P2043: { key: "length", label: "Length" },
  P2048: { key: "height", label: "Height" },
  P2386: { key: "diameter", label: "Diameter" },
  P2052: { key: "max_speed", label: "Maximum speed" },
  P2073: { key: "range", label: "Range" },
  P2254: { key: "max_altitude", label: "Maximum altitude" },
};

/** Wikidata unit items to the unit strings normalizeQuantity reads. */
const WIKIDATA_UNITS: Record<string, string> = {
  Q11573: "m",
  Q174728: "cm",
  Q174789: "mm",
  Q828224: "km",
  Q3710: "ft",
  Q253276: "mi",
  Q93318: "nmi",
  Q11570: "kg",
  Q100995: "lb",
  Q180154: "km/h",
  Q211256: "mph",
  Q128822: "kn",
  Q182429: "m/s",
};

/** Quantity statements on a Wikidata entity's `claims`, one spec per property. */
export function specsFromWikidataClaims(claims: unknown): ExtractedSpec[] {
  if (!claims || typeof claims !== "object") return [];
  const specs: ExtractedSpec[] = [];
  for (const [prop, field] of Object.entries(WIKIDATA_QUANTITIES)) {
    const list = (claims as Record<string, unknown>)[prop];
    if (!Array.isArray(list)) continue;
    const usable = list.filter((c) => (c as { rank?: unknown })?.rank !== "deprecated");
    const preferred = usable.filter((c) => (c as { rank?: unknown })?.rank === "preferred");
    for (const claim of preferred.length ? preferred : usable) {
      const value = (
        claim as { mainsnak?: { datavalue?: { value?: { amount?: unknown; unit?: unknown } } } }
      )?.mainsnak?.datavalue?.value;
      const amount = typeof value?.amount === "string" ? Number(value.amount) : Number.NaN;
      const unitId = typeof value?.unit === "string" ? value.unit.replace(/^.*\/entity\//, "") : "";
      const unit = WIKIDATA_UNITS[unitId];
      if (!Number.isFinite(amount) || amount <= 0 || !unit) continue;
      // Same rule as {{convert}}: the quantity parser reads metric, the evidence keeps the
      // statement as Wikidata records it.
      const metric = TO_METRIC[unit];
      const text = metric
        ? `${roundMetric(amount * metric.factor)} ${metric.unit}`
        : `${amount} ${unit}`;
      specs.push({
        key: field.key,
        label: field.label,
        value: text,
        unit: metric?.unit ?? unit,
        evidence: `Wikidata ${prop} = ${amount} ${unit}`,
      });
      break;
    }
  }
  return specs;
}
