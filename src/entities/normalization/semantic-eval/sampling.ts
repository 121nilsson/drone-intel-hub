/**
 * Phase 3.2 / S2 — frame freeze, whole-frame replay and seeded stratified sampling. Pure.
 *
 * The resolver is deterministic and cheap, so it is run on the ENTIRE frame. That makes every
 * unit's resolverStatus a known population quantity, which is what makes the finite-population
 * bounds in metrics.ts valid. Strata are language x family x resolverStatus.
 *
 * Dedupe happens before the freeze: one unit per evidenceClusterId, but every distinct attribute
 * of one document is kept. There is no per-source cap — sampling is a plain seeded SRS within
 * each cell, so the exact bound's design assumptions are not quietly broken.
 */

import { seededRandom, shuffle } from "../../drone/audit";
import { detectLanguage } from "../language";
import { sha256Hex } from "../sha256";
import type { ReadonlySemanticSnapshot } from "../semantic-resolver";
import { canonicalJson } from "./validate";
import {
  FAMILY_COUNT,
  FRAME_CUTOFF,
  LANGUAGES,
  RESOLVER_STATUSES,
  RESOLVER_STATUS_COUNT,
  parseStratumKey,
  stratumKey,
  type CellStat,
  type Exclusion,
  type Example,
  type FrameRow,
  type Prediction,
  type SourceConcentration,
} from "./types";

/** The 12 families of the proposed pilot frame, derived from the canonical manifest. */
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

/** A frozen unit: everything an Example is, before the resolver fixes its status. */
export type FrozenUnit = Omit<Example, "resolverStatus" | "stratum">;

export interface FreezeOptions {
  readonly frameId: string;
  readonly cutoff?: string;
  readonly isPilot?: boolean;
  readonly defaultOrigin?: FrameRow["origin"];
}

export interface FreezeResult {
  readonly units: readonly FrozenUnit[];
  readonly exclusions: readonly Exclusion[];
  readonly truncated: number;
}

function addExclusion(map: Map<string, number>, reason: string): void {
  map.set(reason, (map.get(reason) ?? 0) + 1);
}

