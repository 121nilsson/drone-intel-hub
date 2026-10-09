import { ieeeBandsFor, natoBandsFor } from "./bands";
import { parseNumber } from "./numeric";
import { matchTerms, PROTOCOL_TERMS } from "./taxonomy";

export type NormalizedRFRole =
  "uplink" | "downlink" | "video" | "gnss" | "antijam" | "telemetry" | "tether" | "unknown";

export interface NormalizedRFLink {
  raw: string;
  role: NormalizedRFRole;
  freqMHz?: [number, number];
  ieeeBands: string[];
  natoBands: string[];
  protocols?: string[];
  tacticalTag?: string;
  isFiberOptic: boolean;
  confidence: number;
}

const FIBER =
  /fiber[\s-]?optic|fibre[\s-]?optic|\bfocl\b|optical\s+tether|wire[\s-]?guided|wired\s+control|\bfiber\b|\bfibre\b/i;

const NAMED_IEEE: Array<[RegExp, string]> = [
  [/\bku(?:[-\s]?band)?\b/i, "Ku"],
  [/\bka(?:[-\s]?band)?\b/i, "Ka"],
  [/\bk[-\s]band\b/i, "K"],
  [/\bvhf\b/i, "VHF"],
  [/\buhf\b/i, "UHF"],
  [/\bx[-\s]band\b/i, "X"],
  [/\bc[-\s]band\b/i, "C"],
  [/\bs[-\s]band\b/i, "S"],
  [/\bl[-\s]band\b/i, "L"],
];

const ROLES: Array<{ role: NormalizedRFRole; re: RegExp; confidence: number }> = [
  { role: "video", re: /analog\s+video|\bvideo\b|\bfpv\b/i, confidence: 0.95 },
  {
    role: "gnss",
    re: /\bgps\b|glonass|глонасс|\bgalileo\b|\bgnss\b|\bl[125]\b/i,
    confidence: 0.95,
  },
  { role: "antijam", re: /\bcrpa\b|kometa|anti[-\s]?jam/i, confidence: 0.7 },
  { role: "uplink", re: /control\s+link|\bc2\b|\buplink\b|command\s+link/i, confidence: 0.9 },
  { role: "downlink", re: /\bdownlink\b/i, confidence: 0.9 },
  { role: "telemetry", re: /\btelemetry\b/i, confidence: 0.9 },
];

function toMHz(n: number, unit: string): number | undefined {
  switch (unit.toLowerCase()) {
    case "hz":
      return n / 1e6;
    case "khz":
      return n / 1_000;
    case "mhz":
      return n;
    case "ghz":
      return n * 1_000;
    default:
      return undefined;
  }
}

/** RF GHz notation treats `5.725` as a decimal, never as a thousands-grouped integer. */
function parseFrequencyNumber(raw: string, unit: string): number | undefined {
  if (unit.toLowerCase() === "ghz" && /^\d+[.,]\d+$/.test(raw)) {
    const value = Number(raw.replace(",", "."));
    return Number.isFinite(value) ? value : undefined;
  }
  return parseNumber(raw);
}

/** Every frequency or frequency span in the text, in MHz. A protocol name contributes nothing. */
export function parseFrequencies(raw: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const re =
    /(\d+(?:[.,]\d+)?)\s*(khz|mhz|ghz)?\s*(?:-|–|—|to)\s*(\d+(?:[.,]\d+)?)\s*(khz|mhz|ghz)|(\d+(?:[.,]\d+)?)\s*(khz|mhz|ghz)/gi;
  for (const m of raw.matchAll(re)) {
    if (m[1] && m[3] && (m[2] || m[4])) {
      const unit = (m[4] ?? m[2])!;
      const a = parseFrequencyNumber(m[1], m[2] ?? unit);
      const b = parseFrequencyNumber(m[3], unit);
      const lo = a === undefined ? undefined : toMHz(a, m[2] ?? unit);
      const hi = b === undefined ? undefined : toMHz(b, unit);
      if (lo === undefined || hi === undefined) continue;
      out.push([Math.min(lo, hi), Math.max(lo, hi)]);
    } else if (m[5] && m[6]) {
      const n = parseFrequencyNumber(m[5], m[6]);
      const mhz = n === undefined ? undefined : toMHz(n, m[6]);
      if (mhz === undefined) continue;
      out.push([mhz, mhz]);
    }
  }
  return out;
}

