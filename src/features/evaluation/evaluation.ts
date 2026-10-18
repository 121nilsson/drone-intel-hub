import type { Candidate, Drone, ExtractedSpec, Extraction } from "@/entities/drone/types";
import type { IntelExtractor } from "@/shared/contracts/ai";
import { normalizeExtraction } from "@/entities/normalization/apply";
import { semanticKeyFor } from "@/entities/normalization/semantic";
import { phoneticKey } from "@/entities/drone/name-key";
import { isFinancialSpecKey } from "@/features/intake/procurement-routing";

/**
 * Heuristic evaluation mode. READ-ONLY INVARIANT: this module only calls
 * `heuristic.extract()` and reads candidates/catalog. It never writes to any repository
 * and never calls an AI tier. The stored (combined) extraction is the reference — not "truth".
 */

export type MatchType =
  "exact" | "semantic" | "raw" | "differentReading" | "wrongKey" | "falsePositive" | "miss";

export interface EvalMismatch {
  candidateId: string;
  source: string;
  text: string;
  specKey: string;
  matchType: MatchType;
  heuristicValue: string | number | null;
  heuristicUnit: string | null;
  referenceValue: string | number | null;
  referenceUnit: string | null;
  evidence: string;
  normalizedHeuristic?: { canonicalValue?: number | undefined; canonicalUnit?: string | undefined };
  normalizedReference?: { canonicalValue?: number | undefined; canonicalUnit?: string | undefined };
}

export interface Prf {
  precision: number;
  recall: number;
  f1: number;
  tp: number;
  fp: number;
  fn: number;
}

export interface EvalReport {
  generatedAt: string;
  sampleSize: number;
  totalItems: number;
  stratification: {
    platform: Record<string, number>;
    outcome: Record<string, number>;
    epoch: Record<string, number>;
  };
  summary: Prf;
  identity: { name: Prf; matchId: Prf };
  perKey: Record<string, Prf>;
  mismatches: EvalMismatch[];
  topIssues: string[];
  /** Agreements usable as regression fixtures. */
  fixtures: EvalFixture[];
}

export interface EvalFixture {
  id: string;
  source: string;
  text: string;
  /** Semantic key + canonical value the heuristic must keep producing. */
  expect: { semantic: string; value: number | string; unit?: string }[];
  /** Specs that must NOT be produced (known bad outputs). */
  forbid?: { semantic: string; value?: number | string; unit?: string }[];
  expectNames?: string[];
  /** Lifecycle status for fixtures. */
  status?: "approved" | "pending" | "pending_fix";
}

export interface EvalOptions {
  sampleSize?: number;
  seed?: number;
  includeDiscarded?: boolean;
  minRawLength?: number;
  maxMismatchesPerKey?: number;
  onProgress?: (done: number, total: number) => void;
}

const MIN_RAW = 50;

export function platformOf(source: string): string {
  const m = /^([a-z]+)[:|]/i.exec(source.trim());
  if (m) {
    const p = (m[1] ?? "").toLowerCase();
    if (p === "tg" || p === "telegram") return "telegram";
    return p;
  }
  if (/https?:\/\//i.test(source)) return "web";
  return "other";
}

const outcomeOf = (c: Candidate) => c.quality?.decision ?? c.status;
const epochOf = (c: Candidate) => c.extraction.metadata?.promptVersion ?? "legacy";

/** Deterministic PRNG so the same seed gives the same sample. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

/** Stratified (by platform × outcome) round-robin sample. */
export function stratifiedSample(cands: Candidate[], n: number, seed = 1): Candidate[] {
  const rand = rng(seed);
  const buckets = new Map<string, Candidate[]>();
  for (const c of cands) {
    const k = `${platformOf(c.source)}|${outcomeOf(c)}`;
    const b = buckets.get(k) ?? [];
    b.push(c);
    buckets.set(k, b);
  }
  for (const b of buckets.values()) {
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = b[i]!;
      b[i] = b[j]!;
      b[j] = t;
    }
  }
  const lists = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, b]) => b);
  const out: Candidate[] = [];
  for (let i = 0; out.length < n; i++) {
    let any = false;
    for (const l of lists) {
      if (i < l.length && out.length < n) {
        out.push(l[i]!);
        any = true;
      }
    }
    if (!any) break;
  }
  return out;
}

export function numbersClose(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.01 * Math.max(Math.abs(a), Math.abs(b)), 1e-6);
}

interface Norm {
  semantic: string;
  key: string;
  value: number | string;
  unit?: string | undefined;
  canonical?: number | undefined;
  canonicalUnit?: string | undefined;
  min?: number | undefined;
  max?: number | undefined;
  evidence: string;
}

