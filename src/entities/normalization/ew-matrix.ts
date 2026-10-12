import type { Drone, RFLink } from "@/entities/drone/types";
import { intersectBands, linkIsFiber } from "./rf";
import { semanticKeyFor } from "./semantic";

/** Outcome of one opposing EW emitter against one of a system's links. */
export type ThreatVerdict = "jammed" | "contested" | "safe" | "fiber_immune" | "unknown";

export interface EwEmitter {
  label: string;
  freqMHz?: [number, number];
}

export interface EwInteraction {
  role: string;
  link: string;
  verdict: ThreatVerdict;
  rationale: string;
  overlapMHz?: [number, number];
}

const JAM = /jam|\bew\b|рэб|глуш|suppress|spoof|подав/i;
const ANTI_JAM = /crpa|kometa|комета|anti-?jam|nulling|cyclone|nasir/i;

/** Radio emitters on a system that act as jammers (not its own anti-jam receivers). */
export function ewEmitters(d: Drone): EwEmitter[] {
  const out: EwEmitter[] = [];
  for (const r of d.rf) {
    if (r.role === "antijam" || linkIsFiber(r)) continue;
    const text = [r.band, r.notes, r.tacticalTag].filter(Boolean).join(" ");
    if (JAM.test(text) && !ANTI_JAM.test(text))
      out.push(r.freqMHz ? { label: r.band, freqMHz: r.freqMHz } : { label: r.band });
  }
  for (const p of d.payloads ?? []) {
    if (JAM.test(`${p.name} ${p.category ?? ""}`)) out.push({ label: p.name });
  }
  return out;
}

export function hasAntiJam(d: Drone): boolean {
  return (
    d.rf.some((r) => r.role === "antijam" || ANTI_JAM.test(`${r.band} ${r.notes ?? ""}`)) ||
    d.components.some((c) => ANTI_JAM.test(`${c.part} ${c.model ?? ""}`))
  );
}

const width = (r: [number, number]) => Math.abs(r[1] - r[0]) || 1;

export function assessLink(link: RFLink, emitters: EwEmitter[], antiJam: boolean): EwInteraction {
  const base = {
    role: linkIsFiber(link) ? "tether" : link.role,
    link: link.freqMHz ? `${link.freqMHz[0]}–${link.freqMHz[1]} MHz` : link.band,
  };
  if (linkIsFiber(link))
    return {
      ...base,
      verdict: "fiber_immune",
      rationale: "Physical tether — immune to radio jamming",
    };
  if (link.role === "antijam")
    return { ...base, verdict: "safe", rationale: "Anti-jam receiver, not a jammable link" };
  let best: { hit: [number, number]; share: number; label: string } | undefined;
  let unknownEmitter: string | undefined;
  for (const e of emitters) {
    if (!link.freqMHz || !e.freqMHz) {
      unknownEmitter ??= e.label;
      continue;
    }
    const hit = intersectBands(link.freqMHz, e.freqMHz);
    if (!hit) continue;
    const share = width(hit) / width(link.freqMHz);
    if (!best || share > best.share) best = { hit, share, label: e.label };
  }
  const gnssCrpa = antiJam && link.role === "gnss";
  if (best) {
    const range = `${best.hit[0]}–${best.hit[1]} MHz`;
    if (best.share >= 0.8 && !gnssCrpa)
      return {
        ...base,
        verdict: "jammed",
        overlapMHz: best.hit,
        rationale: `${best.label} covers ${range}`,
      };
    return {
      ...base,
      verdict: "contested",
      overlapMHz: best.hit,
      rationale: gnssCrpa
        ? `${best.label} covers ${range}, but anti-jam antenna mitigates`
        : `Partial cover ${range} (${Math.round(best.share * 100)}%) — link can hop out`,
    };
  }
  if (unknownEmitter)
    return {
      ...base,
      verdict: "unknown",
      rationale: `${unknownEmitter} — jammer frequency not recorded`,
    };
  return { ...base, verdict: "safe", rationale: "Outside every recorded jammer band" };
}

/** How `target`'s links fare against `attacker`'s jammers. */
export function ewMatrix(target: Drone, attacker: Drone) {
  const emitters = ewEmitters(attacker);
  const antiJam = hasAntiJam(target);
  return {
    emitters,
    antiJam,
    rows:
      emitters.length || target.rf.some(linkIsFiber)
        ? target.rf.map((l) => assessLink(l, emitters, antiJam))
        : [],
  };
}

/** Median numeric value of every spec on `d` whose canonical measurement is `semantic`. */
export function specValue(d: Drone, semantic: string): number | undefined {
  const vals: number[] = [];
  for (const a of d.specs) {
    if ((a.semantic ?? semanticKeyFor(a.key, a.label)) !== semantic) continue;
    for (const c of a.claims) {
      if (c.adjudication?.verdict === "outlier") continue;
      const v = c.normalized?.canonicalValue ?? (typeof c.value === "number" ? c.value : undefined);
      if (v !== undefined && Number.isFinite(v)) vals.push(v);
    }
  }
  if (!vals.length) return undefined;
  vals.sort((x, y) => x - y);
  return vals[Math.floor(vals.length / 2)];
}

export type KineticVerdict = "in_envelope" | "outside" | "unknown";
export interface KineticCheck {
  check: string;
  verdict: KineticVerdict;
  rationale: string;
}

/** True when the system records a kinetic engagement envelope (SHORAD, interceptor). */
export function isKineticDefender(d: Drone): boolean {
  return (
    specValue(d, "altitude.target_max") !== undefined ||
    specValue(d, "speed.target_max") !== undefined
  );
}

/**
 * Whether `target` flies inside `defender`'s published engagement envelope.
 * Missing data on either side gives "unknown" rather than a guess.
 */
export function kineticEnvelope(target: Drone, defender: Drone): KineticCheck[] {
  if (!isKineticDefender(defender)) return [];
  const out: KineticCheck[] = [];
  const speed = specValue(target, "speed.max") ?? specValue(target, "speed.cruise");
  const maxSpeed = specValue(defender, "speed.target_max");
  if (maxSpeed !== undefined)
    out.push(
      speed === undefined
        ? {
            check: "Speed",
            verdict: "unknown",
            rationale: `Limit ${maxSpeed} km/h; target speed not recorded`,
          }
        : speed <= maxSpeed
          ? {
              check: "Speed",
              verdict: "in_envelope",
              rationale: `${speed} km/h ≤ ${maxSpeed} km/h limit`,
            }
          : {
              check: "Speed",
              verdict: "outside",
              rationale: `${speed} km/h exceeds ${maxSpeed} km/h limit`,
            },
    );
  const alt =
    specValue(target, "altitude.max") ??
    specValue(target, "altitude.service_ceiling") ??
    specValue(target, "altitude.recommended");
  const ceiling = specValue(defender, "altitude.target_max");
  if (ceiling !== undefined)
    out.push(
      alt === undefined
        ? {
            check: "Altitude",
            verdict: "unknown",
            rationale: `Ceiling ${ceiling} km; target altitude not recorded`,
          }
        : alt <= ceiling
          ? {
              check: "Altitude",
              verdict: "in_envelope",
              rationale: `${alt} km within ${ceiling} km ceiling`,
            }
          : {
              check: "Altitude",
              verdict: "outside",
              rationale: `${alt} km above ${ceiling} km ceiling`,
            },
    );
  const reach = specValue(defender, "range.engagement");
  if (reach !== undefined)
    out.push({
      check: "Reach",
      verdict: "in_envelope",
      rationale: `Engages out to ${reach} km — target must enter that radius`,
    });
  return out;
}
