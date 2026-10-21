import { parseNumber } from "@/entities/normalization/numeric";
import { cue } from "@/shared/lexicons";
import { getRe } from "../regex-cache";

/** Records one spec claim; duplicates are dropped by the caller's sink. */
export type AddSpec = (
  key: string,
  label: string,
  value: number | string,
  unit: string | undefined,
  evidence: string,
) => void;

export const NUMBER = String.raw`\d(?:[\d., ]*\d)?`;
/** Units must end at a word edge: "м" must not match the start of "метров"-less words. */
export const END = String.raw`(?![\p{L}])`;

/**
 * Counter-drone envelope cues; a vehicle's own range/altitude must not swallow these. Shared
 * by uav and usv: both classes' own figures sit behind the same notAfter guard.
 */
export const ENVELOPE = new RegExp(
  [
    cue("engagementRange"),
    cue("detectionRange"),
    cue("suppressionRadius"),
    cue("targetAltitude"),
  ].join("|"),
  "iu",
);

export function num(s: string): number {
  return parseNumber(s) ?? Number.NaN;
}

/**
 * Cue, up to `gap` non-digit characters, a number, then one of the unit alternatives. Each entry
 * in `units` is [regex fragment, canonical unit]; the first that matches the captured unit wins.
 *
 * `order: "before"` (default) matches cue→number→unit ("max takeoff weight 300 kg").
 * `order: "after"` matches number→unit→cue ("300 kg warhead").
 *
 * Newlines are excluded from the gap window (`[^\d\n]`), so a cue and its measurement must sit
 * on the same line. This is an intentional policy decision, not an accidental artifact.
 *
 * After-forms additionally clamp at sentence boundaries (`.` and `;`). The old inline reversed
 * patterns used `[^.;\n]`: letting an after-form walk past a period lets it steal the value of a
 * different spec — "12 m wide. Length otherwise unknown." read as length 12 m. Verified live
 * before the clamp was restored, so pinning tests stay honest about the contract.
 */
export function measureCue(
  raw: string,
  add: AddSpec,
  opts: {
    cue: string;
    units: Array<[string, string]>;
    key: string;
    label: string;
    gap?: number;
    /** Reject a match when the text right before it contains this (e.g. a C-UAS cue). */
    notAfter?: RegExp;
    /** "before" = cue→number→unit (default); "after" = number→unit→cue. */
    order?: "before" | "after";
  },
) {
  const { gap = 24, order = "before" } = opts;
  const unitAlt = opts.units.map(([u]) => u).join("|");
  const re =
    order === "after"
      ? getRe(`(${NUMBER})\\s*(${unitAlt})${END}[^.;\\d\\n]{0,${gap}}(?:${opts.cue})`, "giu")
      : getRe(`(?:${opts.cue})[^\\d\\n]{0,${gap}}(${NUMBER})\\s*(${unitAlt})${END}`, "giu");
  for (const m of raw.matchAll(re)) {
    if (opts.notAfter) {
      const before = raw.slice(Math.max(0, m.index! - 24), m.index! + m[0].indexOf(m[1]!));
      if (opts.notAfter.test(before)) continue;
    }
    const value = num(m[1]!);
    if (!Number.isFinite(value)) continue;
    const u = opts.units.find(([frag]) => getRe(`^(?:${frag})$`, "iu").test(m[2]!));
    if (u) add(opts.key, opts.label, value, u[1], m[0]);
  }
}

/**
 * Count nouns like "4 jammers", "2 cameras", "6 missiles" with a left-boundary guard so a
 * designation's number (e.g. "UAV-300") is not read as a quantity. The lookbehind rejects a digit
 * that follows a letter, digit or hyphen.
 *
 * A spaced thousands group is one number ("3 000 missiles" is three thousand, not three
 * hundred), so the group is captured whole and read with the same parser the rest of the
 * catalogue uses.
 */
export function extractCountedNouns(
  raw: string,
  add: AddSpec,
  nouns: string[],
  /** Optional side effects per match (e.g. pushing to sensors/payloads arrays). */
  onMatch?: (noun: string, quantity: number, evidence: string) => void,
) {
  const nounAlt = nouns.join("|");
  // String.raw: in a plain template literal \p and \d lose their backslashes, which would
  // leave the lookbehind matching the letters p, L and N instead of any letter or digit.
  const re = getRe(String.raw`(?<![-\p{L}\p{N}])(\d+(?:[ \u00a0]\d{3})*)\s+(${nounAlt})`, "giu");
  for (const m of raw.matchAll(re)) {
    // Attack tallies ("launched 167 missiles overnight") are not system specs.
    const before = raw.slice(Math.max(0, m.index! - 40), m.index!);
    if (
      /\b(?:launch|launched|attack|attacked|struck|overnight|fired|procure|procured|plans)\b/i.test(
        before,
      )
    )
      continue;
    const noun = m[2]!.toLowerCase().replace(/s$/, "");
    const qty = parseNumber(m[1]!);
    if (qty === undefined) continue;
    add(`${noun}s`, `Number of ${noun}s`, qty, undefined, m[0]);
    onMatch?.(noun, qty, m[0]);
  }
}