function norm(s: ExtractedSpec): Norm {
  const n = s.normalized;
  return {
    semantic: semanticKeyFor(s.key, s.label),
    key: s.key,
    value: s.value,
    unit: s.unit,
    canonical: n?.canonicalValue ?? (typeof s.value === "number" ? s.value : undefined),
    canonicalUnit: n?.canonicalUnit ?? s.unit,
    min: n?.range?.min,
    max: n?.range?.max,
    evidence: s.evidence ?? s.raw ?? "",
  };
}

function sameValue(a: Norm, b: Norm): "exact" | "differentReading" | "raw" | null {
  if (a.canonical !== undefined && b.canonical !== undefined) {
    if (
      numbersClose(a.canonical, b.canonical) &&
      (a.canonicalUnit ?? "") === (b.canonicalUnit ?? "")
    )
      return "exact";
  }
  const aBound = a.max ?? a.min;
  const bBound = b.max ?? b.min;
  const aPoint = a.canonical ?? aBound;
  const bPoint = b.canonical ?? bBound;
  if (
    (a.max !== undefined || b.max !== undefined || a.min !== undefined || b.min !== undefined) &&
    aPoint !== undefined &&
    bPoint !== undefined &&
    numbersClose(aPoint, bPoint)
  )
    return "differentReading";
  if (
    String(a.value).trim().toLowerCase() === String(b.value).trim().toLowerCase() &&
    (a.unit ?? "") === (b.unit ?? "")
  )
    return "raw";
  return null;
}

/** Usable specs only: financial/procurement keys are routed out of drone specs, so ignore them. */
export function comparableSpecs(e: Extraction): Norm[] {
  return e.specs.filter((s) => !isFinancialSpecKey(s.key)).map(norm);
}

export interface SpecComparison {
  pairs: { h: Norm; r: Norm; type: MatchType }[];
  falsePositives: Norm[];
  misses: Norm[];
  wrongKeys: { h: Norm; r: Norm }[];
}

/** Greedy one-to-one pairing: same semantic first, then same value under another key. */
export function compareSpecs(heur: Norm[], ref: Norm[]): SpecComparison {
  const usedR = new Set<number>();
  const usedH = new Set<number>();
  const pairs: SpecComparison["pairs"] = [];
  const wrongKeys: SpecComparison["wrongKeys"] = [];
  heur.forEach((h, hi) => {
    const ri = ref.findIndex(
      (r, i) => !usedR.has(i) && r.semantic === h.semantic && sameValue(h, r),
    );
    const r = ref[ri];
    if (ri < 0 || !r) return;
    const t = sameValue(h, r)!;
    pairs.push({ h, r, type: t === "exact" ? (h.key === r.key ? "exact" : "semantic") : t });
    usedR.add(ri);
    usedH.add(hi);
  });
  heur.forEach((h, hi) => {
    if (usedH.has(hi)) return;
    const ri = ref.findIndex(
      (r, i) => !usedR.has(i) && r.semantic !== h.semantic && sameValue(h, r) === "exact",
    );
    const r = ref[ri];
    if (ri < 0 || !r) return;
    wrongKeys.push({ h, r });
    usedR.add(ri);
    usedH.add(hi);
  });
  return {
    pairs,
    wrongKeys,
    falsePositives: heur.filter((_, i) => !usedH.has(i)),
    misses: ref.filter((_, i) => !usedR.has(i)),
  };
}

function prf(tp: number, fp: number, fn: number): Prf {
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1, tp, fp, fn };
}

const namesOf = (e: Extraction) => [
  ...new Set(
    [e.name, ...(e.systems ?? []).map((s) => s.name)]
      .filter((n): n is string => !!n?.trim())
      .map(phoneticKey),
  ),
];
const matchIdsOf = (e: Extraction) => [
  ...new Set(
    [e.matchId, ...(e.systems ?? []).map((s) => s.matchId)].filter((x): x is string => !!x),
  ),
];

function setCounts(h: string[], r: string[]) {
  const rs = new Set(r);
  const tp = h.filter((x) => rs.has(x)).length;
  return { tp, fp: h.length - tp, fn: r.length - tp };
}

