import type { Candidate, Drone, Extraction } from "@/entities/drone/types";
import type { IntelExtractor } from "@/shared/contracts/ai";
import { normalizeExtraction } from "@/entities/normalization/apply";
import { mentionsPhonetic } from "@/entities/drone/name-key";
import {
  checkFixture,
  comparableSpecs,
  evaluateHeuristic,
  stratifiedSample,
  type EvalFixture,
  type Prf,
} from "./evaluation";

/**
 * In-process rule sandbox. READ-ONLY INVARIANT, same as evaluateHeuristic: it only calls
 * extract() on the two extractors it is given and reads fixtures/candidates/catalog. The caller
 * builds `baseline` (active rules) and `proposed` (active rules + the candidate rule); the
 * sandbox decides whether the difference is safe to activate.
 *
 * Fast mode checks every fixture whose text contains one of the rule's terms plus a fixed
 * control set of unrelated fixtures; a rule made of literal terms cannot change the output for
 * a text that contains none of them, so the control set only guards against surprises (aliases
 * also match across scripts). Full mode checks everything.
 */
export interface SandboxInput {
  /** Approved and pending_fix fixtures (git + DB). */
  fixtures: readonly EvalFixture[];
  candidates: readonly Candidate[];
  catalog: Drone[];
  baseline: IntelExtractor;
  proposed: IntelExtractor;
  /** Lower-cased literal terms of the rule (ruleTerms()). */
  terms: readonly string[];
  mode?: "fast" | "full";
  controlSize?: number;
  /** Cap on affected candidates scored for F1. */
  maxAffected?: number;
  seed?: number;
}

export interface FixtureBreak {
  id: string;
  source: string;
  failures: string[];
}

export interface ImpactPreview {
  candidateId: string;
  source: string;
  before: string[];
  after: string[];
}

export interface SandboxScores {
  spec: Prf;
  name: Prf;
  matchId: Prf;
}

export interface SandboxResult {
  passed: boolean;
  reasons: string[];
  mode: "fast" | "full";
  corpusSize: number;
  regressions: FixtureBreak[];
  /** Fixtures (typically pending_fix) failing before and passing with the rule. */
  fixed: string[];
  affectedCandidates: number;
  changedCandidates: number;
  before: SandboxScores;
  after: SandboxScores;
  /** Largest F1 change across spec, name and matchId. */
  f1Delta: number;
  preview: ImpactPreview[];
}

/**
 * The same extractor, reading each text at most once per catalog. extract() is pure for a given
 * rule snapshot, and the sandbox reads the same text several times: an affected candidate for
 * the preview and again for scoring, and - across a supervision run - every audit compares
 * against the same all-active extractor. Callers get a copy, so nothing they do to a result
 * reaches the cache. Only plain calls are cached; one with context or options goes through.
 */
export function memoExtractor(x: IntelExtractor): IntelExtractor {
  if (memoized.has(x)) return x;
  const byCatalog = new WeakMap<Drone[], Map<string, Promise<Extraction>>>();
  const memo: IntelExtractor = {
    tier: x.tier,
    label: x.label,
    extract(raw, catalog, context, options) {
      if (context || options) return x.extract(raw, catalog, context, options);
      let cache = byCatalog.get(catalog);
      if (!cache) byCatalog.set(catalog, (cache = new Map()));
      let hit = cache.get(raw);
      if (!hit) {
        hit = x.extract(raw, catalog);
        cache.set(raw, hit);
        // A failed read is not remembered, so a retry reads again.
        hit.catch(() => cache.delete(raw));
      }
      return hit.then((e) => structuredClone(e));
    },
  };
  memoized.add(memo);
  return memo;
}
const memoized = new WeakSet<IntelExtractor>();

const EPS = 1e-9;
const fold = (s: string) => s.toLowerCase();
/**
 * Could a rule with these terms change this text's reading? Literal containment, or the term in
 * another script, romanisation, spacing or case ending ("Ланцетом" for an alias "Lancet",
 * "high  rise" for a cue "high rise") - the engine matches names that way, so a fixture the
 * targeted gate skips must be one the rule cannot reach. Over-selecting only costs a read.
 */
const mentionsAny = (text: string, terms: readonly string[]) => {
  const t = fold(text);
  return terms.some((x) => t.includes(x) || mentionsPhonetic(text, x));
};

/** Every failing expectation, as stable strings, so before/after can be set-diffed. */
async function failures(fx: EvalFixture, x: IntelExtractor, catalog: Drone[]) {
  const r = await checkFixture(fx, x, catalog);
  return new Set([
    ...r.missing.map((e) => `missing ${e.semantic}=${e.value}${e.unit ?? ""}`),
    ...r.forbidden.map((e) => `forbidden ${e.semantic}=${e.value ?? "*"}${e.unit ?? ""}`),
    ...r.missingNames.map((n) => `missing name ${n}`),
  ]);
}

