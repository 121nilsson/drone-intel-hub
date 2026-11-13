/**
 * The human audit of `verified` claims (get_human_out_of_the_loop_plan.md, §9 Phase 2): which
 * claims are drawn, and when the answers settle whether "verified" meets its error budget.
 *
 * Pure. The person answers one question per claim - does the post state this value for this
 * attribute of this system? - and this module only decides what to show and what the answers
 * prove. Nothing here reads or writes the catalogue.
 */

import { readerOpposes } from "./entailment-verdict";
import type { StoredEntailmentVerdict } from "./types";

export type AuditLanguage = "en" | "uk" | "ru" | "other";

/** The order the audit works through languages in, set by the project owner. */
export const AUDIT_LANGUAGE_ORDER: readonly AuditLanguage[] = ["en", "uk", "ru", "other"];

/**
 * The language a post is written in, from its letters. Ukrainian and Russian share most of the
 * Cyrillic alphabet, so the letters only one of them uses decide; a Cyrillic post with neither is
 * counted as Russian, the more common of the two in this archive's undecided posts.
 */
export function textLanguage(text: string): AuditLanguage {
  const cyrillic = (text.match(/\p{Script=Cyrillic}/gu) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (cyrillic === 0 && latin === 0) return "other";
  if (cyrillic > latin) {
    const uk = (text.match(/[іїєґІЇЄҐ]/g) ?? []).length;
    const ru = (text.match(/[ыэъёЫЭЪЁ]/g) ?? []).length;
    return uk > ru ? "uk" : "ru";
  }
  return "en";
}

/** The attribute family a claim is stratified by: "range" for range.max, range.detection, … */
export const attributeFamily = (semantic: string) => semantic.split(".")[0] || semantic;

/** One claim the audit may draw. */
export interface AuditCandidate {
  claimId: string;
  language: AuditLanguage;
  family: string;
}

/** A small seeded generator, so a draw can be repeated from its recorded seed. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Draw `size` claims at random with a recorded seed, languages in the owner's order and, within a
 * language, one family at a time in turn, so a batch is not all ranges because ranges are most of
 * the catalogue. Claims already audited are never drawn again.
 */
export function drawAuditSample(
  candidates: readonly AuditCandidate[],
  size: number,
  seed: number,
  exclude: ReadonlySet<string> = new Set(),
): AuditCandidate[] {
  const random = seededRandom(seed);
  const out: AuditCandidate[] = [];
  for (const language of AUDIT_LANGUAGE_ORDER) {
    const byFamily = new Map<string, AuditCandidate[]>();
    for (const c of shuffle(
      candidates.filter((c) => c.language === language && !exclude.has(c.claimId)),
      random,
    ))
      byFamily.set(c.family, [...(byFamily.get(c.family) ?? []), c]);
    const queues = shuffle([...byFamily.values()], random);
    while (out.length < size && queues.some((q) => q.length)) {
      for (const q of queues) {
        const next = q.shift();
        if (next && out.length < size) out.push(next);
      }
    }
    if (out.length >= size) break;
  }
  return out;
}

/**
 * Where the hidden controls go in a batch: `count` distinct positions in `0..length`, seeded, so a
 * control is not always the first or last claim the auditor sees.
 */
export function controlPositions(length: number, count: number, seed: number): number[] {
  const random = seededRandom(seed ^ 0x5bd1e995);
  const positions = new Set<number>();
  while (positions.size < Math.min(count, length + 1))
    positions.add(Math.floor(random() * (length + 1)));
  return [...positions].sort((a, b) => a - b);
}

/** One hidden control per this many audited claims. */
export const CONTROL_EVERY = 25;

/**
 * The hidden controls of a batch of `size` claims, by kind. An altered control tests whether the
 * figure is read; a misread control (a rejected claim whose sentence names another system) tests
 * the other thing the first sessions showed to be at risk - accepting a statement about a parent or
 * a sibling variant as one about this system. Without a misread control in every batch that habit
 * is not measured at all, so a batch of CONTROL_EVERY or more always carries one.
 */
export function controlMix(size: number): { altered: number; misread: number } {
  return {
    altered: Math.max(1, Math.round(size / CONTROL_EVERY)),
    misread: size >= CONTROL_EVERY ? 1 : 0,
  };
}

/**
 * `items` with `controls` placed among them at seeded positions, so a control is not always the
 * first or last claim the auditor sees. Positions count the claims, not the controls, and are laid
 * from the last back so the claims keep the order they were drawn in.
 */
export function insertControls<T>(items: readonly T[], controls: readonly T[], seed: number): T[] {
  const out = [...items];
  const positions = controlPositions(items.length, controls.length, seed).reverse();
  positions.forEach((p, i) => out.splice(p, 0, controls[i]!));
  return out;
}

/**
 * Whether the second reader contradicts the person: it opposed the claim (contradicted, not
 * found, or the legacy "unsupported") where they said the post states it, or supported it where
 * they said it does not. "Uncertain" contradicts nothing, and a claim the reader has not read has
 * no verdict to compare.
 */
export function readerDisagrees(
  answer: "yes" | "no" | "cannot_tell" | null | undefined,
  reader: StoredEntailmentVerdict | null | undefined,
): boolean {
  return (answer === "yes" && readerOpposes(reader)) || (answer === "no" && reader === "supported");
}

/**
 * How a hidden control is known to be wrong.
 * - altered: a verified claim shown with its figure changed to one the post does not contain. Wrong
 *   by construction, whatever any check says, so a "yes" on it is the auditor's slip.
 * - misread: the first sessions' kind - a claim whose quote's sentence names another system. That
 *   was an inference of the identity check, and the check follows "It" back one sentence only (since
 *   deterministic-14), so it still misses "It builds on…" and a system
 *   named as part of another, so the owner may dispute one; an altered control cannot be disputed.
 */
export type ControlKind = "altered" | "misread";

/**
 * Answers either side of a failed control that are not counted. A slip says the auditor was not
 * reading closely around then - not that every answer in the session is suspect - so it voids the
 * stretch of about CONTROL_EVERY answers it sits in, not the whole batch.
 */
export const CONTROL_WINDOW = Math.floor(CONTROL_EVERY / 2);

export interface ControlledRow {
  id: string;
  batch_id: string;
  position: number;
  role: "audit" | "control" | "negative";
  answer: "yes" | "no" | "cannot_tell" | null;
  control_kind?: ControlKind | null;
  control_disputed_at?: Date | string | null;
}

/** A control answered "yes" that still stands: not disputed, or of a kind that cannot be. */
export const failedControl = (r: ControlledRow) =>
  r.role === "control" &&
  r.answer === "yes" &&
  !(r.control_kind !== "altered" && r.control_disputed_at);

/** Ids of the answers a failed control voids: its batch, within CONTROL_WINDOW positions of it. */
export function voidedByControls(rows: readonly ControlledRow[]): Set<string> {
  const failed = rows.filter(failedControl);
  return new Set(
    rows
      .filter(
        (r) =>
          r.role !== "control" &&
          failed.some(
            (c) => c.batch_id === r.batch_id && Math.abs(c.position - r.position) <= CONTROL_WINDOW,
          ),
      )
      .map((r) => r.id),
  );
}

/** Multipliers an altered control tries, in turn: far enough from the figure to be a clear "no". */
const ALTERATIONS = [3, 4, 5, 6] as const;

const NUMBER_IN_READING = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

/**
 * A claim's reading with every figure scaled by one factor the post contains none of, or undefined
 * when no factor works. Reads only the stated part: the catalogue's "(≈ …)" conversion is dropped,
 * since an altered figure next to its true conversion would give the control away.
 */
export function alteredReading(
  reading: string,
  postFigures: readonly number[],
): string | undefined {
  const stated = reading.replace(/\s*\(≈[^)]*\)\s*$/, "").trim();
  const figures = [...stated.matchAll(NUMBER_IN_READING)].map((m) =>
    Number(m[0].replace(/,/g, "")),
  );
  if (!figures.length || figures.some((n) => !(n > 0))) return undefined;
  for (const factor of ALTERATIONS) {
    const scaled = figures.map((n) => Number((n * factor).toPrecision(6)));
    if (scaled.some((s) => postFigures.some((p) => Math.abs(p - s) < 1e-9 * Math.max(1, s))))
      continue;
    let i = 0;
    return stated.replace(NUMBER_IN_READING, (m) => {
      const s = scaled[i++]!;
      return m.includes(",") ? s.toLocaleString("en-US") : String(s);
    });
  }
  return undefined;
}