export async function evaluateHeuristic(
  candidates: readonly Candidate[],
  catalog: Drone[],
  heuristic: IntelExtractor,
  opts: EvalOptions = {},
): Promise<EvalReport> {
  const sampleSize = opts.sampleSize ?? 100;
  const minRaw = opts.minRawLength ?? MIN_RAW;
  const cap = opts.maxMismatchesPerKey ?? 5;
  const eligible = candidates.filter(
    (c) =>
      (c.raw?.trim().length ?? 0) >= minRaw && (opts.includeDiscarded || c.status !== "discarded"),
  );
  const sample = stratifiedSample(eligible, sampleSize, opts.seed ?? 1);

  const strat: EvalReport["stratification"] = { platform: {}, outcome: {}, epoch: {} };
  const keyCounts = new Map<string, { tp: number; fp: number; fn: number }>();
  const bump = (k: string, f: "tp" | "fp" | "fn") => {
    const c = keyCounts.get(k) ?? { tp: 0, fp: 0, fn: 0 };
    c[f]++;
    keyCounts.set(k, c);
  };
  const id = { name: { tp: 0, fp: 0, fn: 0 }, matchId: { tp: 0, fp: 0, fn: 0 } };
  const mismatches: EvalMismatch[] = [];
  const perKeyMis = new Map<string, number>();
  const fixtures: EvalFixture[] = [];

  // Count how many reference (AI) specs share the same semantic+canonical value, for
  // the corroboration trust-filter (>=2 candidates).
  const refCounts = new Map<string, number>();
  for (const c of eligible) {
    for (const s of comparableSpecs(c.extraction)) {
      const key = `${s.semantic}|${s.canonical ?? s.value}|${s.canonicalUnit ?? s.unit ?? ""}`;
      refCounts.set(key, (refCounts.get(key) ?? 0) + 1);
    }
  }

  const pushMis = (c: Candidate, type: MatchType, h: Norm | null, r: Norm | null) => {
    const key = (h ?? r)!.semantic;
    const n = perKeyMis.get(`${key}|${type}`) ?? 0;
    if (n >= cap) return;
    perKeyMis.set(`${key}|${type}`, n + 1);
    mismatches.push({
      candidateId: c.id,
      source: c.source,
      text: c.raw,
      specKey: key,
      matchType: type,
      heuristicValue: h?.value ?? null,
      heuristicUnit: h?.unit ?? null,
      referenceValue: r?.value ?? null,
      referenceUnit: r?.unit ?? null,
      evidence: (h?.evidence || r?.evidence || "").slice(0, 280),
      ...(h
        ? { normalizedHeuristic: { canonicalValue: h.canonical, canonicalUnit: h.canonicalUnit } }
        : {}),
      ...(r
        ? { normalizedReference: { canonicalValue: r.canonical, canonicalUnit: r.canonicalUnit } }
        : {}),
    });
  };

  const total = sample.length;
  for (let i = 0; i < sample.length; i++) {
    const c = sample[i]!;
    // Yield to the event loop so the UI can paint progress and stay responsive.
    await new Promise((resolve) => setTimeout(resolve, 0));
    opts.onProgress?.(i + 1, total);
    const inc = (rec: Record<string, number>, k: string) => (rec[k] = (rec[k] ?? 0) + 1);
    inc(strat.platform, platformOf(c.source));
    inc(strat.outcome, outcomeOf(c));
    inc(strat.epoch, epochOf(c));

    let heur: Extraction;
    try {
      heur = normalizeExtraction(await heuristic.extract(c.raw, catalog)).extraction;
    } catch {
      continue;
    }
    const cmp = compareSpecs(comparableSpecs(heur), comparableSpecs(c.extraction));
    for (const p of cmp.pairs) {
      bump(p.h.semantic, "tp");
      if (p.type === "differentReading") pushMis(c, "differentReading", p.h, p.r);
    }
    for (const w of cmp.wrongKeys) {
      bump(w.h.semantic, "fp");
      bump(w.r.semantic, "fn");
      pushMis(c, "wrongKey", w.h, w.r);
    }
    for (const h of cmp.falsePositives) {
      bump(h.semantic, "fp");
      pushMis(c, "falsePositive", h, null);
    }
    for (const r of cmp.misses) {
      bump(r.semantic, "fn");
      pushMis(c, "miss", null, r);
    }

    const hn = namesOf(heur);
    const rn = namesOf(c.extraction);
    const nc = setCounts(hn, rn);
    id.name.tp += nc.tp;
    id.name.fp += nc.fp;
    id.name.fn += nc.fn;
    const mc = setCounts(matchIdsOf(heur), matchIdsOf(c.extraction));
    id.matchId.tp += mc.tp;
    id.matchId.fp += mc.fp;
    id.matchId.fn += mc.fn;

    const agreed = cmp.pairs.filter((p) => p.type === "exact" || p.type === "semantic");
    if (agreed.length) {
      // Trust filter: evidence must occur in raw, raw > 50 chars, candidate not discarded,
      // and at least one agreed spec must be corroborated by >=2 candidates.
      const fold = (s: string) => s.replace(/\\s+/g, " ").trim().toLowerCase();
      const rawFolded = fold(c.raw);
      const hasEvidence = agreed.some((p) => {
        const proof = p.h.evidence || "";
        return !proof || rawFolded.includes(fold(String(proof)));
      });
      if (hasEvidence && c.raw.trim().length > 50 && c.status !== "discarded") {
        const refNames = [
          c.extraction.name,
          ...(c.extraction.systems ?? []).map((s) => s.name),
        ].filter(
          (n): n is string => !!n && rn.includes(phoneticKey(n)) && hn.includes(phoneticKey(n)),
        );
        fixtures.push({
          id: c.id,
          source: c.source,
          text: c.raw,
          expect: agreed.map((p) => ({
            semantic: p.h.semantic,
            value: p.h.canonical ?? p.h.value,
            ...(p.h.canonicalUnit ? { unit: p.h.canonicalUnit } : {}),
          })),
          ...(refNames.length ? { expectNames: [...new Set(refNames)] } : {}),
        });
      }
    }
  }

  const perKey: Record<string, Prf> = {};
  let T = 0,
    F = 0,
    N = 0;
  for (const [k, v] of keyCounts) {
    perKey[k] = prf(v.tp, v.fp, v.fn);
    T += v.tp;
    F += v.fp;
    N += v.fn;
  }
  const topIssues = Object.entries(perKey)
    .filter(([, v]) => v.tp + v.fp + v.fn >= 3)
    .sort(([, a], [, b]) => a.f1 - b.f1)
    .slice(0, 5)
    .map(([k, v]) => {
      const kind = v.fp > v.fn ? "mostly false positives" : "mostly misses";
      return `${k}: F1 ${v.f1.toFixed(2)} — ${kind} (fp ${v.fp}, fn ${v.fn})`;
    });

  return {
    generatedAt: new Date().toISOString(),
    sampleSize,
    totalItems: sample.length,
    stratification: strat,
    summary: prf(T, F, N),
    identity: {
      name: prf(id.name.tp, id.name.fp, id.name.fn),
      matchId: prf(id.matchId.tp, id.matchId.fp, id.matchId.fn),
    },
    perKey,
    mismatches,
    topIssues,
    fixtures,
  };
}

