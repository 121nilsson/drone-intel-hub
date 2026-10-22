/**
 * Backward-compatible barrel over the split pipeline modules.
 *
 * `runTwoTier`, `promote`, `mergeInto`, `recordMention`, `notASystemName`,
 * `learnedNegativeKeys`, `LEARNED_NEGATIVE_REPEATS` and the `Pipeline*`
 * types are all re-exported here so existing imports keep working. The
 * behaviour is unchanged; only the file layout was refactored:
 *
 * - `pipeline-types.ts`    — PipelineDeps, AnalysisContext, PipelineTrace, PipelineResult
 * - `pipeline-internal.ts` — pure helpers (collisionKey, annotate, applyNormalization, …)
 * - `pipeline-triage.ts`   — gates & learned negatives (notASystemName, collidesWithCatalog, …)
 * - `pipeline-slice.ts`    — multi-system slicing (extractionForSystem, applyRelatedSystems)
 * - `pipeline-actions.ts`  — mutating actions (promote, mergeInto, recordMention)
 * - `pipeline-run.ts`      — runTwoTier orchestration
 *
 * Prefer importing from this barrel; internal modules are implementation detail.
 */
export type {
  PipelineDeps,
  AnalysisContext,
  PipelineTrace,
  PipelineResult,
} from "./pipeline-types";
export { runTwoTier } from "./pipeline-run";
export { promote, mergeInto, recordMention } from "./pipeline-actions";
export { notASystemName, learnedNegativeKeys, LEARNED_NEGATIVE_REPEATS } from "./pipeline-triage";
