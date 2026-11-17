/**
 * Phase 3.2 / S5 — metrics, finite-population bounds and the evidence-labelled report. Pure.
 *
 * Suitability of stratifiedUpperBound() (written check, §F):
 *  - Resolution Precision and Withholding Precision are error SHARES in a finite population (R or
 *    W) whose cell sizes N_h are known because the resolver ran on the whole frame, with a seeded
 *    simple random sample inside each cell. That is exactly the design the bound assumes, so the
 *    exact hypergeometric count bound applies — on the COUNT, then divided by the known total.
 *    Weights go on counts (N_h x share), never on a ratio of ratios.
 *  - Withholding Recall is a RATIO of two estimated counts from two different populations (W and
 *    R). No single-population bound applies to the ratio. We bound the two counts componentwise at
 *    alpha/2 and form the conservative lower bound L_TN,W / (L_TN,W + U_FN,R), then describe it as
 *    conservative. No required n is asserted for recall.
 *  - Conditional performance among assessable units has an unknown denominator in the population,
 *    so it is descriptive only and carries NO confidence bound.
 *
 * The bound is refused when a non-empty cell has no draw, the search is incomplete, the sample's
 * provenance cannot be verified, or protocol versions are mixed. The refusal is a string in the
 * report, never a number with a caveat.
 */

import {
  allocateProportional,
  stratifiedUpperBound,
  type StratumSample,
} from "../../drone/audit-statistics";
import { FAMILIES, sourceConcentration } from "./sampling";
import {
  aiAgreementRate,
  blindVsFinalChangeRate,
  canonicalJson,
  checkDecisionSet,
} from "./validate";
import {
  LANGUAGES,
  ORIGINS,
  RESOLVER_STATUSES,
  isWithholdingVerdict,
  stratumKey,
  type Decision,
  type EvidenceLabel,
  type Example,
  type Origin,
  type Prediction,
  type SamplingManifest,
  type Suggestion,
} from "./types";

export const TARGETS = {
  resolutionPrecision: 0.99,
  withholdingPrecision: 0.95,
  withholdingRecall: 0.98,
} as const;

export type MetricName = keyof typeof TARGETS;

/** Default significance level; callers may override it through MetricsInput.alpha. */
const ALPHA = 0.05;

/** n needed for the simple all-assessable zero-error one-sided bound to reach (1 - e). */
export function requiredSampleSize(target: number, alpha = ALPHA): number {
  if (!(target > 0 && target < 1)) throw new RangeError("target must lie in (0, 1)");
  return Math.ceil(Math.log(alpha) / Math.log(target));
}

export interface BoundInfo {
  readonly available: boolean;
  readonly reason?: string | undefined;
  /** Upper confidence bound on the error count, when available. */
  readonly upperCount?: number | undefined;
  /** Lower confidence bound on the error count, when available. */
  readonly lowerCount?: number | undefined;
  readonly upperRate?: number | undefined;
}

export interface CellMetric {
  readonly cell: string;
  readonly population: number;
  readonly sampled: number;
  readonly errors: number;
  readonly assessed: number;
  readonly conditionalErrors: number;
  readonly unassessable: number;
}

interface EvalPair {
  readonly example: Example;
  readonly prediction: Prediction;
}

function subpopulation(
  examples: readonly Example[],
  predictions: readonly Prediction[],
  status: "resolved" | "withheld",
): Map<string, EvalPair> {
  const pred = new Map(predictions.map((p) => [p.exampleId, p]));
  const out = new Map<string, EvalPair>();
  for (const e of examples) {
    if (e.resolverStatus !== status) continue;
    const p = pred.get(e.exampleId);
    if (!p) throw new Error(`no prediction for example ${e.exampleId}`);
    out.set(e.exampleId, { example: e, prediction: p });
  }
  return out;
}

type ErrorClassifier = (d: Decision, pair: EvalPair) => boolean;

function cellName(pair: EvalPair): string {
  return `${pair.example.language}|${pair.example.family}`;
}

interface Tally {
  readonly strata: StratumSample[];
  readonly cells: CellMetric[];
  readonly sampledCount: number;
  readonly assessedCount: number;
  readonly errorsWorst: number;
  readonly errorsAssessable: number;
  readonly unassessableCount: number;
}

