/**
 * Resolver-independent frame identity helpers: family classification and the source, evidence and
 * example ids. These are shared by the Phase 3.2 frame and the E2 population.
 *
 * They live here, not in `sampling.ts`, so an E2 import cannot load `language.ts` (detector 3.1.0)
 * as a side effect. E2 derives its routing stratum from the frozen pre-D0 rule in `language-legacy`;
 * no detector implementation is on that path. The functions are moved unchanged and re-exported
 * from `sampling.ts`, which keeps every existing import path working.
 */

import { sha256Hex } from "../sha256";
import type { FrameRow } from "./types";

export const OTHER_FAMILY = "other_programme_metadata";
const ABSORBED_FAMILIES = new Set(["production", "inventory", "guidance"]);

const MANIFEST_FAMILIES = [
  "speed",
  "range",
  "altitude",
  "payload",
  "weight",
  "dimension",
  "power",
  "endurance",
  "maneuver",
  "capacity",
  "cost",
] as const;

/** Canonical families plus one explicit bucket for long-tail metadata: 12 cells on family. */
export const FAMILIES: readonly string[] = [...MANIFEST_FAMILIES, OTHER_FAMILY].sort();

interface FamilyRule {
  readonly family: string;
  readonly pattern: RegExp;
}

/**
 * Deterministic keyword classifier, independent of the resolver (no alias rules, no snapshot).
 * Keys arrive with underscores, hyphens and mixed scripts, so text is delimited-normalised before
 * matching — otherwise `load_factor` and `боевая_часть` silently land in the long-tail bucket.
 * Order matters: specific families are tested before broad ones (`warhead weight` -> payload,
 * not weight; `масса боевой части` -> payload, not weight). Documented bias: words, not the
 * resolver's concept map, and the same rules for every language.
 */
const classifyText = (s: string): string =>
  s
    .normalize("NFKC")
    .replace(/[_\-.\\/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const FAMILY_RULES: readonly FamilyRule[] = [
  {
    family: "payload",
    pattern:
      /warhead|payload|munition|explosive|charge|боев(ая|ой|ої) част|боевой части|боєвої частини|корисн(е|ий) навантаж|навантаженн[яи]|навантаж/i,
  },
  { family: "weight", pattern: /weight|mtow|take ?off|mass|мас[аи]|ваг[аи]/i },
  {
    family: "speed",
    pattern: /speed|velocity|cruise|dive|\bvne\b|mach|knot|швидкіст|скорост/i,
  },
  { family: "altitude", pattern: /altitude|ceiling|elevation|висот|потолок|стел/i },
  {
    family: "dimension",
    pattern:
      /wingspan|span|length|width|beam|diameter|depth|draft|caliber|height|dimension|довжин|ширин|розмах|висот/i,
  },
  {
    family: "range",
    pattern:
      /range|radius|distance|ferry|fiber|link|engagement|detection|дальніст|дальност|радіус/i,
  },
  {
    family: "power",
    pattern: /power|watt|\bkw\b|jamm|engine output|thrust|потужніст|мощност|двигун/i,
  },
  {
    family: "endurance",
    pattern: /endurance|loiter|flight time|flight duration|\bhours?\b|триваліст|витрим/i,
  },
  {
    family: "maneuver",
    pattern: /load factor|g[- ]?limit|maximum g|max g|maneuver|manoeuvre|acceleration|перевантаж/i,
  },
  { family: "capacity", pattern: /capacity|fuel|channels|volume|seats|палив|ємніст|емкост|канал/i },
  { family: "cost", pattern: /cost|price|procurement|вартіст|ціна|стоїм/i },
];

export function classifyFamily(rawKey: string, rawLabel?: string): string {
  const text = classifyText(`${rawKey} ${rawLabel ?? ""}`);
  for (const rule of FAMILY_RULES) if (rule.pattern.test(text)) return rule.family;
  return OTHER_FAMILY;
}

const norm = (s: string): string => s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Identical evidence collapses before the frame is frozen. The rule is intentionally
 * source-independent: normalized quote + key + value + unit only. Two outlets carrying the same
 * syndicated measurement therefore become one unit, while two genuinely independent observations
 * that happen to share the exact wording also collapse. That is the accepted rule for this pilot;
 * source and sourceClusterId are reported separately instead of entering the evidence key.
 */
export function evidenceClusterIdFor(row: FrameRow): string {
  return sha256Hex(
    [norm(row.excerpt), norm(row.rawKey), norm(row.rawValue ?? ""), norm(row.rawUnit ?? "")].join(
      "|",
    ),
  );
}

/**
 * Names one occurrence, so the same attribute twice in one text gets two different IDs.
 * The evidence hash is part of the ID because the locator alone is not unique: two rows with the
 * same source, key and value but a different unit, label or excerpt are different evidence and
 * must not collapse onto one ID in the maps that consume it downstream.
 */
export function exampleIdFor(row: FrameRow): string {
  const locator = `${row.claimId ?? row.sourceId}#${row.occurrenceIndex ?? 0}`;
  return sha256Hex(
    `${row.sourceId}|${locator}|${row.rawKey}|${row.rawValue ?? ""}|${evidenceClusterIdFor(row)}`,
  );
}

/** Same or near-identical publication: SimHash when present, else URL + excerpt prefix. */
export function sourceClusterIdFor(row: FrameRow): string {
  const proxy = `${row.url ?? ""}|${norm(row.excerpt).slice(0, 120)}`;
  return sha256Hex(
    row.contentHash !== undefined && row.contentHash.length > 0 ? row.contentHash : proxy,
  );
}
