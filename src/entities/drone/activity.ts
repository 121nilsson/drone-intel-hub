import { inflectedMonth } from "@/entities/normalization/dates";
import { leadingQualifier, parseRange } from "@/entities/normalization/numeric";
import { rate } from "@/shared/lexicons";
import type {
  ActivityMetric,
  ActivityRecord,
  ExtractedSpec,
  SpecAttribute,
  SpecClaim,
} from "./types";

/**
 * Activity figures: what reports say happened with a system over a period - launched,
 * intercepted, delivered, produced, killed. They are not properties of the system, and filed as
 * specs they became one attribute per month ("Launch Volume (June)", "Launch Volume (August)")
 * and a consensus over figures that were never meant to agree. They are split out where specs
 * are merged (spec-engine.ts), and out of stored specs by the catalogue repair (repair.ts).
 *
 * Pure. Read by key and label, the way financial figures are (entities/procurement/routing.ts),
 * and narrowly: a key must name a count of events ("launch_volume", "quantity_delivered",
 * "kill_count"), never merely mention one - "air_launched", "kill_switch", "production_country"
 * and "launch_weight" are properties, and moving one out of the specs would lose it there.
 */

/** Keys and labels, folded to snake case, that name a count of events, with what they count. */
const METRICS: ReadonlyArray<readonly [RegExp, ActivityMetric]> = [
  [
    /(?:^|_)launch(?:ed|es)?_(?:volume|count|number|total|tally|quantity)(?:_|$)|(?:^|_)(?:quantity|number|count|total)_(?:launched|fired|expended)(?:_|$)|^(?:missiles|rounds|interceptors|rockets|shells|drones)_(?:fired|expended)(?:_|$)|^(?:precision_|live_|successful_)?engagements(?:_count)?$|^launched$|^launches$|(?:^|_)quantity_in_attack$/,
    "launched",
  ],
  [
    /^(?:intercepted|shot_?down|downed|destroyed)(?:_(?:count|total|number|targets|drones|missiles|uavs))?(?:_|$)|^(?:drones|targets|missiles|uavs)_(?:downed|destroyed|intercepted|shot_?down)(?:_|$)|(?:^|_)interceptions?_(?:count|total|number)(?:_|$)/,
    "intercepted",
  ],
  [/^kills?$|(?:^|_)kills?_(?:count|tally|total)(?:_|$)|(?:^|_)confirmed_kills(?:_|$)/, "kills"],
  [
    /(?:^|_)(?:quantity|number|units|total|count)_(?:delivered|received|transferred|supplied)(?:_|$)|(?:^|_)(?:delivered|received|transferred|supplied)_(?:quantity|count|number|units|total)(?:_|$)|^(?:units|missiles|batteries|drones|systems|rounds|interceptors|launchers|vehicles|aircraft|detectors)_(?:delivered|received|transferred|supplied)(?:_|$)|^total_transferred$|(?:^|_)transfer_count(?:_|$)/,
    "delivered",
  ],
  [
    /(?:^|_)production_(?:capacity|target|rate|volume|output|quantity|scale)(?:_|$)|^annual_production(?:_|$)|(?:^|_)units_produced(?:_|$)|(?:^|_)produced_(?:units|quantity|total|count)(?:_|$)|(?:^|_)output_per_/,
    "produced",
  ],
  [/(?:^|_)(?:quantity_ordered|ordered_quantity|order_quantity)(?:_|$)/, "ordered"],
  // No bare "quantity": missiles per launcher and fleet size are filed that way too, and moving
  // a property out of the specs loses it there. A count must say what it counts.
];

/** Attributes that look like a count but measure the system or describe it: never activity. */
const NOT_ACTIVITY =
  /launch_?(?:weight|mass|time|location|site|platform|method|mode|configuration|speed|altitude|date)|first_launch|weight_launch|production_(?:timeline|start|date|status|line|site|location|cycle|country|year|variant|facility)|(?:^|_)types?$|_type_|(?:^|_)kill_(?:probability|radius|zone|switch)/;

const snake = (s: string) =>
  s
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

/** What an attribute counts, or undefined when it is a property of the system. */
export function activityMetric(spec: { key: string; label?: string }): ActivityMetric | undefined {
  const key = snake(spec.key);
  // A key that names a property is final: its label cannot turn it into a count.
  if (NOT_ACTIVITY.test(key)) return undefined;
  const byKey = METRICS.find(([re]) => re.test(key))?.[1];
  if (byKey) return byKey;
  const label = snake(spec.label ?? "");
  if (!label || NOT_ACTIVITY.test(label)) return undefined;
  return METRICS.find(([re]) => re.test(label))?.[1];
}