export function detectProtocols(raw: string): string[] {
  return matchTerms(raw, "protocol", PROTOCOL_TERMS);
}

export function isFiberOptic(raw: string): boolean {
  return FIBER.test(raw);
}

export function inferRole(raw: string): { role: NormalizedRFRole; confidence: number } {
  if (isFiberOptic(raw)) return { role: "tether", confidence: 0.95 };
  let best: { role: NormalizedRFRole; confidence: number } = { role: "unknown", confidence: 0.3 };
  for (const candidate of ROLES) {
    if (candidate.re.test(raw) && candidate.confidence > best.confidence) {
      best = { role: candidate.role, confidence: candidate.confidence };
    }
  }
  return best;
}

function namedIeee(raw: string): string[] {
  const ids: string[] = [];
  for (const [re, id] of NAMED_IEEE) {
    if (re.test(raw) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function namedNato(raw: string): string[] {
  const ids: string[] = [];
  for (const m of raw.matchAll(/\bnato\s+(?:band\s+)?([a-m])\b/gi)) {
    const id = m[1]!.toUpperCase();
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function uniq(ids: string[]): string[] {
  return [...new Set(ids)];
}

/**
 * One free-form RF description. Fiber and protocol keywords never invent a frequency.
 * When a frequency is present, bands come from that frequency, not from a letter in the text.
 */
export function normalizeRF(raw: string): NormalizedRFLink {
  const protocols = detectProtocols(raw);
  const fiber = isFiberOptic(raw);
  const role = inferRole(raw);
  if (fiber) {
    return {
      raw,
      role: "tether",
      ieeeBands: [],
      natoBands: [],
      ...(protocols.length ? { protocols } : {}),
      tacticalTag: "Fiber optic",
      isFiberOptic: true,
      confidence: 0.95,
    };
  }
  const freqs = parseFrequencies(raw);
  const freq = freqs.length === 1 ? freqs[0] : undefined;
  const ieee = freqs.length ? uniq(freqs.flatMap((f) => ieeeBandsFor(f))) : namedIeee(raw);
  const nato = freqs.length ? uniq(freqs.flatMap((f) => natoBandsFor(f))) : namedNato(raw);
  const tactical = role.role === "uplink" && freq && freq[1] < 1_000 ? "Sub-GHz C2" : undefined;
  return {
    raw,
    role: role.role,
    ...(freq ? { freqMHz: freq } : {}),
    ieeeBands: ieee,
    natoBands: nato,
    ...(protocols.length ? { protocols } : {}),
    ...(tactical ? { tacticalTag: tactical } : {}),
    isFiberOptic: false,
    confidence: role.confidence,
  };
}

/** Intersection in MHz, or undefined when the intervals do not overlap. */
export function intersectBands(
  a: [number, number],
  b: [number, number],
): [number, number] | undefined {
  const lo = Math.max(Math.min(a[0], a[1]), Math.min(b[0], b[1]));
  const hi = Math.min(Math.max(a[0], a[1]), Math.max(b[0], b[1]));
  return lo <= hi ? [lo, hi] : undefined;
}

/** Frequencies win over a previously stored band list. */
export function effectiveIeeeBands(link: {
  ieeeBands?: string[];
  freqMHz?: [number, number];
}): string[] {
  if (link.freqMHz) return ieeeBandsFor(link.freqMHz);
  return link.ieeeBands ?? [];
}

export function effectiveNatoBands(link: {
  natoBands?: string[];
  freqMHz?: [number, number];
}): string[] {
  if (link.freqMHz) return natoBandsFor(link.freqMHz);
  return link.natoBands ?? [];
}

export function linkIsFiber(link: {
  isFiberOptic?: boolean;
  role?: string;
  band?: string;
}): boolean {
  if (link.isFiberOptic || link.role === "tether") return true;
  return !!link.band && FIBER.test(link.band);
}
