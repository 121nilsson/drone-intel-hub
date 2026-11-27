/**
 * The E2 resolver-language rule as one explicit, total function. It is a lookup, not a coercion:
 * every declared and adjudicated value is named. `detectedLanguage` has no parameter here, so it
 * cannot influence the result.
 *
 *   declared en/ru/uk                                  -> the declared value (adjudication ignored)
 *   declared absent, adjudicated en/ru/uk              -> the adjudicated value
 *   declared absent, adjudicated mixed/unknown/absent  -> undefined (unknown)
 */

import type { AdjudicatedLanguage, E2DeclaredLanguage, E2ResolverLanguage } from "./types";

export function e2ResolverLanguage(
  declared: E2DeclaredLanguage | undefined,
  adjudicated: AdjudicatedLanguage | undefined,
): E2ResolverLanguage | undefined {
  switch (declared) {
    case "en":
      return "en";
    case "ru":
      return "ru";
    case "uk":
      return "uk";
    case undefined:
      break;
  }
  switch (adjudicated) {
    case "en":
      return "en";
    case "ru":
      return "ru";
    case "uk":
      return "uk";
    case "mixed":
    case "unknown":
    case undefined:
      return undefined;
  }
}