/** Deterministic pick of `n` items by a cheap string hash, so the control set is repeatable. */
function controlPick<T>(items: readonly T[], idOf: (t: T) => string, n: number, seed: number) {
  const h = (s: string) => {
    let v = seed >>> 0 || 1;
    for (let i = 0; i < s.length; i++) v = Math.imul(v ^ s.charCodeAt(i), 16777619) >>> 0;
    return v;
  };
  return [...items].sort((a, b) => h(idOf(a)) - h(idOf(b))).slice(0, n);
}

const summarize = (e: Extraction) => [
  ...comparableSpecs(e).map(
    (s) => `${s.semantic}=${s.canonical ?? s.value}${s.canonicalUnit ?? ""}`,
  ),
  // Names as written, not phonetic keys: the preview is for an analyst to read.
  ...new Set(
    [e.name, ...(e.systems ?? []).map((s) => s.name)].filter(Boolean).map((n) => `name:${n}`),
  ),
];

export async function runSandbox(input: SandboxInput): Promise<SandboxResult> {
  const mode = input.mode ?? "fast";
  const seed = input.seed ?? 1;
  const controlSize = input.controlSize ?? 100;
  const { catalog, terms } = input;
  const baseline = memoExtractor(input.baseline);
  const proposed = memoExtractor(input.proposed);

  // 1. Regression gate over the corpus.
  const touched = input.fixtures.filter((f) => mentionsAny(f.text, terms));
  const others = input.fixtures.filter((f) => !mentionsAny(f.text, terms));
  const fixtures =
    mode === "full"
      ? input.fixtures
      : [...touched, ...controlPick(others, (f) => f.id, controlSize, seed)];
  const regressions: FixtureBreak[] = [];
  const fixed: string[] = [];
  for (const fx of fixtures) {
    const before = await failures(fx, baseline, catalog);
    const after = await failures(fx, proposed, catalog);
    const broke = [...after].filter((f) => !before.has(f));
    if (broke.length) regressions.push({ id: fx.id, source: fx.source, failures: broke });
    else if (before.size > 0 && after.size === 0) fixed.push(fx.id);
  }

  // 2. Effect on live candidates: every affected one plus a stratified control sample.
  const eligible = input.candidates.filter(
    (c) => (c.raw?.trim().length ?? 0) >= 50 && c.status !== "discarded",
  );
  const affected = eligible
    .filter((c) => mentionsAny(c.raw, terms))
    .slice(0, input.maxAffected ?? 300);
  const affectedIds = new Set(affected.map((c) => c.id));
  const control = stratifiedSample(
    eligible.filter((c) => !affectedIds.has(c.id)),
    mode === "full" ? 200 : 50,
    seed,
  );
  const scored = [...affected, ...control];

  const preview: ImpactPreview[] = [];
  let changed = 0;
  for (const c of affected) {
    const b = summarize(normalizeExtraction(await baseline.extract(c.raw, catalog)).extraction);
    const a = summarize(normalizeExtraction(await proposed.extract(c.raw, catalog)).extraction);
    const removed = b.filter((x) => !a.includes(x));
    const added = a.filter((x) => !b.includes(x));
    if (!removed.length && !added.length) continue;
    changed++;
    if (preview.length < 10)
      preview.push({ candidateId: c.id, source: c.source, before: removed, after: added });
  }

  const opts = { sampleSize: scored.length, seed, includeDiscarded: false, maxMismatchesPerKey: 0 };
  const rb = await evaluateHeuristic(scored, catalog, baseline, opts);
  const ra = await evaluateHeuristic(scored, catalog, proposed, opts);
  const before = { spec: rb.summary, name: rb.identity.name, matchId: rb.identity.matchId };
  const after = { spec: ra.summary, name: ra.identity.name, matchId: ra.identity.matchId };
  const deltas = (["spec", "name", "matchId"] as const).map((k) => after[k].f1 - before[k].f1);

  // 3. Hard invariants (EVALUATION_FULL_AUTOMATION §3, pelare 3).
  const reasons: string[] = [];
  if (regressions.length) reasons.push(`${regressions.length} fixture(s) regress`);
  (["spec", "name", "matchId"] as const).forEach((k, i) => {
    if (deltas[i]! < -EPS) reasons.push(`${k} F1 drops ${deltas[i]!.toFixed(4)}`);
  });
  // Strict dominance also counts: removing false positives where nothing was confirmed leaves
  // F1 at 0 on both sides, yet is exactly what a context filter is for.
  const dominates = (["spec", "name", "matchId"] as const).some((k) => {
    const b = before[k];
    const a = after[k];
    return a.tp >= b.tp && a.fp <= b.fp && a.fn <= b.fn && a.tp + b.fp + b.fn > b.tp + a.fp + a.fn;
  });
  const improves = deltas.some((d) => d > EPS) || dominates || fixed.length > 0;
  if (!improves) reasons.push(changed ? "no measurable improvement" : "rule changes no output");

  return {
    passed: reasons.length === 0,
    reasons,
    mode,
    corpusSize: fixtures.length,
    regressions,
    fixed,
    affectedCandidates: affected.length,
    changedCandidates: changed,
    before,
    after,
    f1Delta: deltas.reduce((m, d) => (Math.abs(d) > Math.abs(m) ? d : m), 0),
    preview,
  };
}