function tally(
  population: ReadonlyMap<string, EvalPair>,
  decisions: readonly Decision[],
  isError: ErrorClassifier,
): Tally {
  const byCell = new Map<string, EvalPair[]>();
  for (const pair of population.values()) {
    const name = cellName(pair);
    byCell.set(name, [...(byCell.get(name) ?? []), pair]);
  }
  const strata: StratumSample[] = [];
  const cells: Tally["cells"] = [];
  let sampledCount = 0;
  let assessedCount = 0;
  let errorsWorst = 0;
  let errorsAssessable = 0;
  let unassessableCount = 0;

  for (const [name, pairs] of [...byCell.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const ids = new Set(pairs.map((p) => p.example.exampleId));
    const inCell = decisions.filter((d) => ids.has(d.exampleId));
    let errors = 0;
    let assessed = 0;
    let conditionalErrors = 0;
    let unassessable = 0;
    for (const d of inCell) {
      const pair = population.get(d.exampleId)!;
      if (isError(d, pair)) errors++;
      if (d.blindVerdict === "insufficient_evidence") {
        unassessable++;
        unassessableCount++;
      } else {
        assessed++;
        if (isError(d, pair)) conditionalErrors++;
      }
    }
    strata.push({ name, population: pairs.length, sampled: inCell.length, errors });
    cells.push({
      cell: name,
      population: pairs.length,
      sampled: inCell.length,
      errors,
      assessed,
      conditionalErrors,
      unassessable,
    });
    sampledCount += inCell.length;
    assessedCount += assessed;
    errorsWorst += errors;
    errorsAssessable += conditionalErrors;
  }
  return {
    strata,
    cells,
    sampledCount,
    assessedCount,
    errorsWorst,
    errorsAssessable,
    unassessableCount,
  };
}

function coverageGuard(t: Tally): string | undefined {
  const uncovered = t.strata.filter((s) => s.population > 0 && s.sampled === 0);
  if (uncovered.length > 0) {
    return `uncovered non-empty stratum (${uncovered.map((s) => s.name).join(", ")})`;
  }
  return undefined;
}

/** Exact upper bound on an error COUNT; refusal, never a guessed number. */
function upperCountBound(t: Tally, alpha: number): { count?: number; reason?: string } {
  const guard = coverageGuard(t);
  if (guard) return { reason: `bound not available: ${guard}` };
  if (t.strata.length === 0) return { reason: "bound not available: empty population" };
  const ub = stratifiedUpperBound(t.strata, { alpha });
  if (ub.kind === "incomplete") return { reason: "bound not available: search incomplete" };
  if (ub.kind === "no_population") return { reason: "bound not available: empty population" };
  if (ub.kind === "census") return { count: t.errorsWorst };
  return { count: ub.wrongMax };
}

/**
 * Horvitz-Thompson point estimate of the error share in the finite population: each stratum's
 * observed error count is expanded by N_h / n_h, never pooled as a raw ratio. Undefined when a
 * non-empty stratum has no draw, because then part of the population is unobservable.
 */
function pointEstimateShare(t: Tally): number | undefined {
  if (coverageGuard(t) !== undefined) return undefined;
  const total = t.strata.reduce((sum, s) => sum + s.population, 0);
  if (total === 0) return 0;
  let estimatedErrors = 0;
  for (const s of t.strata) {
    if (s.population > 0) estimatedErrors += (s.population / s.sampled) * s.errors;
  }
  return 1 - estimatedErrors / total;
}

/**
 * Expand a per-cell count to the finite population by N_h / n_h. Undefined when a non-empty cell
 * has no draw: that part of the population is unobservable, so no count can be estimated for it.
 */
function expandCount(
  cells: readonly CellMetric[],
  count: (c: CellMetric) => number,
): number | undefined {
  let total = 0;
  for (const c of cells) {
    if (c.population === 0) continue;
    if (c.sampled === 0) return undefined;
    total += (c.population / c.sampled) * count(c);
  }
  return total;
}

function lowerCountBound(t: Tally, alpha: number): number | undefined {
  if (coverageGuard(t) !== undefined || t.strata.length === 0) return undefined;
  const inverse: StratumSample[] = t.strata.map((s) => ({
    ...s,
    errors: s.sampled - s.errors,
  }));
  const ub = stratifiedUpperBound(inverse, { alpha });
  if (ub.kind !== "bound" && ub.kind !== "census") return undefined;
  const total = t.strata.reduce((sum, s) => sum + s.population, 0);
  const upperNonErrors =
    ub.kind === "census" ? inverse.reduce((s, x) => s + x.errors, 0) : ub.wrongMax;
  return Math.max(0, total - upperNonErrors);
}

export interface MetricResult {
  readonly name: MetricName;
  readonly target: number;
  /** Worst-case sensitivity: insufficient_evidence is counted against the resolver. */
  readonly pointEstimate: number | undefined;
  readonly bound: BoundInfo;
  /** Descriptive only, NO bound; always printed beside its coverage rate. */
  readonly conditional: {
    readonly pointEstimate: number;
    readonly coverageRate: number;
    readonly assessed: number;
    readonly sampled: number;
    readonly mayBeOptimistic: boolean;
  };
  readonly evidence: EvidenceLabel;
  readonly cells: readonly CellMetric[];
}

function classifyPrecision(name: "resolutionPrecision" | "withholdingPrecision"): ErrorClassifier {
  if (name === "resolutionPrecision") {
    return (d, pair) =>
      d.blindVerdict !== "resolve" || d.blindCanonicalId !== pair.prediction.result.canonicalId;
  }
  return (d) => d.blindVerdict === "resolve" || d.blindVerdict === "insufficient_evidence";
}

interface PrecisionComputation {
  readonly metric: MetricResult;
  readonly metricUpper?: number | undefined;
}

function precisionMetric(
  name: "resolutionPrecision" | "withholdingPrecision",
  population: ReadonlyMap<string, EvalPair>,
  decisions: readonly Decision[],
  target: number,
  pilot: boolean,
  alpha: number,
): PrecisionComputation {
  const t = tally(population, decisions, classifyPrecision(name));
  const total = t.strata.reduce((sum, s) => sum + s.population, 0);
  const up = upperCountBound(t, alpha);
  const low = lowerCountBound(t, alpha);
  const bound: BoundInfo =
    up.count === undefined
      ? { available: false, reason: up.reason }
      : {
          available: true,
          upperCount: up.count,
          ...(low !== undefined ? { lowerCount: low } : {}),
          upperRate: total === 0 ? 0 : up.count / total,
        };
  const pointEstimate = pointEstimateShare(t);
  const coverageRate = t.sampledCount === 0 ? 0 : t.assessedCount / t.sampledCount;
  const conditionalPoint = t.assessedCount === 0 ? 0 : 1 - t.errorsAssessable / t.assessedCount;
  let metricUpper: number | undefined;
  if (low !== undefined && total > 0) {
    metricUpper = 1 - low / total;
    if (metricUpper < target) {
      return {
        metricUpper,
        metric: {
          name,
          target,
          pointEstimate,
          bound,
          conditional: {
            pointEstimate: conditionalPoint,
            coverageRate,
            assessed: t.assessedCount,
            sampled: t.sampledCount,
            mayBeOptimistic: t.unassessableCount > 0,
          },
          evidence: "target_violated",
          cells: t.cells,
        },
      };
    }
  }
  let evidence: EvidenceLabel;
  if (!bound.available || bound.upperRate === undefined) {
    evidence = pilot ? "exploratory" : "target_not_demonstrated";
  } else {
    const metricLower = 1 - bound.upperRate;
    const enough = t.sampledCount >= requiredSampleSize(target, alpha);
    if (metricLower >= target && enough) evidence = "target_demonstrated";
    else if (pilot || !enough) evidence = "exploratory";
    else evidence = "target_not_demonstrated";
  }
  return {
    metricUpper,
    metric: {
      name,
      target,
      pointEstimate,
      bound,
      conditional: {
        pointEstimate: conditionalPoint,
        coverageRate,
        assessed: t.assessedCount,
        sampled: t.sampledCount,
        mayBeOptimistic: t.unassessableCount > 0,
      },
      evidence,
      cells: t.cells,
    },
  };
}

export interface RecallResult {
  readonly name: "withholdingRecall";
  readonly target: number;
  readonly conservativeLower: number | undefined;
  readonly refusal?: string;
  readonly components: {
    readonly nR: number;
    readonly nW: number;
    readonly uFnR?: number;
    readonly upperNonNegW?: number;
    readonly lTnW?: number;
  };
  /** Descriptive only: count-weighted estimated true negatives and missed negatives. */
  readonly pointEstimate: number | undefined;
  readonly conditional: {
    readonly pointEstimate: number | undefined;
    readonly coverageRate: number;
    readonly mayBeOptimistic: boolean;
  };
  readonly evidence: EvidenceLabel;
}

function recallMetric(
  resolved: ReadonlyMap<string, EvalPair>,
  withheld: ReadonlyMap<string, EvalPair>,
  decisions: readonly Decision[],
  target: number,
  pilot: boolean,
  alpha: number,
): RecallResult {
  // In R, a withholding verdict is a negative the resolver hid; insufficient_evidence is the
  // worst-case version of the same miss.
  const rTally = tally(
    resolved,
    decisions,
    (d) => isWithholdingVerdict(d.blindVerdict) || d.blindVerdict === "insufficient_evidence",
  );
  // In W, a resolution is a non-negative withhold; insufficient_evidence is the worst case too.
  const wTally = tally(
    withheld,
    decisions,
    (d) => d.blindVerdict === "resolve" || d.blindVerdict === "insufficient_evidence",
  );
  const nR = rTally.strata.reduce((s, x) => s + x.population, 0);
  const nW = wTally.strata.reduce((s, x) => s + x.population, 0);
  // Componentwise bounds at alpha/2, so the ratio's conservative interval holds at alpha.
  const uFn = upperCountBound(rTally, alpha / 2);
  const uNonNeg = upperCountBound(wTally, alpha / 2);

  let conservativeLower: number | undefined;
  let refusal: string | undefined;
  let uFnR: number | undefined;
  let upperNonNegW: number | undefined;
  let lTnW: number | undefined;
  if (uFn.count === undefined || uNonNeg.count === undefined) {
    refusal = `bound not available: ${uFn.reason ?? uNonNeg.reason ?? "component unavailable"}`;
  } else {
    uFnR = uFn.count;
    upperNonNegW = uNonNeg.count;
    lTnW = Math.max(0, nW - upperNonNegW);
    const denom = lTnW + uFnR;
    conservativeLower = denom === 0 ? 0 : lTnW / denom;
  }

  const assessedR = rTally.assessedCount;
  const assessedW = wTally.assessedCount;
  // Estimated COUNTS, expanded by N_h/n_h — never a ratio of unweighted sample counts.
  // In W, `errors` is already "resolve or insufficient_evidence", so sampled - errors is the
  // true-negative count. Subtracting unassessable again would count those units twice.
  const tnWHat = expandCount(wTally.cells, (c) => c.sampled - c.errors);
  const fnRHat = expandCount(rTally.cells, (c) => c.errors);
  const pointEstimate =
    tnWHat === undefined || fnRHat === undefined || tnWHat + fnRHat === 0
      ? undefined
      : tnWHat / (tnWHat + fnRHat);
  // Conditional view excludes insufficient_evidence from the negative count in R as well; its
  // per-cell count is already stored by tally(), so no global subtraction is needed.
  const fnRHatConditional = expandCount(rTally.cells, (c) => c.errors - c.unassessable);
  const conditionalPoint =
    tnWHat === undefined || fnRHatConditional === undefined || tnWHat + fnRHatConditional === 0
      ? undefined
      : tnWHat / (tnWHat + fnRHatConditional);
  const conditional: RecallResult["conditional"] = {
    pointEstimate: conditionalPoint,
    coverageRate:
      rTally.sampledCount + wTally.sampledCount === 0
        ? 0
        : (assessedR + assessedW) / (rTally.sampledCount + wTally.sampledCount),
    mayBeOptimistic: rTally.unassessableCount + wTally.unassessableCount > 0,
  };
  const evidence: EvidenceLabel =
    conservativeLower !== undefined && conservativeLower >= target
      ? pilot
        ? "exploratory"
        : "target_demonstrated"
      : "target_not_demonstrated";

  return {
    name: "withholdingRecall",
    target,
    conservativeLower,
    ...(refusal !== undefined ? { refusal } : {}),
    components: {
      nR,
      nW,
      ...(uFnR !== undefined ? { uFnR } : {}),
      ...(upperNonNegW !== undefined ? { upperNonNegW } : {}),
      ...(lTnW !== undefined ? { lTnW } : {}),
    },
    pointEstimate,
    conditional,
    evidence,
  };
}

export interface MetricsContext {
  readonly cells: readonly {
    readonly stratum: string;
    readonly population: number;
    readonly drawn: number;
  }[];
  readonly emptyCells: readonly string[];
  readonly unsampledCells: readonly string[];
  readonly coveredFraction: number;
  readonly exclusions: readonly { readonly reason: string; readonly count: number }[];
  readonly concentration: readonly { readonly sourceClusterId: string; readonly units: number }[];
  readonly topShare: number;
}

/**
 * Derive the report's design/coverage figures for exactly the examples the metrics used, not for
 * the whole manifest. Otherwise a historical-only report could print coverage and concentration
 * that include fixture or adversarial rows.
 */
export function metricsContextFor(
  manifest: SamplingManifest,
  selectedExamples: readonly Example[],
): MetricsContext {
  const selectedIds = new Set(selectedExamples.map((e) => e.exampleId));
  const byCell = new Map<string, Example[]>();
  for (const e of selectedExamples) byCell.set(e.stratum, [...(byCell.get(e.stratum) ?? []), e]);
  const cells = manifest.cells.flatMap((c) => {
    const group = byCell.get(c.stratum) ?? [];
    if (group.length === 0) return [];
    return [
      {
        stratum: c.stratum,
        population: group.length,
        drawn: c.sampledExampleIds.filter((id) => selectedIds.has(id)).length,
      },
    ];
  });
  const covered = cells.filter((c) => c.drawn > 0).reduce((sum, c) => sum + c.population, 0);
  const possible: string[] = [];
  for (const language of LANGUAGES)
    for (const family of FAMILIES)
      for (const resolverStatus of RESOLVER_STATUSES)
        possible.push(stratumKey({ language, family, resolverStatus }));
  const concentration = sourceConcentration(selectedExamples);
  return {
    cells,
    emptyCells: possible.filter((k) => !byCell.has(k)),
    unsampledCells: cells.filter((c) => c.drawn === 0).map((c) => c.stratum),
    coveredFraction: selectedExamples.length === 0 ? 0 : covered / selectedExamples.length,
    exclusions: manifest.exclusions,
    concentration: concentration.rows,
    topShare: concentration.topShare,
  };
}

export interface MetricsInput {
  readonly examples: readonly Example[];
  readonly predictions: readonly Prediction[];
  readonly decisions: readonly Decision[];
  readonly suggestions?: readonly Suggestion[];
  /** Ids actually drawn by the sampler, from the manifest. Verified when supplied. */
  readonly sampledExampleIds?: readonly string[];
  readonly frameId: string;
  readonly seed: string;
  readonly cutoff: string;
  readonly snapshotHash: string;
  readonly resolverVersion: string;
  readonly manifestHash: string;
  readonly pilot: boolean;
  /** Only these origins are eligible. Defaults to historical; fixtures never enter silently. */
  readonly origins?: readonly Origin[];
  readonly alpha?: number;
  readonly allowMixedProtocol?: boolean;
  readonly context?: MetricsContext;
}

export interface MetricsResult {
  readonly precision: {
    readonly resolution: MetricResult;
    readonly withholding: MetricResult;
  };
  readonly recall: RecallResult;
  readonly diagnostics: {
    readonly blindVsFinalChangeRate: number;
    readonly aiAgreementRate: number;
    readonly protocolVersions: readonly string[];
    readonly decided: number;
    readonly unassessable: number;
  };
}

/** A refusal at the top level means metrics were not computed at all. */
export function computeMetrics(input: MetricsInput): MetricsResult {
  const alpha = input.alpha ?? ALPHA;
  if (!(alpha > 0 && alpha < 1)) throw new RangeError(`alpha must lie in (0, 1), got ${alpha}`);
  const origins = input.origins ?? (["historical"] as const);
  for (const origin of origins) {
    if (!ORIGINS.includes(origin)) throw new RangeError(`unknown origin: ${origin}`);
  }
  // Fixtures and adversarial items must never be pooled into historical quality figures by
  // accident. Filtering here also drops their decisions before any bound is computed.
  const examples = input.examples.filter((e) => origins.includes(e.origin));
  if (examples.length === 0) {
    throw new Error(`no examples for origins ${origins.join(", ")}; refusing an empty report`);
  }
  const eligible = new Set(examples.map((e) => e.exampleId));
  const predictions = input.predictions.filter((p) => eligible.has(p.exampleId));
  const decisions = input.decisions.filter((d) => eligible.has(d.exampleId));

  let protocolVersions: string[];
  try {
    checkDecisionSet(decisions, {
      allowMixedProtocol: input.allowMixedProtocol === true,
    });
    protocolVersions = [...new Set(decisions.map((d) => d.protocolVersion))].sort();
  } catch (e) {
    throw new Error(`bound not available: ${(e as Error).message}`);
  }
  if (input.sampledExampleIds !== undefined) {
    const drawn = new Set(input.sampledExampleIds);
    const unexpected = decisions.filter((d) => !drawn.has(d.exampleId));
    if (unexpected.length > 0) {
      throw new Error("bound not available: decisions include examples outside the seeded sample");
    }
  }

  const resolved = subpopulation(examples, predictions, "resolved");
  const withheld = subpopulation(examples, predictions, "withheld");
  const resolution = precisionMetric(
    "resolutionPrecision",
    resolved,
    decisions,
    TARGETS.resolutionPrecision,
    input.pilot,
    alpha,
  ).metric;
  const withholding = precisionMetric(
    "withholdingPrecision",
    withheld,
    decisions,
    TARGETS.withholdingPrecision,
    input.pilot,
    alpha,
  ).metric;
  const recall = recallMetric(
    resolved,
    withheld,
    decisions,
    TARGETS.withholdingRecall,
    input.pilot,
    alpha,
  );
  const unassessable = decisions.filter((d) => d.blindVerdict === "insufficient_evidence").length;
  return {
    precision: { resolution, withholding },
    recall,
    diagnostics: {
      blindVsFinalChangeRate: blindVsFinalChangeRate(decisions),
      aiAgreementRate: aiAgreementRate(decisions, input.suggestions ?? []),
      protocolVersions,
      decided: decisions.length,
      unassessable,
    },
  };
}

/** `allocateProportional` is re-exported for expansion-after-G3 allocation by weight x error. */
export { allocateProportional };

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const mdCell = (s: string) => s.replace(/\|/g, "\\|");

/** Deterministic markdown. No point estimate is ever printed without its bound and label. */
export function renderMetricsReport(input: MetricsInput, result: MetricsResult): string {
  const { precision, recall, diagnostics } = result;
  const alpha = input.alpha ?? ALPHA;
  const lines: string[] = [];
  lines.push("# Semantic evaluation metrics (Phase 3.2 / S5)", "");
  lines.push(
    "> Exploratory evidence on a frozen frame only. A pilot never approves a target. These figures do not establish quality for future reports, languages, sources or attributes.",
    "",
  );
  lines.push(
    `- Frame \`${input.frameId}\`, cutoff \`${input.cutoff}\`, seed \`${input.seed}\``,
    `- Snapshot hash \`${input.snapshotHash}\`, resolver version ${input.resolverVersion}, manifest hash \`${input.manifestHash}\``,
    `- ${input.pilot ? "Pilot (exploratory)" : "Full evaluation"}; origins ${(input.origins ?? ["historical"]).join(", ")}; protocol versions ${diagnostics.protocolVersions.join(", ") || "none"}`,
    `- Decisions ${diagnostics.decided}; insufficient_evidence ${diagnostics.unassessable}`,
    "",
  );

  lines.push("## Primary metrics (blind verdict only, worst-case sensitivity)", "");
  lines.push(
    "The primary safety view: every sampled `insufficient_evidence` is counted AGAINST the resolver. The original human decision is never rewritten in any data file.",
    "",
  );
  for (const m of [precision.resolution, precision.withholding]) {
    lines.push(`### ${m.name} — target ${pct(m.target)}`, "");
    lines.push(
      `- Point estimate (worst-case, expanded by N_h/n_h): ${m.pointEstimate === undefined ? "not available (uncovered stratum)" : pct(m.pointEstimate)}`,
      `- ${m.bound.available ? `Exact finite-population bound: error count ≤ ${m.bound.upperCount}, error rate ≤ ${pct(m.bound.upperRate ?? 0)}` : `**bound not available**: ${m.bound.reason?.replace(/^bound not available: /, "")}`}`,
      `- Evidence label: **${m.evidence}**`,
      `- Conditional performance (descriptive, NO bound): ${pct(m.conditional.pointEstimate)} over ${m.conditional.assessed}/${m.conditional.sampled} assessable; coverage ${pct(m.conditional.coverageRate)}${m.conditional.mayBeOptimistic ? "; the conditional figure may be optimistic because hard cases tend to land in insufficient_evidence" : ""}`,
      "",
    );
    lines.push("| Cell | N_h | n_h | worst errors |", "|---|---:|---:|---:|");
    for (const c of m.cells) {
      lines.push(`| ${mdCell(c.cell)} | ${c.population} | ${c.sampled} | ${c.errors} |`);
    }
    lines.push("");
  }

  lines.push("### withholdingRecall — target " + pct(recall.target), "");
  lines.push(
    recall.conservativeLower === undefined
      ? `- **bound not available**: ${(recall.refusal ?? "component unavailable").replace(/^bound not available: /, "")}`
      : `- Conservative lower bound: **${pct(recall.conservativeLower)}**; Recall_lower = L_TN,W / (L_TN,W + U_FN,R)`,
    `- Components: N_R ${recall.components.nR}, N_W ${recall.components.nW}, U_FN,R ${recall.components.uFnR ?? "n/a"}, upper non-negatives in W ${recall.components.upperNonNegW ?? "n/a"}, L_TN,W ${recall.components.lTnW ?? "n/a"}`,
    `- Point estimate (count-weighted, no bound): ${recall.pointEstimate === undefined ? "not available (uncovered stratum)" : pct(recall.pointEstimate)}`,
    `- Conditional performance (descriptive, NO bound): ${recall.conditional.pointEstimate === undefined ? "not available (uncovered stratum)" : pct(recall.conditional.pointEstimate)}; coverage ${pct(recall.conditional.coverageRate)}${recall.conditional.mayBeOptimistic ? "; may be optimistic" : ""}`,
    `- Evidence label: **${recall.evidence}**`,
    "",
  );
  lines.push(
    "No required sample size is stated for Withholding Recall: the two-population estimator's behaviour is derived in §F but its n requirement is left unasserted until measured. The realised bound and what it would take are printed here instead of a guessed number.",
    "",
  );

  lines.push("## Sample-size reality (simple zero-error cases only)", "");
  const confidence = `${((1 - alpha) * 100).toFixed(0)}%`;
  const zeroErrorSizes =
    `For an all-assessable ratio, 0 errors in n gives a ${confidence} one-sided error bound of ` +
    `1 - ${alpha}^(1/n): n ≥ ${requiredSampleSize(0.99, alpha)} for a 1% bound (Resolution Precision) ` +
    `and n ≥ ${requiredSampleSize(0.95, alpha)} for a 5% bound (Withholding Precision). ` +
    "These are NOT the sizes needed for the worst-case sensitivity analysis above: each " +
    "unassessable unit counts as an error there, so the usable n shrinks with the unassessable share." +
    (alpha === ALPHA ? " With 24 sampled and 0 errors the bound is still about 11.7%." : "");
  lines.push(zeroErrorSizes, "");

  lines.push("## Diagnostics (never evidence)", "");
  lines.push(
    `- Blind-vs-final change rate: ${pct(diagnostics.blindVsFinalChangeRate)}`,
    `- AI-agreement rate (blind human vs suggestion): ${pct(diagnostics.aiAgreementRate)}`,
    "- `finalVerdict` and `revisedAfterReveal` are diagnostics only; post-reveal revisions can never replace the blind label as evidence.",
    "",
  );

  lines.push("## Design, coverage and provenance", "");
  lines.push(
    "- Tier 1 (unit/adversarial safety fixtures) remains a 100% hard blocker, reported by S0.",
    `- Weights are applied to counts (N_h x share), never to a ratio of ratios.`,
  );
  const ctx = input.context;
  if (ctx) {
    lines.push(
      `- ${ctx.cells.length} non-empty cells; ${ctx.emptyCells.length} empty; ${ctx.unsampledCells.length} unsampled non-empty; covered fraction of population ${pct(ctx.coveredFraction)}`,
      `- Exclusions: ${ctx.exclusions.length === 0 ? "none" : ctx.exclusions.map((e) => `${e.reason} ${e.count}`).join("; ")}`,
      `- Source-cluster concentration (transparency only, not a design-effect correction): top ${ctx.concentration.length} clusters ${pct(ctx.topShare)}`,
    );
  }
  lines.push(
    `- Exact bounds are refused when a non-empty cell has no draw, the sample is not a seeded SRS within cells, the search is incomplete, or protocol versions are mixed.`,
    "",
  );
  return lines.join("\n");
}

/** Canonical JSON of a metric result, for hash-stamping a report manifest. */
export function metricsDigest(result: MetricsResult): string {
  return canonicalJson({
    precision: result.precision,
    recall: result.recall,
    diagnostics: result.diagnostics,
  });
}
