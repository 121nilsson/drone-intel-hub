/**
 * What kind of speed an attribute is, for the person judging a speed claim. The post's words decide
 * it (speed-check.ts): "up to", "max" or "top" make a top speed, and only the word "cruise" makes a
 * cruise speed, so the reader is told which words to look for.
 */

/** The label for a speed attribute's semantic; undefined for any other attribute. */
export function speedNatureLabel(semantic: string): string | undefined {
  switch (semantic) {
    case "speed.cruise":
      return "Cruise speed";
    case "speed.max":
      return "Top speed";
    case "speed.dive":
      return "Dive speed";
    default:
      return undefined;
  }
}

/** The reading guide shown beside a speed question. Kept in step with speed-check.ts by a test. */
export const SPEED_NATURE_HINT =
  "“Up to”, “max” or “top” in the post means a top speed. A cruise speed needs the word “cruise”.";
