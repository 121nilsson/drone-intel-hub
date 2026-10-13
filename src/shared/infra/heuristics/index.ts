/**
 * Modular, multilingual heuristic extractors. Each extractor reads one system class; the
 * vocabulary for every language lives in ./lexicons so adding a language touches no extractor.
 */
import type { AddSpec } from "./extractors/common";
import { extractCuas } from "./extractors/cuas";
import { extractShorad } from "./extractors/shorad";
import { extractUav } from "./extractors/uav";
import { extractUgv } from "./extractors/ugv";

export type { AddSpec } from "./extractors/common";
export { extractPrice, extractUnitPrice, extractContractValue } from "./pricing";
export { LEXICONS } from "./lexicons";

export const SPEC_EXTRACTORS: Array<(raw: string, add: AddSpec) => void> = [
  extractUav,
  extractUgv,
  extractCuas,
  extractShorad,
];

export function extractClassSpecs(raw: string, add: AddSpec) {
  for (const x of SPEC_EXTRACTORS) x(raw, add);
}
