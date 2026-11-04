import { clauseAround, figureDigits } from "./target-check";

/**
 * Whether a figure filed as an altitude is one. "Hit targets up to 2,000 km (1,240 miles) away"
 * and "can strike targets up to 80 km" are how far a strike drone reaches; filed as maximum target
 * altitude they pass every other check - the quote is in the post, the unit is a length, the
 * sentence names the system - because nothing else asks which length the figure is.
 *
 * Read in the words beside the figure, within its own clause, and quiet unless they speak: a
 * height word passes; a distance word after the figure or a ground-attack verb before it, with no
 * height word, fails; neither says nothing. An interceptor "engages targets at altitudes up
 * to 25 km" passes on "altitudes", so the verbs only decide where the clause names no height.
 */

/** Height words, English, Ukrainian and Russian stems; matched at a word start. */
const ALTITUDE =
  /(?<!\p{L})(?:altitudes?|high|height|ceiling|elevation|above|vertical|висот|высот|стел|потол|вгору|вверх)/iu;

/** The figure is a distance: "away", "from the front line", "at a distance", "на відстані". */
const DISTANCE =
  /(?<!\p{L})(?:away|distant|distance|downrange|from (?:the )?(?:front|border|launch|coast|line)|beyond the|deep (?:into|behind)|inland|відстан|расстоян|вглиб|углиб|від лінії|от линии)/iu;

/** Ground attack: what a strike drone does to a target at a range, not at a height. */
const STRIKE =
  /(?<!\p{L})(?:strike|strikes|striking|hit|hits|hitting|bomb|shell|уража|вража|удар)/iu;

/** "Flies at 35,000 feet", "cruising at 6 km": the figure right after is the flight's height. */
const FLIGHT_LEVEL =
  /(?<!\p{L})(?:fl(?:y|ies|ying|own)|cruis\w*|operat\w*|летит|летить|літа\w*) at\s*$/iu;

/** How far either side of the figure its own words are read. */
const NEAR = 32;

export type AltitudeVerdict =
  | { applicable: false }
  | { applicable: true; verdict: "pass" | "fail"; detail: string; clause: string };

/** `semantic` is the attribute's (altitude.max, altitude.target_max, …); `passage` its sentence. */
export function altitudeVerdict(semantic: string, value: string, passage: string): AltitudeVerdict {
  if (!semantic.startsWith("altitude")) return { applicable: false };
  const digits = figureDigits(value);
  if (!digits) return { applicable: false };
  const at = passage.search(new RegExp(`(?<![\\d.,])${digits.replace(/[.,]/g, "[.,]")}(?![\\d])`));
  if (at < 0) return { applicable: false };
  const clause = clauseAround(passage, at, digits.length).trim();
  // Read beside the figure, not across the clause: "detect targets up to 550 km away when the
  // aircraft flies at 35,000 feet" is one clause holding a distance and a height. A distance word
  // follows its figure ("2,000 km (1,240 miles) away"); a strike verb comes before it.
  const before = passage.slice(Math.max(0, at - NEAR), at);
  const after = passage.slice(at + digits.length, at + digits.length + NEAR);
  if (ALTITUDE.test(before + after) || FLIGHT_LEVEL.test(before))
    return { applicable: true, verdict: "pass", detail: "the figure is a height", clause };
  if (DISTANCE.test(after) || STRIKE.test(before))
    return {
      applicable: true,
      verdict: "fail",
      detail: "the figure's clause is a distance to a target, not a height",
      clause,
    };
  return { applicable: false };
}
