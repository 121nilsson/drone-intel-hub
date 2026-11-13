import { CANONICAL_UNIT, displayUnit, type Dimension } from "./units";

/**
 * The register core: which physical quantity an attribute measures, the unit it is stored in, and
 * how far two readings may differ before they count as disagreeing. Code only and frozen - a
 * runtime layer may add aliases, never change a dimension, base unit or factor.
 */

/** Who the attribute is for. Used to group and label; it never changes a parse. */
export type AttributeDomain =
  | "technical_specification"
  | "operational"
  | "procurement"
  | "infrastructure"
  | "programme"
  | "metadata";

/** The physical kind of quantity a dimension measures. */
export type PhysicalClass =
  | "length"
  | "speed"
  | "mass"
  | "time"
  | "power"
  | "volume"
  | "force"
  | "acceleration"
  | "dimensionless"
  | "count"
  | "count_rate";

/**
 * Physical class of each canonical dimension. A Record over Dimension, so adding a dimension to
 * CANONICAL_UNIT fails to compile until it is given a class here.
 */
const PHYSICAL_CLASS: Record<Dimension, PhysicalClass> = {
  distance: "length",
  speed: "speed",
  mass: "mass",
  duration: "time",
  power: "power",
  volume: "volume",
  force: "force",
  acceleration: "acceleration",
  // A load factor is a ratio of accelerations; its presentation unit "g" is not a mass.
  load_factor: "dimensionless",
  count_rate: "count_rate",
};

export interface CoreDimension {
  readonly dimension: Dimension;
  readonly physicalClass: PhysicalClass;
  /** The token the catalogue stores, e.g. "g_load". */
  readonly canonicalUnit: string;
  /** What a reader sees, e.g. "g". */
  readonly presentationUnit: string;
}

export const CORE_DIMENSIONS: readonly CoreDimension[] = Object.freeze(
  (Object.keys(CANONICAL_UNIT) as Dimension[]).map((dimension) =>
    Object.freeze({
      dimension,
      physicalClass: PHYSICAL_CLASS[dimension],
      canonicalUnit: CANONICAL_UNIT[dimension],
      presentationUnit: displayUnit(CANONICAL_UNIT[dimension]),
    }),
  ),
);

export interface AttributeTolerance {
  /** Relative spread allowed, as a fraction of the median. 0.6 is the consensus threshold. */
  readonly rel: number;
  /** Absolute spread allowed, in the attribute's canonical unit. Stops a median near zero from
   * turning every small difference into a dispute. */
  readonly abs: number;
}

export interface AttributeEntry {
  /** An exact semantic, or a family prefix ending in "." or the suffix "*.count". */
  readonly semantic: string;
  readonly dimension?: Dimension;
  readonly domain: AttributeDomain;
  readonly tolerance: AttributeTolerance;
}

/** Relative tolerance everywhere: the same 0.6 consensus has always used. */
const REL = 0.6;

/** Unknown semantics compare by relative spread only. */
const DEFAULT_TOLERANCE: AttributeTolerance = Object.freeze({ rel: REL, abs: 0 });

const tolerance = (abs: number): AttributeTolerance => Object.freeze({ rel: REL, abs });

const TECH: AttributeDomain = "technical_specification";
const OPS: AttributeDomain = "operational";

/**
 * Attribute table. A relative spread alone decides for measured attributes, as it did before the
 * register existed; an absolute floor is set only where a relative one means nothing: a count
 * (two sources a unit apart are not in dispute), a rate of such counts, and a load factor in g.
 */
const ENTRY_LIST: AttributeEntry[] = [
  // Families. A prefix match only applies after an exact match fails.
  { semantic: "range.", dimension: "distance", domain: TECH, tolerance: tolerance(0) },
  { semantic: "altitude.", dimension: "distance", domain: TECH, tolerance: tolerance(0) },
  { semantic: "speed.", dimension: "speed", domain: TECH, tolerance: tolerance(0) },
  { semantic: "endurance.", dimension: "duration", domain: OPS, tolerance: tolerance(0) },
  { semantic: "payload.", dimension: "mass", domain: TECH, tolerance: tolerance(0) },
  { semantic: "weight.", dimension: "mass", domain: TECH, tolerance: tolerance(0) },
  { semantic: "power.", dimension: "power", domain: TECH, tolerance: tolerance(0) },
  { semantic: "dimension.", dimension: "distance", domain: TECH, tolerance: tolerance(0) },
  { semantic: "guidance.", domain: TECH, tolerance: tolerance(0) },
  // Suffix family: every count, whatever it is a count of. Checked before the prefixes so that
  // "payload.missile.count" is a count and not a mass.
  { semantic: "*.count", domain: TECH, tolerance: tolerance(1) },

  // Exact attributes.
  { semantic: "capacity.fuel", dimension: "volume", domain: TECH, tolerance: tolerance(0) },
  { semantic: "capacity.target_channels", domain: TECH, tolerance: tolerance(1) },
  // A caliber is written in mm, where a metre floor would swallow every calibre.
  { semantic: "dimension.caliber", dimension: "distance", domain: TECH, tolerance: tolerance(0) },
  { semantic: "cost.unit", domain: "procurement", tolerance: tolerance(0) },
  {
    semantic: "maneuver.load_factor_max",
    dimension: "load_factor",
    domain: TECH,
    tolerance: tolerance(1),
  },
  {
    semantic: "production.rate_monthly",
    dimension: "count_rate",
    domain: OPS,
    tolerance: tolerance(1),
  },
  { semantic: "inventory.deployed_count", domain: "programme", tolerance: tolerance(1) },
];
const ENTRIES: readonly AttributeEntry[] = Object.freeze(ENTRY_LIST.map((e) => Object.freeze(e)));

const BY_SEMANTIC = new Map<string, AttributeEntry>(ENTRIES.map((e) => [e.semantic, e]));
const COUNT_FAMILY = BY_SEMANTIC.get("*.count");
// Longest first, so a more specific family wins over a broader one if both ever apply.
const FAMILIES = ENTRIES.filter((e) => e.semantic.endsWith(".")).sort(
  (a, b) => b.semantic.length - a.semantic.length,
);

/** The register entry for a semantic: exact first, then the longest matching family. */
export function registryEntryFor(semantic: string): AttributeEntry | undefined {
  const exact = BY_SEMANTIC.get(semantic);
  if (exact) return exact;
  if (semantic.endsWith(".count")) return COUNT_FAMILY;
  return FAMILIES.find((f) => semantic.startsWith(f.semantic));
}

/** Allowed spread for a semantic. An unknown semantic compares by relative spread only. */
export function toleranceFor(semantic: string): AttributeTolerance {
  return registryEntryFor(semantic)?.tolerance ?? DEFAULT_TOLERANCE;
}
