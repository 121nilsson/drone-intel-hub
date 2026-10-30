import { repeatedCandidates } from "@/entities/drone/candidate-repeats";
import type { CandidateRepository, DispatchRepository } from "@/shared/contracts/repository";

/**
 * Removes candidates a later reading of the same post and system has replaced
 * (entities/drone/candidate-repeats.ts). Re-analysis now removes its predecessors itself; this
 * clears the ones written before it did, and any a failed run left behind. A no-op once there are
 * none, so it runs after every sync. `apply: false` reports without removing anything.
 */
export function pruneRepeatedCandidates(
  candidates: CandidateRepository,
  dispatches: Pick<DispatchRepository, "list">,
  opts: { apply?: boolean } = {},
): { removed: number } {
  // What a post lists as its current reading stays, whatever its date says.
  const current = new Set(dispatches.list().flatMap((d) => d.candidateIds ?? []));
  const repeats = repeatedCandidates(candidates.list(), current);
  if (opts.apply !== false) for (const c of repeats) candidates.remove(c.id);
  return { removed: repeats.length };
}