/** Freeze the frame: validate, derive, truncate excerpts, then dedupe identical evidence. */
export function freezeFrame(rows: readonly FrameRow[], options: FreezeOptions): FreezeResult {
  const cutoff = options.cutoff ?? FRAME_CUTOFF;
  const exclusions = new Map<string, number>();
  let truncated = 0;
  const candidates: FrozenUnit[] = [];

  // Full-row stable key: a shorter key leaves ties that depend on input order, which would make
  // "first occurrence wins" in the dedupe non-reproducible across exports of the same records.
  const ordered = [...rows].sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));

  for (const row of ordered) {
    if (row.rawKey.trim().length === 0) {
      addExclusion(exclusions, "empty_raw_key");
      continue;
    }
    if (row.excerpt.trim().length === 0) {
      addExclusion(exclusions, "empty_excerpt");
      continue;
    }
    // Compare instants, not strings: an offset timestamp can be before the UTC cutoff even when
    // its local calendar date looks later (and vice versa).
    if (row.publishedAt === undefined) {
      addExclusion(exclusions, "missing_published_at");
      continue;
    }
    const publishedMs = Date.parse(row.publishedAt);
    const cutoffMs = Date.parse(cutoff);
    if (Number.isNaN(cutoffMs)) throw new Error(`invalid cutoff: ${cutoff}`);
    if (Number.isNaN(publishedMs)) {
      addExclusion(exclusions, "invalid_published_at");
      continue;
    }
    if (publishedMs > cutoffMs) {
      addExclusion(exclusions, "after_cutoff");
      continue;
    }
    const excerpt = row.excerpt.length > 300 ? `${row.excerpt.slice(0, 299)}…` : row.excerpt;
    if (excerpt !== row.excerpt) truncated++;
    const exampleId = exampleIdFor(row);
    const priorAnalystReview =
      row.priorAnalystVerdict !== undefined && row.claimId !== undefined
        ? { claimId: row.claimId, verdict: row.priorAnalystVerdict }
        : undefined;
    candidates.push({
      exampleId,
      sourceClusterId: sourceClusterIdFor(row),
      evidenceClusterId: evidenceClusterIdFor(row),
      source: {
        id: row.sourceId,
        ...(row.url !== undefined ? { url: row.url } : {}),
        ...(row.publishedAt !== undefined ? { publishedAt: row.publishedAt } : {}),
      },
      excerpt,
      language: row.language ?? detectLanguage(row.excerpt),
      rawKey: row.rawKey,
      ...(row.rawLabel !== undefined ? { rawLabel: row.rawLabel } : {}),
      ...(row.rawValue !== undefined ? { rawValue: row.rawValue } : {}),
      ...(row.rawUnit !== undefined ? { rawUnit: row.rawUnit } : {}),
      context: {
        ...(row.domain !== undefined ? { domain: row.domain } : {}),
        ...(row.systemClass !== undefined ? { systemClass: row.systemClass } : {}),
        ...(row.subsystem !== undefined ? { subsystem: row.subsystem } : {}),
      },
      ...(priorAnalystReview !== undefined ? { priorAnalystReview } : {}),
      family: classifyFamily(row.rawKey, row.rawLabel),
      origin: row.origin ?? options.defaultOrigin ?? "historical",
      isPilot: options.isPilot ?? false,
      frameId: options.frameId,
      schemaVersion: "1.0.0",
    });
  }

  // Rows with the same evidence id but different stratification/context metadata are a conflict,
  // not a harmless duplicate: silently keeping one by sort order would make the frame depend on
  // input order in substance. Reject the whole cluster instead.
  const byEvidence = new Map<string, FrozenUnit[]>();
  for (const unit of candidates) {
    byEvidence.set(unit.evidenceClusterId, [
      ...(byEvidence.get(unit.evidenceClusterId) ?? []),
      unit,
    ]);
  }
  const conflictingEvidence = new Set<string>();
  for (const [id, group] of byEvidence) {
    const signatures = new Set(
      group.map((u) =>
        canonicalJson({
          language: u.language,
          context: u.context,
          ...(u.priorAnalystReview !== undefined
            ? { priorAnalystReview: u.priorAnalystReview }
            : {}),
        }),
      ),
    );
    if (signatures.size > 1) conflictingEvidence.add(id);
  }
  conflictingEvidence.forEach(() => addExclusion(exclusions, "conflicting_evidence_metadata"));

  const seenEvidence = new Set<string>();
  const seenIds = new Set<string>();
  const units: FrozenUnit[] = [];
  for (const unit of candidates) {
    if (conflictingEvidence.has(unit.evidenceClusterId)) continue;
    if (seenEvidence.has(unit.evidenceClusterId)) {
      addExclusion(exclusions, "duplicate_evidence");
      continue;
    }
    // Defensive: every downstream map is keyed by exampleId. A collision here would silently
    // drop a decision or prediction, so refuse the unit rather than ship an ambiguous frame.
    if (seenIds.has(unit.exampleId)) {
      addExclusion(exclusions, "duplicate_example_id");
      continue;
    }
    seenEvidence.add(unit.evidenceClusterId);
    seenIds.add(unit.exampleId);
    units.push(unit);
  }
  return {
    units,
    exclusions: [...exclusions.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([reason, count]) => ({ reason, count })),
    truncated,
  };
}

export interface ResolvedFrame {
  readonly examples: readonly Example[];
  readonly predictions: readonly Prediction[];
}

