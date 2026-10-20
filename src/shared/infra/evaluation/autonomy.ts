import type { Candidate, Drone, Extraction } from "@/entities/drone/types";
import type { IntelExtractor } from "@/shared/contracts/ai";
import { normalizeExtraction } from "@/entities/normalization/apply";
import { compareSpecs, comparableSpecs, namesOf } from "./evaluation";
import type { SandboxResult } from "./sandbox";

/**
 * Phase 3 policy: shadow scoring, trust calibration, auto-promotion and the circuit breaker.
 * READ-ONLY and pure like the rest of the slice; the server owns state and the clock.
 * (EVALUATION_FULL_AUTOMATION §3.5 and §4.)
 */

export interface ShadowMetrics {
  /** New candidates the shadow rule has been run against. */
  evaluated: number;
  /** Candidates where the rule changed the output. */
  hits: number;
  /** Hits that agreed better with the AI-judged reference than the active rules did. */
  concordant: number;
  /** Hits that agreed worse. */
  conflicts: number;
  startedAt: string;
  /** createdAt of the newest candidate already scored; only later ones count. */
  watermark: string;
}

export const newShadowMetrics = (now: string): ShadowMetrics => ({
  evaluated: 0,
  hits: 0,
  concordant: 0,
  conflicts: 0,
  startedAt: now,
  watermark: now,
});

/**
 * How well one extraction agrees with the stored, AI-judged one: confirmed claims and names
 * minus unconfirmed ones. Only the difference between two runs on the same text is meaningful.
 */
export function agreementScore(heur: Extraction, ref: Extraction): number {
  const cmp = compareSpecs(comparableSpecs(heur), comparableSpecs(ref));
  const specs =
    cmp.pairs.length - cmp.falsePositives.length - cmp.rejected.length - cmp.wrongKeys.length;
  const refNames = new Set(namesOf(ref));
  const names = namesOf(heur).reduce((n, x) => n + (refNames.has(x) ? 1 : -1), 0);
  return specs + names;
}

/**
 * Score a shadow rule on candidates it has not seen. `candidates` may be in any order; only
 * those created after the watermark count, oldest first, at most `max` per step, so a large
 * backlog drains over several runs.
 */
export async function shadowStep(
  metrics: ShadowMetrics,
  candidates: readonly Candidate[],
  catalog: Drone[],
  active: IntelExtractor,
  shadow: IntelExtractor,
  max = 200,
): Promise<ShadowMetrics> {
  const fresh = candidates
    .filter(
      (c) =>
        c.createdAt > metrics.watermark &&
        (c.raw?.trim().length ?? 0) >= 50 &&
        c.status !== "discarded",
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, max);
  const next = { ...metrics };
  for (const c of fresh) {
    const a = normalizeExtraction(await active.extract(c.raw, catalog)).extraction;
    const s = normalizeExtraction(await shadow.extract(c.raw, catalog)).extraction;
    next.evaluated++;
    next.watermark = c.createdAt;
    const before = agreementScore(a, c.extraction);
    const after = agreementScore(s, c.extraction);
    const changed =
      before !== after ||
      JSON.stringify(comparableSpecs(a).map((x) => [x.key, x.value])) !==
        JSON.stringify(comparableSpecs(s).map((x) => [x.key, x.value])) ||
      namesOf(a).join() !== namesOf(s).join();
    if (!changed) continue;
    next.hits++;
    if (after > before) next.concordant++;
    else if (after < before) next.conflicts++;
  }
  return next;
}

export type DecisionKind = "shadowed" | "activated" | "auto_activated" | "rejected" | "quarantined";
export type DecisionActor = "analyst" | "autonomous" | "circuit_breaker" | "sandbox";

export interface RuleDecision {
  category: string;
  origin: string;
  decision: DecisionKind;
  actor: DecisionActor;
}

/** Trust is earned per category: one rule kind aimed at one key ("add_cue:range"). */
export const ruleCategory = (kind: string, targetKey: string | null | undefined) =>
  `${kind}:${targetKey ?? "*"}`;

export interface Trust {
  score: number;
  decisions: number;
}

