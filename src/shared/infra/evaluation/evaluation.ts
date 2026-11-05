/**
 * Heuristic evaluation mode. READ-ONLY INVARIANT: this module only calls
 * `heuristic.extract()` and reads candidates/catalog. It never writes to any repository
 * and never calls an AI tier. The stored (combined) extraction is the reference — not "truth".
 *
 * This file is a barrel: the evaluation is split by concern into the sibling modules below, and
 * importers keep using this path.
 */

export * from "./evaluation-types";
export * from "./sampling";
export * from "./compare";
export * from "./coverage";
export * from "./reference";
export * from "./reference-fixtures";
export * from "./identity";
export * from "./posts";
export * from "./evaluate";
export * from "./fixture-check";
