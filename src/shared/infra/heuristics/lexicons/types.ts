/**
 * One language's vocabulary for the heuristic extractors. Every entry is a regex fragment (no
 * capturing groups) so a lexicon can express inflection ("міл[ьл]ярд") without code. Adding a
 * language means adding one object of this shape and registering it in ./index.ts - no
 * extractor changes.
 */
export interface Lexicon {
  /** ISO-ish language tag, for diagnostics only. */
  lang: string;
  money: {
    /** Magnitude words/suffixes after a number: "billion", "млрд", "miljarder". */
    magnitudes: string[];
    /** Currency written as a word or code after the number: "dollars", "kronor", "грн". */
    currencyWords: string[];
    /** Cues that a clause states a per-unit price. */
    unitPriceCues: string[];
    /** Cues that a clause states a programme / contract total, never a unit price. */
    totalCues: string[];
  };
  units: {
    km: string[];
    m: string[];
    kg: string[];
    hours: string[];
    minutes: string[];
    kmh: string[];
    watt: string[];
    kilowatt: string[];
  };
  /** Spec cue phrases, by spec. Each list is matched shortly before the number. */
  cues: {
    speed: string[];
    range: string[];
    endurance: string[];
    altitude: string[];
    wingspan: string[];
    payload: string[];
    warhead: string[];
    /** Ground robots: load / towing capacity. */
    ugvLoad: string[];
    /** Ground robots: battery / operating time. */
    ugvOperatingTime: string[];
    /** Jammers: radiated output power. */
    jammingPower: string[];
    /** Jammers / handhelds: suppression or effective defeat radius. */
    suppressionRadius: string[];
    /** SHORAD: engagement (kill) range. */
    engagementRange: string[];
    /** Radars / detectors: detection range. */
    detectionRange: string[];
    /** SHORAD: highest target altitude it can engage. */
    targetAltitude: string[];
    /** SHORAD: fastest target it can engage. */
    targetSpeed: string[];
    /** SHORAD: simultaneous target channels. */
    targetChannels: string[];
  };
}
