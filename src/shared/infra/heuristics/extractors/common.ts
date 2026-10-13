import { parseNumber } from "@/entities/normalization/numeric";

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

export function num(s: string): number {
  return parseNumber(s) ?? Number.NaN;
}

/**
 * Cue, up to `gap` non-digit characters, a number, then one of the unit alternatives. Each entry
 * in `units` is [regex fragment, canonical unit]; the first that matches the captured unit wins.
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
  },
) {
  const unitAlt = opts.units.map(([u]) => u).join("|");
  const re = new RegExp(
    `(?:${opts.cue})[^\\d\\n]{0,${opts.gap ?? 24}}(${NUMBER})\\s*(${unitAlt})${END}`,
    "giu",
  );
  for (const m of raw.matchAll(re)) {
    if (opts.notAfter) {
      const before = raw.slice(Math.max(0, m.index! - 24), m.index! + m[0].indexOf(m[1]!));
      if (opts.notAfter.test(before)) continue;
    }
    const value = num(m[1]!);
    if (!Number.isFinite(value)) continue;
    const u = opts.units.find(([frag]) => new RegExp(`^(?:${frag})$`, "iu").test(m[2]!));
    if (u) add(opts.key, opts.label, value, u[1], m[0]);
  }
}
