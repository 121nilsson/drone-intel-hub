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
