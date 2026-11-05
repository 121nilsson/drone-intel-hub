/**
 * Browser-storage-backed repositories, re-exported from ./local/ where each concern lives:
 * - cached-repository: the write-through cache, store attach, reload and the revision conflict loop
 * - storage-problems / write-queue: storage-error reporting and per-document write ordering
 * - dispatch-index: the near-duplicate and canonical-URL indexes behind dedupe
 * - one file per repository (drone, candidate, source, dispatch, taxonomy, taxonomy candidate,
 *   procurement)
 * This file only re-exports so existing importers keep their path.
 */
export * from "./local/drone-repository";
export * from "./local/candidate-repository";
export * from "./local/source-repository";
export * from "./local/dispatch-repository";
export * from "./local/taxonomy-repository";
export * from "./local/taxonomy-candidate-repository";
export * from "./local/procurement-repository";