/** The budget the audit measures: the low-risk tier (plan §4.5). */
export const AUDIT_BUDGET = 0.05;
/** One-sided confidence of every audit decision. */
export const AUDIT_CONFIDENCE = 0.95;
/** The first draw. Fifty cannot pass: zero errors in 50 still leaves the bound at 5.8%. */
export const AUDIT_FIRST_DRAW = 100;
/** Each later draw. */
export const AUDIT_BATCH = 50;
/** Where the audit stops whether or not it has passed. */
export const AUDIT_MAX = 200;

/** P(X >= k) for X ~ Binomial(n, p), summed exactly in log space so large n cannot underflow. */
export function binomialUpperTail(n: number, k: number, p: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let logC = 0;
  for (let i = 1; i <= k; i++) logC += Math.log(n - k + i) - Math.log(i);
  let sum = 0;
  for (let i = k; i <= n; i++) {
    sum += Math.exp(logC + i * Math.log(p) + (n - i) * Math.log1p(-p));
    logC += Math.log(n - i) - Math.log(i + 1);
  }
  return Math.min(1, sum);
}

/**
 * The one-sided upper confidence bound on the error rate after `errors` in `answered`
 * (Clopper-Pearson): the largest rate under which seeing this few errors is still plausible.
 */
export function errorRateUpperBound(
  answered: number,
  errors: number,
  confidence = AUDIT_CONFIDENCE,
): number {
  if (answered <= 0) return 1;
  if (errors >= answered) return 1;
  const alpha = 1 - confidence;
  let lo = errors / answered;
  let hi = 1;
  // P(X <= errors | p) falls as p rises; find where it crosses alpha.
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (1 - binomialUpperTail(answered, errors + 1, mid) > alpha) lo = mid;
    else hi = mid;
  }
  return hi;
}