/**
 * How often an analyst agreed with the generator, per category. Only human verdicts on
 * generated rules count as evidence - an auto-activation vouching for itself would let trust
 * grow without anyone looking - but a quarantine counts against the category whoever trips it.
 */
export function trustScores(decisions: readonly RuleDecision[]): Record<string, Trust> {
  const tally = new Map<string, { pos: number; neg: number }>();
  for (const d of decisions) {
    if (d.origin !== "autonomous_sandbox") continue;
    const t = tally.get(d.category) ?? { pos: 0, neg: 0 };
    if (d.actor === "analyst" && d.decision === "activated") t.pos++;
    else if (d.actor === "analyst" && d.decision === "rejected") t.neg++;
    else if (d.decision === "quarantined") t.neg++;
    else continue;
    tally.set(d.category, t);
  }
  const out: Record<string, Trust> = {};
  for (const [k, t] of tally) out[k] = { score: t.pos / (t.pos + t.neg), decisions: t.pos + t.neg };
  return out;
}

export const PROMOTION_POLICY = {
  minShadowHours: 48,
  minHits: 5,
  minPrecision: 0.95,
  minTrust: 0.95,
  minDecisions: 20,
  maxAutoPerDay: 2,
} as const;

export interface PromotionInput {
  origin: string;
  metrics: ShadowMetrics;
  trust: Trust | undefined;
  autoActivatedLast24h: number;
  now: Date;
}

/**
 * Whether a shadow rule may go live without a click. Every condition must hold; the reasons
 * list says which ones do not, so the UI can show how far a rule is from promotion. A fresh
 * sandbox pass is still required at activation time - this verdict never activates by itself.
 */
export function promotionVerdict(
  p: PromotionInput,
  policy = PROMOTION_POLICY,
): { promote: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const m = p.metrics;
  if (p.origin !== "autonomous_sandbox") reasons.push("analyst rules are activated by hand");
  const hours = (p.now.getTime() - Date.parse(m.startedAt)) / 3_600_000;
  if (!(hours >= policy.minShadowHours))
    reasons.push(`shadow ${Math.max(0, hours).toFixed(0)}/${policy.minShadowHours} h`);
  if (m.hits < policy.minHits) reasons.push(`hits ${m.hits}/${policy.minHits}`);
  if (m.conflicts > 0) reasons.push(`${m.conflicts} conflict(s) in shadow`);
  const decided = m.concordant + m.conflicts;
  const precision = decided ? m.concordant / decided : 0;
  if (precision < policy.minPrecision)
    reasons.push(
      `shadow precision ${(precision * 100).toFixed(0)}% < ${policy.minPrecision * 100}%`,
    );
  const t = p.trust;
  if (!t || t.decisions < policy.minDecisions)
    reasons.push(`trust: ${t?.decisions ?? 0}/${policy.minDecisions} analyst decisions`);
  else if (t.score < policy.minTrust)
    reasons.push(`trust ${(t.score * 100).toFixed(0)}% < ${policy.minTrust * 100}%`);
  if (p.autoActivatedLast24h >= policy.maxAutoPerDay)
    reasons.push(`daily cap ${policy.maxAutoPerDay} auto-activations reached`);
  return { promote: reasons.length === 0, reasons };
}

/** Tolerance before recently activated rules are blamed (EVALUATION_FULL_AUTOMATION §4). */
export const BREAKER_F1_DROP = 0.02;

/**
 * Circuit breaker verdict for "all active rules" vs "active minus the last day's": unlike a
 * day-over-day F1 diff, both runs see the same fresh sample, so data drift cannot trip it and a
 * bad rule cannot hide behind an easier day.
 */
export function breakerTrips(r: SandboxResult): { trips: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (r.regressions.length) reasons.push(`${r.regressions.length} fixture(s) regress`);
  for (const k of ["spec", "name", "matchId"] as const) {
    const d = r.after[k].f1 - r.before[k].f1;
    if (d < -BREAKER_F1_DROP) reasons.push(`${k} F1 ${d.toFixed(3)}`);
  }
  return { trips: reasons.length > 0, reasons };
}