/** Whole-frame replay: every unit gets a frozen resolverStatus and a hash-stamped prediction. */
export function resolveFrozenFrame(
  units: readonly FrozenUnit[],
  snapshot: ReadonlySemanticSnapshot,
  resolverVersion: string,
): ResolvedFrame {
  const examples: Example[] = [];
  const predictions: Prediction[] = [];
  for (const unit of units) {
    const result = snapshot.resolve({
      rawKey: unit.rawKey,
      ...(unit.rawLabel !== undefined ? { rawLabel: unit.rawLabel } : {}),
      ...(unit.rawUnit !== undefined ? { rawUnit: unit.rawUnit } : {}),
      ...(unit.context.domain !== undefined ? { domain: unit.context.domain } : {}),
      ...(unit.context.systemClass !== undefined ? { systemClass: unit.context.systemClass } : {}),
      ...(unit.context.subsystem !== undefined ? { subsystem: unit.context.subsystem } : {}),
      ...(unit.language !== "unknown" ? { language: unit.language } : {}),
    });
    const resolverStatus = result.status === "resolved" ? "resolved" : "withheld";
    examples.push({
      ...unit,
      resolverStatus,
      stratum: stratumKey({
        language: unit.language,
        family: unit.family,
        resolverStatus,
      }),
    });
    predictions.push({
      exampleId: unit.exampleId,
      result,
      snapshotHash: result.snapshotHash,
      resolverVersion,
    });
  }
  return { examples, predictions };
}

/** Build the frozen, replayed frame from raw rows in one call. */
export function buildFrame(
  rows: readonly FrameRow[],
  options: FreezeOptions & {
    readonly snapshot: ReadonlySemanticSnapshot;
    readonly resolverVersion: string;
  },
): ResolvedFrame & { readonly exclusions: readonly Exclusion[]; readonly truncated: number } {
  const frozen = freezeFrame(rows, options);
  const replayed = resolveFrozenFrame(frozen.units, options.snapshot, options.resolverVersion);
  return { ...replayed, exclusions: frozen.exclusions, truncated: frozen.truncated };
}

/**
 * Largest-remainder allocation with a total ceiling and NO guaranteed draw per cell. Unlike
 * allocateProportional (which insists on one draw in every non-empty stratum), the plan permits
 * unsampled cells when the 72-unit ceiling is below the number of non-empty cells. Small cells
 * are taken whole; the rest get floors plus the largest remainders, with a name tie-break.
 */
export function allocateWithinCeiling(
  populations: Readonly<Record<string, number>>,
  size: number,
): Record<string, number> {
  if (!Number.isSafeInteger(size) || size < 0) throw new RangeError("size must be >= 0");
  const names = Object.keys(populations)
    .filter((name) => (populations[name] ?? 0) > 0)
    .sort();
  const total = names.reduce((sum, name) => sum + (populations[name] ?? 0), 0);
  const result: Record<string, number> = Object.fromEntries(names.map((name) => [name, 0]));
  if (total === 0 || size === 0) return result;
  if (total <= size) {
    for (const name of names) result[name] = populations[name]!;
    return result;
  }
  const remainder = new Map<string, number>();
  for (const name of names) {
    const raw = (size * populations[name]!) / total;
    result[name] = Math.floor(raw);
    remainder.set(name, raw - result[name]!);
  }
  let leftover = size - names.reduce((sum, name) => sum + result[name]!, 0);
  const order = names
    .filter((name) => result[name]! < populations[name]!)
    .sort((a, b) => remainder.get(b)! - remainder.get(a)! || a.localeCompare(b));
  let i = 0;
  while (leftover > 0 && order.length > 0) {
    const name = order[i % order.length]!;
    if (result[name]! < populations[name]!) {
      result[name] = result[name]! + 1;
      leftover--;
    }
    i++;
  }
  return result;
}

export interface SampleOptions {
  readonly seed: string;
  readonly ceiling: number;
}

export interface SampleResult {
  readonly sampled: readonly Example[];
  readonly cells: readonly CellStat[];
  readonly emptyCells: readonly string[];
  readonly unsampledCells: readonly string[];
  readonly populationCount: number;
  readonly drawnCount: number;
  /** Share of the population lying in cells that received at least one draw. */
  readonly coveredFraction: number;
}

