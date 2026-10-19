import type { ExtractedSpec } from "@/entities/drone/types";
import type { CompiledCue, CompiledFilter, CueTarget } from "@/shared/contracts/rules";
import { cue, unit } from "@/shared/lexicons";
import { ENVELOPE, type AddSpec, measureCue } from "./common";

/**
 * Dynamic-rule application. A rule only adds vocabulary to a target the static extractors already
 * own, so its units, label and cross-class guard are fixed here and never come from the rule.
 */
interface Target {
  key: string;
  label: string;
  units: Array<[string, string]>;
  gap?: number;
  notAfter?: RegExp;
  orders?: ReadonlyArray<"before" | "after">;
}

const km = (): Array<[string, string]> => [[unit("km"), "km"]];
const kg = (): Array<[string, string]> => [[unit("kg"), "kg"]];
const m = (): Array<[string, string]> => [[unit("m"), "m"]];
const dist = (): Array<[string, string]> => [...km(), ...m()];

const TARGETS: Record<CueTarget, () => Target> = {
  range: () => ({ key: "range", label: "Range", units: km(), notAfter: ENVELOPE }),
  speed: () => ({
    key: "speed",
    label: "Cruise speed",
    units: [[unit("kmh"), "km/h"]],
    gap: 16,
    notAfter: new RegExp(cue("targetSpeed"), "iu"),
  }),
  endurance: () => ({
    key: "endurance",
    label: "Endurance",
    units: [
      [unit("days"), "d"],
      [unit("hours"), "h"],
      [unit("minutes"), "min"],
    ],
  }),
  altitude: () => ({ key: "altitude", label: "Maximum altitude", units: km(), notAfter: ENVELOPE }),
  wingspan: () => ({ key: "wingspan", label: "Wingspan", units: m(), gap: 16 }),
  payload: () => ({ key: "payload", label: "Payload capacity", units: kg(), gap: 20 }),
  warhead: () => ({
    key: "warhead",
    label: "Warhead weight",
    units: kg(),
    gap: 20,
    orders: ["before", "after"],
  }),
  weight_mtow: () => ({
    key: "weight_mtow",
    label: "Maximum takeoff weight",
    units: kg(),
    gap: 20,
  }),
  length: () => ({
    key: "length",
    label: "Length",
    units: m(),
    gap: 16,
    orders: ["before", "after"],
  }),
  engagement_range: () => ({ key: "engagement_range", label: "Engagement range", units: dist() }),
  detection_range: () => ({ key: "detection_range", label: "Detection range", units: dist() }),
  target_altitude_max: () => ({
    key: "target_altitude_max",
    label: "Maximum target altitude",
    units: dist(),
  }),
};

/** Run every dynamic cue through the same measureCue contract as the static extractors. */
export function extractDynamicCues(raw: string, add: AddSpec, cues: readonly CompiledCue[]) {
  for (const c of cues) {
    const t = TARGETS[c.target]();
    for (const order of t.orders ?? ["before"])
      measureCue(raw, add, {
        cue: c.pattern,
        units: t.units,
        key: t.key,
        label: t.label,
        ...(t.gap ? { gap: t.gap } : {}),
        ...(t.notAfter ? { notAfter: t.notAfter } : {}),
        order,
      });
  }
}

const TOKEN = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
const tokens = (s: string) => (s.toLowerCase().match(TOKEN) ?? []) as string[];
/** A trigger matches a token sequence by prefix, so "поражени" covers its case endings. */
const hit = (window: string[], trigger: string) => {
  const words = trigger.split(/\s+/);
  for (let i = 0; i + words.length <= window.length; i++)
    if (words.every((w, j) => window[i + j]!.startsWith(w))) return true;
  return false;
};

/**
 * The sentence around a claim, split at its number: [tokens before, tokens after]. Evidence is
 * a verbatim slice of `raw`, so the first occurrence locates it; a claim whose evidence cannot
 * be found is left alone rather than guessed at.
 */
function around(raw: string, evidence: string): [string[], string[]] | null {
  const at = raw.indexOf(evidence);
  const digit = evidence.search(/\d/);
  if (at < 0 || digit < 0) return null;
  const n = at + digit;
  const start = Math.max(...[".", "!", "?", ";", "\n"].map((p) => raw.lastIndexOf(p, n - 1))) + 1;
  const ends = [".", "!", "?", ";", "\n"].map((p) => raw.indexOf(p, n)).filter((i) => i >= 0);
  // A decimal point is not a sentence end: skip past the number before looking for one.
  const numEnd = n + (raw.slice(n).match(/^[\d.,\s]*\d/)?.[0].length ?? 1);
  const end = Math.min(raw.length, ...ends.filter((i) => i >= numEnd));
  return [tokens(raw.slice(start, n)), tokens(raw.slice(numEnd, end))];
}

/**
 * Apply context filters to finished claims: suppress a claim, or move it to the key it really
 * belongs to ("engagement altitude 40 km" is a target ceiling, not the vehicle's). Pure; returns
 * a new list and never adds a claim the extractors did not make.
 */
export function applyContextFilters(
  raw: string,
  specs: ExtractedSpec[],
  filters: readonly CompiledFilter[],
  relabel: (spec: ExtractedSpec, key: string) => ExtractedSpec,
): ExtractedSpec[] {
  if (!filters.length) return specs;
  const out: ExtractedSpec[] = [];
  for (const spec of specs) {
    let s: ExtractedSpec | null = spec;
    for (const f of filters) {
      if (!s || s.key !== f.key) continue;
      const ctx = around(raw, s.evidence ?? s.raw ?? "");
      if (!ctx) continue;
      const [before, after] = ctx;
      const window = [
        ...before.slice(-f.maxTokenDistance),
        ...(f.position === "anywhere_in_scope" ? after.slice(0, f.maxTokenDistance) : []),
      ];
      if (!f.triggers.some((t) => hit(window, t))) continue;
      s = f.action === "reroute" && f.targetKey ? relabel(s, f.targetKey) : null;
    }
    if (!s) continue;
    // A rerouted claim may restate one the target's own extractor already made.
    const moved = s !== spec;
    const dup = (o: ExtractedSpec) =>
      o.key === s.key && String(o.value) === String(s.value) && o.unit === s.unit;
    if (moved && (specs.some(dup) || out.some(dup))) continue;
    out.push(s);
  }
  return out;
}
