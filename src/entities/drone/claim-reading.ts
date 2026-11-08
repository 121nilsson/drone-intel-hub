import { qualifierBeforeFigure, type QuantityQualifier } from "@/entities/normalization/numeric";
import { normalizeQuantity, rebaseQuantity } from "@/entities/normalization/units";
import { displayScale } from "./consensus";
import type { SpecAttribute, SpecClaim } from "./types";

/**
 * A claim's value as the catalogue reads it, for anyone asked to judge it: the audit page and the
 * second reader. "40" alone cannot be judged - 40 knots and 40 km/h are different claims - so the
 * attribute's unit goes with a bare figure, and when the catalogue converted it, the conversion
 * goes too: "40 kn (≈ 74.08 km/h)". A unit the catalogue misread is then visible to the judge,
 * which a figure shown without its unit would hide.
 */

/** A value that is only a number or a range of numbers, with no unit of its own. */
const bare = (s: string) => /^[\s\d.,–—~≈<>≤≥+-]+$/.test(s);

const round = (n: number) => Number(n.toPrecision(6));

export function claimReading(spec: Pick<SpecAttribute, "unit">, claim: SpecClaim): string {
  const stated = (claim.raw?.trim() || String(claim.value)).trim();
  const q = claim.normalized;
  // The source's own wording when it carries its unit; else the catalogue's reading of it.
  const shown =
    !bare(stated) || !stated
      ? stated
      : q?.unit
        ? `${stated} ${q.unit}`
        : spec.unit
          ? `${stated} ${spec.unit}`
          : stated;
  if (!q?.canonicalUnit || q.canonicalUnit === q.unit) return shown;
  const r = q.range;
  // In the unit the catalogue shows it in: a long duration in hours or days, as summaries do.
  const magnitude = q.canonicalValue ?? r?.max ?? r?.min ?? 0;
  const { factor, suffix } = displayScale(q.canonicalUnit, magnitude);
  const v = (n: number) => round(n / factor);
  // "8 days (≈ 8 d)" says nothing the source did not.
  if (q.canonicalValue !== undefined && factor !== 1 && v(q.canonicalValue) === q.value)
    return shown;
  const canonical =
    q.canonicalValue !== undefined
      ? `${v(q.canonicalValue)}`
      : r?.min !== undefined && r.max !== undefined
        ? `${v(r.min)}–${v(r.max)}`
        : r?.min !== undefined
          ? `≥ ${v(r.min)}`
          : r?.max !== undefined
            ? `≤ ${v(r.max)}`
            : undefined;
  return canonical ? `${shown} (≈ ${canonical}${suffix})` : shown;
}

/** The words a qualifier reads as in English. "exact" and a span say nothing beyond the figure. */
const QUALIFIER_WORD: Partial<Record<QuantityQualifier, string>> = {
  up_to: "up to",
  less_than: "less than",
  at_least: "at least",
  greater_than: "more than",
  approximate: "approx.",
};

/**
 * A claim's value as a single structured reading: the qualifier the post used, the figure and the
 * unit the post used ("up to 500 km", "approx. 46 km/h", "170–180 km/h", "500 km"). Built from
 * `normalized` only, so it says what the catalogue parsed and nothing about the raw clipping that
 * `claimReading` shows. Without a usable figure it is `claimReading` as before.
 */
export function cleanReading(spec: Pick<SpecAttribute, "unit">, claim: SpecClaim): string {
  const stated = (claim.raw?.trim() || String(claim.value)).trim();
  // The word the post put before the figure ("range to at least 1,000", "(approximately 100"),
  // for the claims whose stored reading says "exact" because it never saw that word.
  const written = qualifierBeforeFigure(stated);
  return (
    structuredReading(claim.normalized, written, spec.unit) ??
    // A claim with no stored reading (a value kept as the post's phrase): read the figure and its
    // unit out of the phrase for display only. Nothing is stored and consensus is not told.
    structuredReading(
      normalizeQuantity(stated.slice(Math.max(stated.search(/[0-9]/), 0))),
      written,
      spec.unit,
    ) ??
    claimReading(spec, claim)
  );
}

function structuredReading(
  q: SpecClaim["normalized"] | undefined,
  written: QuantityQualifier | undefined,
  unitFallback: string | undefined,
): string | undefined {
  // `range` holds canonical values while `unit` is the token the post used, so a span must be
  // re-expressed in the post's unit: "20–35 kW" is stored as 20000–35000 W.
  const targetUnit = q?.unit ?? unitFallback;
  const reading =
    q && q.canonicalUnit && targetUnit && q.canonicalUnit !== targetUnit
      ? rebaseQuantity(q, targetUnit)
      : q;
  const r = reading?.range;
  const lo = r?.min;
  const hi = r?.max;
  const point = reading?.value ?? r?.value ?? hi ?? lo;
  let figure: string;
  let word: string | undefined;
  if (lo !== undefined && hi !== undefined) {
    figure = `${round(lo)}–${round(hi)}`;
  } else if (point !== undefined) {
    figure = `${round(point)}`;
    const stored = r?.qualifier && r.qualifier !== "exact" ? r.qualifier : undefined;
    const qualifier = stored ?? written;
    word = qualifier ? QUALIFIER_WORD[qualifier] : undefined;
  } else {
    return undefined;
  }
  const unit = reading?.unit ?? unitFallback;
  return [word, figure, unit].filter(Boolean).join(" ");
}