/**
 * Plain seeded simple random sample within each cell. A cell's RNG is derived from the global seed
 * and its own id, so adding a cell elsewhere cannot reshuffle an existing one.
 */
export function drawSample(examples: readonly Example[], options: SampleOptions): SampleResult {
  const byCell = new Map<string, Example[]>();
  for (const e of examples) {
    const list = byCell.get(e.stratum) ?? [];
    list.push(e);
    byCell.set(e.stratum, list);
  }
  const nonEmpty = [...byCell.keys()].sort();
  const populations: Record<string, number> = Object.fromEntries(
    nonEmpty.map((k) => [k, byCell.get(k)!.length]),
  );
  const allocation = allocateWithinCeiling(populations, options.ceiling);
  const cells: CellStat[] = [];
  const sampled: Example[] = [];
  const unsampledCells: string[] = [];

  for (const stratum of nonEmpty) {
    const ids = byCell
      .get(stratum)!
      .map((e) => e.exampleId)
      .sort();
    const n = allocation[stratum] ?? 0;
    const cellSeed = Number.parseInt(sha256Hex(`${options.seed}|${stratum}`).slice(0, 8), 16);
    const drawnIds = n === 0 ? [] : shuffle(ids, seededRandom(cellSeed)).slice(0, n);
    const drawnSet = new Set(drawnIds);
    for (const e of byCell.get(stratum)!) if (drawnSet.has(e.exampleId)) sampled.push(e);
    const key = parseStratumKey(stratum);
    if (!key) throw new Error(`internal: malformed cell id ${stratum}`);
    cells.push({
      stratum,
      language: key.language,
      family: key.family,
      resolverStatus: key.resolverStatus,
      population: populations[stratum]!,
      drawn: drawnIds.length,
      sampledExampleIds: [...drawnIds].sort(),
    });
    if (drawnIds.length === 0) unsampledCells.push(stratum);
  }

  const possible: string[] = [];
  for (const language of LANGUAGES)
    for (const family of FAMILIES)
      for (const resolverStatus of RESOLVER_STATUSES)
        possible.push(stratumKey({ language, family, resolverStatus }));
  const nonEmptySet = new Set(nonEmpty);
  const emptyCells = possible.filter((k) => !nonEmptySet.has(k));
  const populationCount = examples.length;
  const covered = cells.filter((c) => c.drawn > 0).reduce((sum, c) => sum + c.population, 0);
  sampled.sort((a, b) => a.exampleId.localeCompare(b.exampleId));

  return {
    sampled,
    cells,
    emptyCells,
    unsampledCells,
    populationCount,
    drawnCount: sampled.length,
    coveredFraction: populationCount === 0 ? 0 : covered / populationCount,
  };
}

/** Source-cluster concentration is reported for transparency, never as a design-effect fix. */
export function sourceConcentration(
  examples: readonly Example[],
  topK = 5,
): { readonly rows: readonly SourceConcentration[]; readonly topShare: number } {
  const counts = new Map<string, number>();
  for (const e of examples) counts.set(e.sourceClusterId, (counts.get(e.sourceClusterId) ?? 0) + 1);
  const rows = [...counts.entries()]
    .map(([sourceClusterId, units]) => ({ sourceClusterId, units }))
    .sort((a, b) => b.units - a.units || a.sourceClusterId.localeCompare(b.sourceClusterId));
  const top = rows.slice(0, topK);
  const topShare =
    examples.length === 0 ? 0 : top.reduce((s, r) => s + r.units, 0) / examples.length;
  return { rows: top, topShare };
}

export function frameIdFor(examples: readonly Example[]): string {
  return sha256Hex(examples.map((e) => e.exampleId).join("|"));
}