export const isActivitySpec = (spec: { key: string; label?: string }) =>
  activityMetric(spec) !== undefined;

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Rates by the lexicons' cues (shared/lexicons, `rates`). */
const RATES = (["day", "week", "month", "year"] as const).map(
  (per) => [per, new RegExp(`(?:^|[^\\p{L}])${rate(per)}(?![\\p{L}])`, "iu")] as const,
);

/** A token of running text, with where it starts. */
interface Token {
  word: string;
  at: number;
}

const tokens = (text: string): Token[] =>
  [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({ word: m[0], at: m.index ?? 0 }));

/** Words around a year that make it a year rather than a count: "in 2025", "2025 року". */
const YEAR_BEFORE = new Set(["in", "of", "during", "since", "for", "у", "в", "во", "за"]);
const YEAR_AFTER = new Set(["року", "році", "году", "год", "year"]);
/** "since May 2024", "з травня": the start of a running total, not the period it covers. */
const SINCE = new Set(["since", "from", "з", "із", "від", "с", "со", "от", "starting"]);

/**
 * The period a figure covers, from the sentence that states it. Read near the figure: the month
 * closest to it, and a year only where it reads as one - next to that month, or "in 2025",
 * "2025 року" - never a count that happens to be 2000-2099 ("launched 2048 Shaheds"). A month
 * with no year is the latest such month on or before the post was published, so "in August" in
 * an October post is August of that year, and in a February post August of the year before.
 */
