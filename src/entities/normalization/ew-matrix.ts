import type { Drone, RFLink } from "@/entities/drone/types";
import { intersectBands, linkIsFiber } from "./rf";

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
    if (JAM.test(text) && !ANTI_JAM.test(text)) out.push(r.freqMHz ? { label: r.band, freqMHz: r.freqMHz } : { label: r.band });
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
    return { ...base, verdict: "fiber_immune", rationale: "Physical tether — immune to radio jamming" };
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
      return { ...base, verdict: "jammed", overlapMHz: best.hit, rationale: `${best.label} covers ${range}` };
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
    return { ...base, verdict: "unknown", rationale: `${unknownEmitter} — jammer frequency not recorded` };
  return { ...base, verdict: "safe", rationale: "Outside every recorded jammer band" };
}

/** How `target`'s links fare against `attacker`'s jammers. */
export function ewMatrix(target: Drone, attacker: Drone) {
  const emitters = ewEmitters(attacker);
  const antiJam = hasAntiJam(target);
  return {
    emitters,
    antiJam,
    rows: emitters.length || target.rf.some(linkIsFiber)
      ? target.rf.map((l) => assessLink(l, emitters, antiJam))
      : [],
  };
}