export interface SamplingReportInput {
  readonly frameId: string;
  readonly seed: string;
  readonly cutoff: string;
  readonly ceiling: number;
  readonly pilot: boolean;
  readonly snapshotHash: string;
  readonly resolverVersion: string;
  readonly sample: SampleResult;
  readonly exclusions: readonly Exclusion[];
  readonly truncated: number;
  readonly concentration: ReturnType<typeof sourceConcentration>;
  readonly manifestHash: string;
}

const mdCell = (s: string) => s.replace(/\|/g, "\\|");

/** Deterministic markdown (no timestamps): the same frame and seed give the same bytes. */
export function renderSamplingReport(input: SamplingReportInput): string {
  const { sample } = input;
  const lines: string[] = [];
  lines.push("# Semantic evaluation sampling report (Phase 3.2 / S2)", "");
  lines.push(
    "> This is a proposed pilot frame, not an approval. Figures describe the frozen frame up to the cutoff only, not future reports, languages or sources.",
    "",
  );
  lines.push(
    `- Frame: \`${input.frameId}\`, cutoff \`${input.cutoff}\``,
    `- Seed \`${input.seed}\`; snapshot hash \`${input.snapshotHash}\`; resolver version ${input.resolverVersion}`,
    `- Manifest hash \`${input.manifestHash}\``,
    `- Population ${sample.populationCount}; drawn ${sample.drawnCount}; ceiling ${input.ceiling}; mode ${input.pilot ? "pilot" : "post-pilot expansion"}`,
    `- Covered fraction of population (cells with a draw): ${(sample.coveredFraction * 100).toFixed(1)}%`,
    `- Family cells on the frame: ${FAMILY_COUNT}; languages: ${LANGUAGES.length}; resolver statuses: ${RESOLVER_STATUS_COUNT}`,
    "",
  );

  lines.push("## Cells", "");
  lines.push("| Cell | N_h | n_h | Sampled ids |", "|---|---:|---:|---|");
  for (const c of sample.cells) {
    lines.push(
      `| ${mdCell(c.stratum)} | ${c.population} | ${c.drawn} | ${c.sampledExampleIds.join(", ")} |`,
    );
  }
  lines.push("");
  lines.push(
    `Empty cells (${sample.emptyCells.length} of ${FAMILY_COUNT * LANGUAGES.length * RESOLVER_STATUS_COUNT} possible): ${sample.emptyCells.length === 0 ? "none" : sample.emptyCells.map((c) => `\`${c}\``).join(", ")}.`,
    "",
  );
  lines.push(
    `Unsampled non-empty cells (${sample.unsampledCells.length}): ${sample.unsampledCells.length === 0 ? "none" : sample.unsampledCells.map((c) => `\`${c}\``).join(", ")}. These are expected under the total ceiling and are NOT backfilled.`,
    "",
  );

  lines.push("## Exclusions and transformations", "");
  if (input.exclusions.length === 0) {
    lines.push("No exclusions.", "");
  } else {
    lines.push("| Reason | Count |", "|---|---:|");
    for (const e of input.exclusions) lines.push(`| ${mdCell(e.reason)} | ${e.count} |`);
    lines.push("");
  }
  lines.push(`Excerpts truncated to 300 characters: ${input.truncated}.`, "");

  lines.push("## Source-cluster concentration (transparency only)", "");
  lines.push(
    `Top ${input.concentration.rows.length} clusters hold ${(input.concentration.topShare * 100).toFixed(1)}% of the frame. This is reported, not used as a design-effect correction: the frame is a fixed finite population sampled at random within cells.`,
    "",
  );
  lines.push("| Source cluster | Units |", "|---|---:|");
  for (const r of input.concentration.rows) lines.push(`| \`${r.sourceClusterId}\` | ${r.units} |`);
  lines.push("");

  lines.push("## Scope", "");
  lines.push(
    "Every figure above describes the frozen frame only. It does not establish the same quality for future reports, new languages, new sources or new attributes.",
    "",
  );
  return lines.join("\n");
}