export function activityPeriod(
  text: string,
  publishedAt: string,
  figure?: string,
): { period?: ActivityRecord["period"]; per?: ActivityRecord["per"] } {
  const out: { period?: ActivityRecord["period"]; per?: ActivityRecord["per"] } = {};
  const words = tokens(text);
  const digits = figure?.replace(/[^\d]/g, "") ?? "";
  const anchor = figure ? text.indexOf(figure.trim()) : -1;
  // A rate only in the figure's own clause: "launched 2,800 in 2025; air defence downs about 80
  // per day" makes the 80 a rate, not the 2,800.
  let start = 0;
  const own =
    anchor < 0
      ? text
      : (text.split(/[;:!?—–]|[.,](?!\d)/).find((c) => {
          const end = start + c.length + 1;
          const hit = anchor >= start && anchor < end;
          start = end;
          return hit;
        }) ?? text);
  const per = RATES.find(([, re]) => re.test(own))?.[0];
  if (per) out.per = per;
  const months = words.flatMap((t, i) => {
    const m = inflectedMonth(t.word);
    return m ? [{ i, at: t.at, month: m }] : [];
  });
  // A month in the figure's own clause first ("after a lull in January, 2,800 were launched in
  // August"), else the nearest ("In June, Russia launched roughly 450"). A comma or point inside
  // a figure ("2,800", "2.5") does not end a clause.
  const clauseOf = (at: number) => text.slice(0, at).split(/[;:!?—–]|[.,](?!\d)/).length;
  const sameClause = anchor >= 0 ? months.filter((m) => clauseOf(m.at) === clauseOf(anchor)) : [];
  const pool = sameClause.length ? sameClause : months;
  const nearest =
    anchor >= 0 && pool.length > 1
      ? [...pool].sort((a, b) => Math.abs(a.at - anchor) - Math.abs(b.at - anchor))[0]
      : pool[0];
  const isYear = (i: number) => {
    const t = words[i]!;
    if (!/^20\d\d$/.test(t.word) || t.word === digits) return false;
    const before = words[i - 1]?.word.toLowerCase();
    const after = words[i + 1]?.word.toLowerCase();
    const nearMonth = months.some((m) => Math.abs(m.i - i) <= 2);
    return nearMonth || (!!before && YEAR_BEFORE.has(before)) || (!!after && YEAR_AFTER.has(after));
  };
  const years = [...words.keys()].filter(isYear);
  const yearIndex = nearest
    ? years.sort((a, b) => Math.abs(a - nearest.i) - Math.abs(b - nearest.i))[0]
    : years[0];
  const year = yearIndex !== undefined ? Number(words[yearIndex]!.word) : undefined;
  const since = (i: number) => SINCE.has(words[i - 1]?.word.toLowerCase() ?? "");
  if (nearest) {
    const published = new Date(publishedAt);
    // A date that does not parse places nothing: no year beats "NaN-08-01".
    if (year === undefined && Number.isNaN(published.getTime())) return out;
    const y =
      year ??
      (nearest.month - 1 > published.getUTCMonth()
        ? published.getUTCFullYear() - 1
        : published.getUTCFullYear());
    const m = nearest.month;
    const label = `${MONTH_NAMES[m - 1]} ${y}`;
    out.period = since(nearest.i)
      ? { from: `${y}-${pad(m)}-01`, label: `since ${label}` }
      : { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}`, label };
  } else if (year !== undefined) {
    out.period = since(yearIndex!)
      ? { from: `${year}-01-01`, label: `since ${year}` }
      : { from: `${year}-01-01`, to: `${year}-12-31`, label: String(year) };
  }
  return out;
}

/**
 * The figure as a quantity, read by the same parser as every measurement (parseRange): ranges,
 * magnitudes ("2.5 thousand", "1,5 тис."), and a bound the figure opens with. A count followed
 * by what it counts ("2,800 drones") is read from its figure. A bound the extractor left in the
 * sentence ("launched more than 2,800" filed as "2,800") is taken from just before the figure.
 */
function quantityOf(raw: string, evidence: string | undefined): ActivityRecord["quantity"] {
  const words = raw
    .replace(/[.;:,]+$/, "")
    .trim()
    .split(/\s+/);
  let range: ReturnType<typeof parseRange>;
  for (let n = words.length; n > 0 && !range; n--) range = parseRange(words.slice(0, n).join(" "));
  if (!range) return {};
  let qualifier = range.qualifier;
  const figure = /\d[\d\s.,]*\d|\d/.exec(raw)?.[0];
  if (qualifier === "exact" && evidence && figure) {
    const at = evidence.indexOf(figure);
    if (at > 0) {
      // Each word start in the few words before the figure: "launched more than 2,800".
      const before = evidence.slice(Math.max(0, at - 32), at);
      for (const m of before.matchAll(/(?:^|\s)(?=\S)/g)) {
        const q = leadingQualifier(`${before.slice((m.index ?? 0) + m[0].length)}1`);
        if (q.qualifier !== "exact" && q.rest === "1") {
          qualifier = q.qualifier;
          break;
        }
      }
    }
  }
  if (range.min !== undefined && range.max !== undefined) return { min: range.min, max: range.max };
  const n = range.value ?? range.min ?? range.max;
  if (n === undefined) return {};
  if (qualifier === "at_least" || qualifier === "greater_than") return { min: n };
  if (qualifier === "up_to" || qualifier === "less_than") return { max: n };
  return { value: n, ...(qualifier === "approximate" ? { approximate: true } : {}) };
}

/** What was counted, when it follows the figure ("2,800 drones", "24 missiles"). */
function countedUnit(raw: string, evidence: string | undefined): string | undefined {
  const noun =
    /^\s*\+?\s+(?:[\p{L}-]+\s+){0,2}?(drones?|missiles?|rounds?|shells?|interceptors?|units?|systems?|munitions?|bombs?|rockets?|aircraft|vehicles?|uavs?|batteries|battery|launchers?|shaheds?|gerans?)\b/iu;
  const figure = /\d[\d\s.,]*\d|\d/.exec(raw);
  if (!figure) return undefined;
  // After this record's own figure only: in "2,800 drones and 24 missiles" the 24 is missiles.
  const own = noun.exec(raw.slice(figure.index + figure[0].length));
  if (own) return own[1]!.toLowerCase();
  const at = evidence ? evidence.indexOf(figure[0]) : -1;
  if (at < 0) return undefined;
  return noun.exec(evidence!.slice(at + figure[0].length))?.[1]?.toLowerCase();
}

export interface ActivityContext {
  source: string;
  sourceId?: string;
  /** When the figure was read. */
  date: string;
  /** When the post was published; a month without a year is placed against this. */
  publishedAt?: string;
  extractionEngine?: string;
  model?: string;
}

/** One record from an extracted spec, or undefined when the spec is a property. */
export function toActivity(spec: ExtractedSpec, ctx: ActivityContext): ActivityRecord | undefined {
  const metric = activityMetric(spec);
  if (!metric) return undefined;
  const raw = (spec.raw ?? String(spec.value)).trim();
  const figure = /\d[\d\s.,]*\d|\d/.exec(raw)?.[0];
  const { period, per } = activityPeriod(
    `${spec.label}. ${spec.evidence ?? ""}`,
    ctx.publishedAt ?? ctx.date,
    figure,
  );
  const unit = countedUnit(raw, spec.evidence);
  return {
    id: crypto.randomUUID(),
    metric,
    label: spec.label,
    raw,
    quantity: quantityOf(raw, spec.evidence),
    ...(unit ? { unit } : {}),
    ...(period ? { period } : {}),
    ...(per ? { per } : {}),
    source: ctx.source,
    ...(ctx.sourceId ? { sourceId: ctx.sourceId } : {}),
    ...(spec.evidence ? { evidence: spec.evidence } : {}),
    date: ctx.date,
    ...(ctx.publishedAt ? { publishedAt: ctx.publishedAt } : {}),
    ...(ctx.extractionEngine ? { extractionEngine: ctx.extractionEngine } : {}),
    ...(ctx.model ? { model: ctx.model } : {}),
    ...(spec.provenance ? { provenance: spec.provenance } : {}),
  };
}

/** The stored spec's claims as records, for the repair that moves them out of `specs`. */
export function activityFromStoredSpec(
  spec: SpecAttribute,
  publishedFor: (claim: SpecClaim) => string | undefined = () => undefined,
): ActivityRecord[] {
  return spec.claims.flatMap((c: SpecClaim) => {
    // The post's publication date where the caller can find it; the read date otherwise.
    const publishedAt = publishedFor(c);
    const r = toActivity(
      {
        key: spec.key,
        label: spec.label,
        value: c.value,
        ...(c.raw ? { raw: c.raw } : {}),
        ...(c.evidence ? { evidence: c.evidence } : {}),
      },
      {
        source: c.source,
        ...(c.sourceId ? { sourceId: c.sourceId } : {}),
        date: c.date,
        ...(publishedAt ? { publishedAt } : {}),
        ...(c.extractionEngine ? { extractionEngine: c.extractionEngine } : {}),
        ...(c.model ? { model: c.model } : {}),
      },
    );
    return r ? [r] : [];
  });
}

/**
 * The same figure from the same report: what was counted and how many, by the report's source line
 * (every record carries it; a repaired one has no post id). Never by the wording - the heuristic's
 * "2,800" and the AI's "more than 2,800" are one figure.
 */
const figureOf = (r: ActivityRecord) => {
  const q = r.quantity;
  return `${r.metric}|${r.source}|${q.value ?? q.min ?? q.max ?? r.raw}`;
};

/**
 * Two records are one figure when they agree on the figure and do not disagree on what or when:
 * a unit or a month one reader left out is no disagreement ("2,800 drones in August" and "more
 * than 2,800"), while "500 in June" and "500 in July", or "24 drones" and "24 missiles", stay two.
 */
export function sameFigure(a: ActivityRecord, b: ActivityRecord): boolean {
  if (figureOf(a) !== figureOf(b)) return false;
  const agree = (x?: string, y?: string) => !x || !y || x === y;
  return agree(a.unit, b.unit) && agree(a.period?.label, b.period?.label);
}

/** Who stands behind a figure: the AI's restatement outranks the heuristic's alone. */
const rank = (r: ActivityRecord) => (r.provenance === "heuristic" ? 0 : 1);
/** How much a record says: a unit and a period are worth keeping when two readings are merged. */
const detail = (r: ActivityRecord) => Number(!!r.unit) + Number(!!r.period);

/**
 * Add records an entry does not already hold. The same figure read twice keeps one record: the
 * one the AI stood behind, else the one that says more, with the other's unit or period filled in.
 */
export function withActivity(
  existing: readonly ActivityRecord[] | undefined,
  add: readonly ActivityRecord[],
): ActivityRecord[] {
  const out = [...(existing ?? [])];
  for (const r of add) {
    const at = out.findIndex((o) => sameFigure(o, r));
    if (at < 0) {
      out.push(r);
      continue;
    }
    const o = out[at]!;
    const [keep, other] =
      rank(r) > rank(o) || (rank(r) === rank(o) && detail(r) > detail(o)) ? [r, o] : [o, r];
    out[at] = {
      ...keep,
      ...(!keep.unit && other.unit ? { unit: other.unit } : {}),
      ...(!keep.period && other.period ? { period: other.period } : {}),
    };
  }
  return out;
}
