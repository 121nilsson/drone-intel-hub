import { normalizeExtraction } from "@/entities/normalization/apply";
import { phoneticKey } from "@/entities/drone/name-key";
import type { Candidate, Drone, Extraction } from "@/entities/drone/types";
import type { IntelExtractor } from "@/shared/contracts/ai";
import {
  MIN_RAW,
  type EvalFixture,
  type EvalMismatch,
  type EvalOptions,
  type EvalReport,
  type Prf,
} from "./evaluation-types";
import { epochOf, outcomeOf, platformOf, stratifiedSample } from "./sampling";
import {
  addCoverage,
  emptyCoverage,
  finishCoverage,
  type CoverageTally,
  type ReferenceCoverage,
} from "./coverage";
import {
  comparableSpecs,
  compareSpecs,
  type MatchType,
  type Norm,
  type SpecComparison,
} from "./compare";
import { matchIdsOf, namesOf, setCounts } from "./identity";
import { evalPosts, postExtraction, postReferences } from "./posts";
import { verifiedVerdicts } from "./reference";

/**
 * Scores the heuristic against the reference over a stratified sample of posts. Read-only: it
 * only calls heuristic.extract() and reads candidates and the catalogue.
 */

function prf(tp: number, fp: number, fn: number): Prf {
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1, tp, fp, fn };
}

/**
 * A reference figure the heuristic can be scored on: one with a canonical meaning. An attribute
 * no rule understands ("role", "keel", "container dimensions") is never asked of the heuristic,
 * and counting it as a miss buried the figures it does read under ones it never tries to.
 */
const scorable = (r: Norm) => r.semantic.includes(".");

export async function evaluateHeuristic(
  candidates: readonly Candidate[],
  catalog: Drone[],
  heuristic: IntelExtractor,
  opts: EvalOptions = {},
): Promise<EvalReport> {
  const sampleSize = opts.sampleSize ?? 100;
  const minRaw = opts.minRawLength ?? MIN_RAW;
  const cap = opts.maxMismatchesPerKey ?? 5;
  const posts = evalPosts(
    candidates.filter(
      (c) =>
        (c.raw?.trim().length ?? 0) >= minRaw &&
        (opts.includeDiscarded || c.status !== "discarded"),
    ),
  );
  const byPost = new Map(posts.map((p) => [p.post.id, p]));
  const sample = stratifiedSample(
    posts.map((p) => p.post),
    sampleSize,
    opts.seed ?? 1,
  );
  const verdicts = verifiedVerdicts(catalog);

  const strat: EvalReport["stratification"] = { platform: {}, outcome: {}, epoch: {} };
  const keyCounts = new Map<string, { tp: number; fp: number; fn: number }>();
  const bump = (k: string, f: "tp" | "fp" | "fn") => {
    const c = keyCounts.get(k) ?? { tp: 0, fp: 0, fn: 0 };
    c[f]++;
    keyCounts.set(k, c);
  };
  const reference = emptyCoverage();
  const perKeyReference = new Map<string, CoverageTally>();
  const cover = (n: Norm) => {
    addCoverage(reference, n);
    const t = perKeyReference.get(n.semantic) ?? emptyCoverage();
    addCoverage(t, n);
    perKeyReference.set(n.semantic, t);
  };
  const coverComparison = (cmp: SpecComparison) => {
    for (const p of cmp.pairs) cover(p.r);
    for (const w of cmp.wrongKeys) cover(w.r);
    for (const r of cmp.misses) cover(r);
    for (const x of cmp.rejected) cover(x.r);
    for (const x of cmp.excluded) cover(x);
  };
  const id = { name: { tp: 0, fp: 0, fn: 0 }, matchId: { tp: 0, fp: 0, fn: 0 } };
  const mismatches: EvalMismatch[] = [];
  const perKeyMis = new Map<string, number>();
  const fixtures: EvalFixture[] = [];
  let unscoredMisses = 0;

  // Count how many reference (AI) specs share the same semantic+canonical value, for
  // the corroboration trust-filter (>=2 candidates).
  const refCounts = new Map<string, number>();
  // Per post: two systems in one post carrying the same figure are one report saying it.
  for (const p of posts) {
    const keys = new Set(
      p.systems.flatMap((c) =>
        comparableSpecs(c.extraction).map(
          (s) => `${s.semantic}|${s.canonical ?? s.value}|${s.canonicalUnit ?? s.unit ?? ""}`,
        ),
      ),
    );
    for (const key of keys) refCounts.set(key, (refCounts.get(key) ?? 0) + 1);
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
    const post = byPost.get(c.id)!;
    const reference = postExtraction(post);
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
    const cmp = compareSpecs(comparableSpecs(heur), postReferences(post, verdicts));
    coverComparison(cmp);
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
    for (const x of cmp.rejected) {
      bump(x.h.semantic, "fp");
      pushMis(c, "rejected", x.h, x.r);
    }
    for (const r of cmp.misses) {
      if (!scorable(r)) {
        unscoredMisses++;
        continue;
      }
      bump(r.semantic, "fn");
      pushMis(c, "miss", null, r);
    }

    const hn = namesOf(heur);
    const rn = namesOf(reference);
    const nc = setCounts(hn, rn);
    id.name.tp += nc.tp;
    id.name.fp += nc.fp;
    id.name.fn += nc.fn;
    const mc = setCounts(matchIdsOf(heur), matchIdsOf(reference));
    id.matchId.tp += mc.tp;
    id.matchId.fp += mc.fp;
    id.matchId.fn += mc.fn;

    const agreed = cmp.pairs.filter((p) => p.type === "exact" || p.type === "semantic");
    if (agreed.length) {
      // Trust filter: evidence must occur in raw, raw > 50 chars, candidate not discarded,
      // and at least one agreed spec must be corroborated by >=2 candidates.
      const fold = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
      const rawFolded = fold(c.raw);
      const hasEvidence = agreed.some((p) => {
        const proof = p.h.evidence || "";
        return !proof || rawFolded.includes(fold(String(proof)));
      });
      if (hasEvidence && c.raw.trim().length > 50 && c.status !== "discarded") {
        // Enforce corroboration: only keep agreed specs that >=2 candidates confirm, unless the
        // catalogue itself verified the claim - a fact checked against the post needs no second
        // report to become a regression test.
        const corroborated = agreed.filter((p) => {
          if (p.r.verdict === "confirmed" || p.r.verification === "verified") return true;
          const key = `${p.h.semantic}|${p.h.canonical ?? p.h.value}|${p.h.canonicalUnit ?? p.h.unit ?? ""}`;
          return (refCounts.get(key) ?? 0) >= 2;
        });
        if (corroborated.length === 0) continue;
        const refNames = [reference.name, ...(reference.systems ?? []).map((s) => s.name)].filter(
          (n): n is string => !!n && rn.includes(phoneticKey(n)) && hn.includes(phoneticKey(n)),
        );
        fixtures.push({
          id: c.id,
          source: c.source,
          text: c.raw,
          expect: corroborated.map((p) => ({
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

  const perKeyCoverage: Record<string, ReferenceCoverage> = {};
  for (const [k, t] of perKeyReference) perKeyCoverage[k] = finishCoverage(t);

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
    reference: finishCoverage(reference),
    perKeyReference: perKeyCoverage,
    unscoredMisses,
    mismatches,
    topIssues,
    fixtures,
  };
}