/** Checks one fixture against a fresh heuristic run; returns failing expectations. Pure. */
export async function checkFixture(
  fx: EvalFixture,
  heuristic: IntelExtractor,
  catalog: Drone[] = [],
) {
  const heur = normalizeExtraction(await heuristic.extract(fx.text, catalog)).extraction;
  const got = comparableSpecs(heur);
  const missing = fx.expect.filter(
    (e) =>
      !got.some((g) => {
        if (g.semantic !== e.semantic) return false;
        if (typeof e.value === "number")
          return (
            g.canonical !== undefined &&
            numbersClose(g.canonical, e.value) &&
            (g.canonicalUnit ?? "") === (e.unit ?? "")
          );
        return String(g.value).toLowerCase() === String(e.value).toLowerCase();
      }),
  );
  const forbidden = (fx.forbid ?? []).filter((f) =>
    got.some((g) => {
      if (g.semantic !== f.semantic) return false;
      if (f.value === undefined) return true;
      if (typeof f.value === "number")
        return (
          g.canonical !== undefined &&
          numbersClose(g.canonical, f.value) &&
          (g.canonicalUnit ?? "") === (f.unit ?? "")
        );
      return String(g.value).toLowerCase() === String(f.value).toLowerCase();
    }),
  );
  const names = namesOf(heur);
  const missingNames = (fx.expectNames ?? []).filter((n) => !names.includes(phoneticKey(n)));
  return { missing, missingNames, forbidden };
}

/** Build regression fixtures from known bad outputs; replayed to ensure they stay fixed. */
export function mismatchesToFixtures(mismatches: EvalMismatch[], limit = 50): EvalFixture[] {
  const byKey = new Map<string, EvalMismatch>();
  for (const m of mismatches) {
    // Only forbid when the heuristic produced a value the reference did not corroborate.
    // wrongKey (right value, wrong key) is a normalization issue, not a heuristic error.
    if (m.matchType === "falsePositive") {
      const k = `${m.candidateId}|${m.specKey}`;
      if (!byKey.has(k)) byKey.set(k, m);
    }
  }
  return [...byKey.values()].slice(0, limit).map((m) => ({
    id: `neg-${m.candidateId}-${m.specKey}`,
    source: m.source,
    text: m.text,
    expect: [],
    forbid: [
      {
        semantic: m.specKey,
        ...(m.heuristicValue !== null ? { value: m.heuristicValue } : {}),
        ...(m.heuristicUnit ? { unit: m.heuristicUnit } : {}),
      },
    ],
  }));
}

/** JSON corpus for src/test/fixtures/eval-corpus.json (merged by id with an existing one). */
export function fixturesToCorpus(
  fixtures: EvalFixture[],
  existing: EvalFixture[] = [],
  limit = 50,
): EvalFixture[] {
  const byId = new Map(existing.map((f) => [f.id, f]));
  for (const f of fixtures.slice(0, limit)) byId.set(f.id, f);
  return [...byId.values()];
}
