/**
 * Modular, multilingual heuristic extractors. Each extractor reads one system class or fact
 * family; the vocabulary for every language lives in @/shared/lexicons, so adding a language
 * touches no extractor. See HEURISTICS.md for the contracts.
 */
import type { AddSpec } from "./extractors/common";
import { SPEC_EXTRACTORS } from "./facts";

export type { AddSpec } from "./extractors/common";
export { extractFacts, SPEC_EXTRACTORS, type Facts } from "./facts";
export { detectNames, mentions, mentionsName, resolveSystems } from "./names";
export {
  extractPrice,
  extractPriceNumeric,
  extractUnitPrice,
  extractContractValue,
} from "./pricing";
export { LEXICONS } from "@/shared/lexicons";

export function extractClassSpecs(raw: string, add: AddSpec) {
  for (const x of SPEC_EXTRACTORS) x(raw, add);
}
