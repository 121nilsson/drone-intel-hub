import { cue } from "@/shared/lexicons";
import { figureDigits } from "./target-check";

/**
 * Whether a figure filed as a cruise or a top speed is that kind of speed. The extraction prompt
 * and the heuristic both say a speed "up to" ("до", "не более") is the top speed and cruise only
 * when the report says cruise; "a speed of up to 500 km/h" filed as cruise speed passed every
 * other check, because nothing asked which speed the figure was.
 *
 * Read beside the figure, like altitude-check.ts, and quiet unless the words speak: a cruise word
 * passes a cruise speed; a top-speed word with no cruise word fails it, and the reverse holds for
 * a top speed. A plain "flies at 150 km/h" says neither and is left alone.
 */

const CRUISE = new RegExp(cue("cruiseSpeed"), "iu");

/** A top speed: "up to", "maximum", "top", "accelerate to" - English, Ukrainian, Russian. */
const TOP =
  /(?<!\p{L})(?:up to|max(?:imum)?|top|peak|dash|до|не (?:более|більше))(?!\p{L})|(?<!\p{L})(?:максимальн|розігна|разогна|розганя|разгоня)/iu;

/** How far either side of the figure its own words are read. */
const NEAR = 32;

export type SpeedVerdict =
  | { applicable: false }
  | { applicable: true; verdict: "pass" | "fail"; detail: string; clause: string };

/** `semantic` is the attribute's (speed.cruise, speed.max, …); `passage` the sentence. */
export function speedVerdict(semantic: string, value: string, passage: string): SpeedVerdict {
  if (semantic !== "speed.cruise" && semantic !== "speed.max") return { applicable: false };
  const digits = figureDigits(value);
  if (!digits) return { applicable: false };
  const at = passage.search(new RegExp(`(?<![\\d.,])${digits.replace(/[.,]/g, "[.,]")}(?![\\d])`));
  if (at < 0) return { applicable: false };
  const near = passage.slice(Math.max(0, at - NEAR), at + digits.length + NEAR);
  const cruise = CRUISE.test(near);
  const top = TOP.test(passage.slice(Math.max(0, at - NEAR), at));
  if (semantic === "speed.cruise") {
    if (cruise)
      return {
        applicable: true,
        verdict: "pass",
        detail: "the figure is a cruise speed",
        clause: near,
      };
    if (top)
      return {
        applicable: true,
        verdict: "fail",
        detail: "the figure's words make it a top speed, not a cruise speed",
        clause: near,
      };
    return { applicable: false };
  }
  if (cruise && !top)
    return {
      applicable: true,
      verdict: "fail",
      detail: "the figure's words make it a cruise speed, not a top speed",
      clause: near,
    };
  if (top)
    return { applicable: true, verdict: "pass", detail: "the figure is a top speed", clause: near };
  return { applicable: false };
}
