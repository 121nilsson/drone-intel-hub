/**
 * One language's vocabulary for the heuristic extractors. Every entry is a regex fragment (no
 * capturing groups) so a lexicon can express inflection ("міл[ьл]ярд") without code. Adding a
 * language means adding one object of this shape and registering it in ./index.ts - no
 * extractor changes.
 */
export type MoneyScale = "thousand" | "million" | "billion";

export interface Lexicon {
  /** ISO-ish language tag, for diagnostics only. */
  lang: string;
  money: {
    /** Magnitude words/suffixes after a number, by scale: "billion", "млрд", "miljarder". */
    magnitudes: Record<MoneyScale, string[]>;
    /** Currency written as a word or code after the number, by ISO 4217 code. */
    currencies: Partial<Record<string, string[]>>;
    /** One token carrying both magnitude and currency ("mkr" = million SEK). */
    compounds?: Array<{ word: string; scale: MoneyScale; currency: string }>;
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
    /** Volume: fuel tank / capacity. */
    liters: string[];
    /** Speed in knots ("42 kn", "45 вузлів"). */
    knots: string[];
    /** Distance in nautical miles. */
    nmi: string[];
    /** Speed in miles per hour. */
    mph: string[];
    /** Speed as a Mach number ("2.5 Mach", "2,5 Махов"). */
    mach: string[];
    /** Endurance in days ("3 days", "3 діб"). */
    days: string[];
  };
  /** Spec cue phrases, by spec. Each list is matched shortly before the number. */
  cues: {
    speed: string[];
    /**
     * Stated top speed ("maximum speed", "can fly up to"). Read apart from `speed`, which is filed
     * as cruise: a top speed read as cruise was a wrong figure on the right system.
     */
    maxSpeed: string[];
    /** Stated cruise speed ("cruises at", "крейсерська швидкість"). */
    cruiseSpeed: string[];
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
    /** Surface vessels: hull draft ("0.8 m draft", "осадка 0,8 м"). */
    usvDraft: string[];
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
    /** Fuel tank / fuel capacity (liters). */
    fuelCapacity: string[];
    /** Dimension: length. */
    length: string[];
    /** Dimension: height. */
    height: string[];
    /** Dimension: width. */
    width: string[];
    /** Dimension: diameter. */
    diameter: string[];
    /** Weight: maximum takeoff weight. */
    weightMtow: string[];
    /** Weight: empty / dry mass. */
    weightEmpty: string[];
    /** Weight: launch mass. */
    weightLaunch: string[];
  };
}
