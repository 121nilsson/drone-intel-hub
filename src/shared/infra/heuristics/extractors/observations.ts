import type {
  PayloadObservation,
  SensorObservation,
  SupplyComponent,
} from "@/entities/drone/types";
import { extractCountedNouns, type AddSpec } from "./common";

/** Non-spec observations an extractor can record alongside spec claims. */
export interface ObservationSink {
  payloads: PayloadObservation[];
  sensors: SensorObservation[];
  components: SupplyComponent[];
  guidance: string[];
}

/**
 * Counted equipment ("4 jammers", "2 cameras", "6 missiles"). The left-boundary guard in
 * extractCountedNouns keeps a designation's number ("UAV-300 MISSILE") from becoming a count.
 */
export function extractCountedEquipment(raw: string, add: AddSpec, sink: ObservationSink) {
  extractCountedNouns(
    raw,
    add,
    ["jammers?", "cameras?", "missiles?", "rotors?", "antennas?", "bombs?"],
    (noun, quantity, evidence) => {
      if (noun === "camera")
        sink.sensors.push({
          name: evidence,
          category: "camera",
          quantity,
          evidence,
          confidence: 0.8,
        });
      if (noun === "bomb" || noun === "missile")
        sink.payloads.push({ name: noun, category: noun, quantity, evidence, confidence: 0.8 });
    },
  );
}

/** Named EO / thermal cameras ("a Wiris 640 thermal camera"). */
export function extractSensors(raw: string, sink: ObservationSink) {
  for (const m of raw.matchAll(
    /(?:a |an )?([A-Z][\w-]*(?:\s+\d{2,4})?)\s+(thermal|EO\/IR|EO|IR|infrared)\s+camera/gi,
  )) {
    const category = /thermal|infrared|\bIR\b/i.test(m[2]!) ? "thermal" : "eo";
    sink.sensors.push({
      name: m[0].trim(),
      ...(m[1] ? { model: m[1] } : {}),
      category,
      evidence: m[0],
      confidence: 0.85,
    });
  }
}

const GUIDANCE_TERMS = [
  "GPS",
  "GNSS",
  "INS",
  "inertial",
  "terrain matching",
  "visual navigation",
  "fiber optic",
];

/** Guidance / navigation modes; recorded both as an observation and one combined spec. */
export function extractGuidance(raw: string, add: AddSpec, sink: ObservationSink) {
  for (const term of GUIDANCE_TERMS) {
    // "GPS jamming" / "immune to GPS jamming" / "without stable GPS" describe a threat or
    // absence, not a guidance mode.
    if (
      term === "GPS" &&
      /immune\s+to\s+GPS\s+jamming|GPS\s+jamming|without[^.]{0,20}GPS|no[^.]{0,20}GPS|без[^.]{0,20}GPS/i.test(
        raw,
      )
    )
      continue;
    if (new RegExp(`\\b${term.replace(" ", "\\s+")}\\b`, "i").test(raw)) sink.guidance.push(term);
  }
  const unique = [...new Set(sink.guidance)];
  if (unique.length)
    add("guidance", "Guidance / navigation", unique.join(", "), undefined, unique.join(", "));
}

/** Named engines / motors ("powered by a Mado MD-550"). */
export function extractPropulsion(raw: string, sink: ObservationSink) {
  for (const m of raw.matchAll(
    /(?:powered by|engine[:\s]+|motor[:\s]+)([A-Z][A-Za-z0-9.-]+(?:\s+[A-Z0-9][A-Za-z0-9.-]+){0,2})/g,
  )) {
    sink.components.push({
      part: "Engine / motor",
      manufacturer: "Unknown",
      origin: "??",
      model: m[1]!.trim(),
      category: "propulsion",
      evidence: m[0],
      confidence: 0.7,
    });
  }
}

/**
 * Frequency references ("900 MHz", "5.8 GHz") plus a CRPA antenna mention, as raw band labels;
 * link-role splitting (control / video / GNSS / radar) stays in normalization. Shared by the
 * whole-text scan and the per-system clause contexts so the rule lives in exactly one place.
 */
export function extractRfBands(raw: string): string[] {
  const bands = [...raw.matchAll(/(\d+(?:[.,]\d+)?)\s*(mhz|ghz)/gi)].map(
    (m) => `${m[1]} ${m[2]!.toUpperCase()}`,
  );
  if (/crpa|kometa/i.test(raw)) bands.push("CRPA");
  return bands;
}
