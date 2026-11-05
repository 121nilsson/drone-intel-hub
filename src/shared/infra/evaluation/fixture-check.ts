import { normalizeExtraction } from "@/entities/normalization/apply";
import { phoneticKey } from "@/entities/drone/name-key";
import type { Drone } from "@/entities/drone/types";
import type { IntelExtractor } from "@/shared/contracts/ai";
import type { EvalFixture, EvalMismatch } from "./evaluation-types";
import { comparableSpecs, numbersClose } from "./compare";
import { namesOf } from "./identity";

/**
 * Replays fixtures against a fresh heuristic run, and turns known bad outputs and agreements into
 * the fixture corpus that eval-corpus.test.ts keeps replaying.
 */

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
