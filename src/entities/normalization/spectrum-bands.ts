import type { Drone, RFLink } from "@/entities/drone/types";
import { intersectBands, linkIsFiber } from "./rf";

/** Operational segments shown on the spectrum strip (MHz). Data, not a closed type. */
export interface SpectrumSegment {
  id: string;
  label: string;
  use: string;
  range: [number, number];
}

export const SPECTRUM_SEGMENTS: SpectrumSegment[] = [
  { id: "uhf", label: "300–500 MHz", use: "UHF telemetry / 433", range: [300, 500] },
  { id: "fpv", label: "700–1050 MHz", use: "Tactical FPV control", range: [700, 1050] },
  { id: "lband", label: "1.1–1.4 GHz", use: "Long-range video", range: [1100, 1400] },
  { id: "gnss", label: "1.5–1.6 GHz", use: "GNSS navigation", range: [1500, 1620] },
  { id: "s", label: "2.4 GHz", use: "ISM control / Wi-Fi", range: [2400, 2500] },
  { id: "c", label: "4–8 GHz", use: "5.8 video · C-band radar", range: [4000, 8000] },
  { id: "x", label: "8–12 GHz", use: "X-band C-UAS radar", range: [8000, 12000] },
  { id: "ku", label: "12–18 GHz", use: "Ku fire-control radar", range: [12000, 18000] },
];

export type SpectrumKind = "link" | "jammer" | "radar" | "detector";

export interface SpectrumEntry {
  systemId: string;
  system: string;
  kind: SpectrumKind;
  label: string;
  role: string;
  freqMHz?: [number, number];
  fiber?: boolean;
}

const JAM = /jam|\bew\b|рэб|глуш|suppress|spoof|подав/i;
const RADAR = /radar|рлс|\brls\b/i;
const DETECT = /detector|direction.?find|\bdf\b|passive|listen/i;

export function classifyLink(r: RFLink): SpectrumKind {
  const t = [r.band, r.notes, r.tacticalTag].filter(Boolean).join(" ");
  if (RADAR.test(t)) return "radar";
  if (JAM.test(t) && r.role !== "antijam") return "jammer";
  if (DETECT.test(t)) return "detector";
  return "link";
}

export function spectrumEntries(drones: Drone[]): SpectrumEntry[] {
  const out: SpectrumEntry[] = [];
  for (const d of drones)
    for (const r of d.rf) {
      if (r.role === "antijam") continue;
      const fiber = linkIsFiber(r);
      out.push({
        systemId: d.id,
        system: d.name,
        kind: fiber ? "link" : classifyLink(r),
        label: r.band,
        role: fiber ? "tether" : r.role,
        ...(r.freqMHz ? { freqMHz: r.freqMHz } : {}),
        ...(fiber ? { fiber: true } : {}),
      });
    }
  return out;
}

export interface SegmentStatus {
  segment: SpectrumSegment;
  links: SpectrumEntry[];
  jammers: SpectrumEntry[];
  radars: SpectrumEntry[];
  detectors: SpectrumEntry[];
  /** Drone links operate here but no recorded jammer covers it. */
  evasionGap: boolean;
}

const hits = (e: SpectrumEntry, s: SpectrumSegment) =>
  !!e.freqMHz && !!intersectBands(e.freqMHz, s.range);

export function segmentStatus(entries: SpectrumEntry[]): SegmentStatus[] {
  return SPECTRUM_SEGMENTS.map((segment) => {
    const inSeg = entries.filter((e) => hits(e, segment));
    const links = inSeg.filter((e) => e.kind === "link");
    const jammers = inSeg.filter((e) => e.kind === "jammer");
    return {
      segment,
      links,
      jammers,
      radars: inSeg.filter((e) => e.kind === "radar"),
      detectors: inSeg.filter((e) => e.kind === "detector"),
      evasionGap: links.length > 0 && jammers.length === 0,
    };
  });
}

export type Exposure = "jammed" | "evades" | "fiber" | "unknown";

export interface SystemExposure {
  link: SpectrumEntry;
  exposure: Exposure;
  by: string[];
}

/** How each link of `drone` fares against every recorded jammer. */
export function linkExposure(drone: Drone, entries: SpectrumEntry[]): SystemExposure[] {
  const jammers = entries.filter((e) => e.kind === "jammer" && e.systemId !== drone.id);
  return entries
    .filter((e) => e.systemId === drone.id && e.kind === "link")
    .map((link) => {
      if (link.fiber) return { link, exposure: "fiber" as const, by: [] };
      if (!link.freqMHz) return { link, exposure: "unknown" as const, by: [] };
      const by = [
        ...new Set(
          jammers
            .filter((j) => j.freqMHz && intersectBands(link.freqMHz!, j.freqMHz))
            .map((j) => j.system),
        ),
      ];
      return { link, exposure: by.length ? ("jammed" as const) : ("evades" as const), by };
    });
}

/** Systems that operate radars; radars detect airframes regardless of drone RF silence. */
export function radarSystems(entries: SpectrumEntry[]): string[] {
  return [...new Set(entries.filter((e) => e.kind === "radar").map((e) => e.system))];
}