export type AuditDecision = "pass" | "fail" | "continue" | "not_proven";

/**
 * What the answers so far prove about verified precision against the budget:
 * - pass: the upper bound on the error rate is within budget;
 * - fail: this many errors would be unlikely if the rate were within budget (proven worse);
 * - continue: neither yet - draw another batch;
 * - not_proven: the audit reached its maximum without passing.
 *
 * Decided only from the first draw on: testing after every answer would raise the chance of a
 * false result with each look. "Cannot tell" answers are excluded before this is called: they are
 * neither errors nor passes.
 */
export function auditDecision(
  answered: number,
  errors: number,
  budget = AUDIT_BUDGET,
  confidence = AUDIT_CONFIDENCE,
): AuditDecision {
  if (answered < AUDIT_FIRST_DRAW) return "continue";
  if (errorRateUpperBound(answered, errors, confidence) <= budget) return "pass";
  if (binomialUpperTail(answered, errors, budget) < 1 - confidence) return "fail";
  return answered >= AUDIT_MAX ? "not_proven" : "continue";
}

/**
 * The audit's decision from its answers in the order they were drawn (true = an error), taken
 * only at the batch boundaries - 100, then every 50 to 200 - over the first that many answers, and
 * fixed at the first boundary that decides. Answers past the last boundary wait for the next one:
 * a status read after every answer must not become a test after every answer.
 */
export function sequentialDecision(
  errorsInDrawOrder: readonly boolean[],
  budget = AUDIT_BUDGET,
  confidence = AUDIT_CONFIDENCE,
): { decision: AuditDecision; decidedAt?: number } {
  for (let at = AUDIT_FIRST_DRAW; at <= AUDIT_MAX; at += AUDIT_BATCH) {
    if (errorsInDrawOrder.length < at) break;
    const errors = errorsInDrawOrder.slice(0, at).filter(Boolean).length;
    const decision = auditDecision(at, errors, budget, confidence);
    if (decision !== "continue") return { decision, decidedAt: at };
  }
  return { decision: "continue" };
}

/** A family whose first 20 audited claims hold two or more errors is flagged on its own. */
export const FAMILY_ALARM = { within: 20, errors: 2 } as const;
