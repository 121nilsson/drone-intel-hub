import { normalizeQuantity } from "@/entities/normalization/units";
import type { SpecAttribute, SpecClaim } from "./types";

export interface Consensus {
  display: string;
  min?: number;
  max?: number;
  median?: number;
  /** (max − min) / median across point values. Bounds are not part of this ratio. */
  spreadPct?: number;
  /** Indexes of point claims that sit at least 60% away from the median. */
  outliers?: number[];
  sources: number;
  /** Sources materially disagree - the display shows the observed range. */
  disputed: boolean;
  confidence: "high" | "medium" | "low";
}

interface Point {
  value: number;
  unit?: string;
  claimIndex: number;
}

interface Bound {
  min?: number;
  max?: number;
  unit?: string;
}

function measurement(spec: SpecAttribute, claim: SpecClaim, claimIndex: number): Point | Bound | undefined {
  const parsed = claim.normalized;
  if (parsed) {
    const qual = parsed.range?.qualifier ?? "exact";
    if ((qual === "exact" || qual === "approximate") && parsed.canonicalValue !== undefined) {
      return { value: parsed.canonicalValue, ...(parsed.canonicalUnit ? { unit: parsed.canonicalUnit } : {}), claimIndex };
    }
    if (parsed.range && (parsed.range.min !== undefined || parsed.range.max !== undefined)) {
      return {
        ...(parsed.range.min !== undefined ? { min: parsed.range.min } : {}),
        ...(parsed.range.max !== undefined ? { max: parsed.range.max } : {}),
        ...(parsed.canonicalUnit ? { unit: parsed.canonicalUnit } : {}),
      };
    }
  }
  if (typeof claim.value !== "number") return undefined;
  if (spec.unit) {
    const converted = normalizeQuantity(`${claim.value} ${spec.unit}`);
    if (converted?.canonicalValue !== undefined) {
      return {
        value: converted.canonicalValue,
        ...(converted.canonicalUnit ? { unit: converted.canonicalUnit } : {}),
        claimIndex,
      };
    }
  }
  return { value: claim.value, ...(spec.unit ? { unit: spec.unit } : {}), claimIndex };
}

function isPoint(m: Point | Bound): m is Point {
  return "value" in m;
}

/** Trim float noise (2000.0000000000002) without hiding meaningful precision (2.35). */
function round(n: number) {
  return Number.isInteger(n) ? n : Number(n.toFixed(2));
}

export function consensus(spec: SpecAttribute): Consensus {
  const sources = new Set(spec.claims.map((c) => c.source)).size;
  const measured = spec.claims.flatMap((claim, i) => {
    const m = measurement(spec, claim, i);
    return m ? [m] : [];
  });
  const points = measured.filter(isPoint).sort((a, b) => a.value - b.value);
  const bounds = measured.filter((m): m is Bound => !isPoint(m));

  if (points.length === 0 && bounds.length === 0) {
    const counts = new Map<string, number>();
    spec.claims.forEach((c) => counts.set(String(c.value), (counts.get(String(c.value)) ?? 0) + 1));
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const agree = top ? top[1] / spec.claims.length : 0;
    return {
      display: top?.[0] ?? "—",
      sources,
      disputed: agree < 0.6 && spec.claims.length > 1,
      confidence: sources >= 3 && agree > 0.6 ? "high" : sources >= 2 ? "medium" : "low",
    };
  }

  if (points.length === 0) {
    const mins = bounds.flatMap((b) => (b.min !== undefined ? [b.min] : []));
    const maxs = bounds.flatMap((b) => (b.max !== undefined ? [b.max] : []));
    const unit = bounds.find((b) => b.unit)?.unit;
    const suffix = unit ? ` ${unit}` : "";
    const min = mins.length ? Math.min(...mins) : undefined;
    const max = maxs.length ? Math.max(...maxs) : undefined;
    const display =
      min !== undefined && max !== undefined
        ? `${round(min)}–${round(max)}${suffix}`
        : max !== undefined
          ? `≤${round(max)}${suffix}`
          : min !== undefined
            ? `≥${round(min)}${suffix}`
            : "—";
    return { display, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), sources, disputed: false, confidence: "low" };
  }

  const nums = points.map((p) => p.value);
  const minPoint = nums[0]!;
  const maxPoint = nums[nums.length - 1]!;
  const median = nums[Math.floor(nums.length / 2)]!;
  const spread = median ? (maxPoint - minPoint) / median : 0;
  const envelopeMin = Math.min(minPoint, ...bounds.flatMap((b) => (b.min !== undefined ? [b.min] : [])));
  const envelopeMax = Math.max(maxPoint, ...bounds.flatMap((b) => (b.max !== undefined ? [b.max] : [])));
  const confidence =
    sources >= 3 && spread < 0.25 ? "high" : sources >= 2 && spread < 0.6 ? "medium" : "low";
  const unit = points.find((p) => p.unit)?.unit ?? spec.unit;
  const u = unit ? ` ${unit}` : "";
  const disputed = spread >= 0.6 && sources >= 2;
  const outliers = points.filter((p) => median !== 0 && Math.abs(p.value - median) / Math.abs(median) >= 0.6).map((p) => p.claimIndex);
  return {
    display: disputed ? `${round(envelopeMin)}–${round(envelopeMax)}${u}` : `${round(median)}${u}`,
    min: envelopeMin,
    max: envelopeMax,
    median,
    spreadPct: spread,
    ...(outliers.length ? { outliers } : {}),
    sources,
    disputed,
    confidence,
  };
}
