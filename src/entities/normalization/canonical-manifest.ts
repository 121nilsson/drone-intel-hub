/**
 * Canonical Semantic Concept Manifest — Phase 3 Hybrid Semantic Registry
 *
 * This file is the single authoritative source of truth for the closed set of
 * recognized canonical semantic concept identifiers in Drone Intel Hub.
 *
 * INVARIANTS (enforced by isValidCanonicalId and test suite):
 *   1. The set is closed. No string outside this manifest is a valid canonical ID.
 *   2. prefix matching via core-registry.ts is permissible ONLY after a string
 *      has passed isValidCanonicalId. E.g. "range.hypothetical" is NOT valid.
 *   3. Each concept is a distinct technical measurement or operational datum.
 *      Sub-concepts that differ in meaning (speed.max vs speed.cruise) each
 *      get their own entry — they must NOT be merged in consensus calculations.
 *
 * BROWSER-SAFE: Pure TypeScript, no imports from server-only or DB modules.
 *
 * To add a concept: add an entry here, bump introducedInVersion, then create
 * a migration + snapshot activation (Phase 3.3+). Do NOT add a concept to the
 * code manifest and use it in DB rules before the manifest version is released.
 */

/** Version of this manifest, bound into snapshot content hashes. */
export const CANONICAL_MANIFEST_VERSION = "1.0.0";

export interface CanonicalConceptDefinition {
  /** Unique stable identifier (dot-namespaced, snake_case leaf). */
  readonly id: string;
  /** Family prefix, including the trailing dot. E.g. "speed." */
  readonly family: string;
  /** Short human-readable label. */
  readonly label: string;
  /** Longer description clarifying scope and boundaries. */
  readonly description: string;
  /** Semver string of the manifest release that first defined this concept. */
  readonly introducedInVersion: string;
}

/**
 * Complete, closed list of canonical semantic concepts.
 * Order within families is for readability only; lookup uses a Set.
 */
export const CANONICAL_CONCEPTS: readonly CanonicalConceptDefinition[] = Object.freeze([
  // ── Speed ──────────────────────────────────────────────────────────────
  {
    id: "speed.max",
    family: "speed.",
    label: "Maximum Speed",
    description: "Highest rated or demonstrated airspeed",
    introducedInVersion: "1.0.0",
  },
  {
    id: "speed.cruise",
    family: "speed.",
    label: "Cruise Speed",
    description: "Nominal sustained cruise airspeed",
    introducedInVersion: "1.0.0",
  },
  {
    id: "speed.dive",
    family: "speed.",
    label: "Dive Speed",
    description: "Terminal dive or never-exceed speed (Vne)",
    introducedInVersion: "1.0.0",
  },
  {
    id: "speed.target_max",
    family: "speed.",
    label: "Max Target Speed",
    description: "Maximum engageable target speed (C-UAS)",
    introducedInVersion: "1.0.0",
  },

  // ── Range ───────────────────────────────────────────────────────────────
  {
    id: "range.max",
    family: "range.",
    label: "Maximum Range",
    description: "Maximum stated operational or ferry range",
    introducedInVersion: "1.0.0",
  },
  {
    id: "range.operational",
    family: "range.",
    label: "Operational Range",
    description: "Practical range under mission load",
    introducedInVersion: "1.0.0",
  },
  {
    id: "range.combat_radius",
    family: "range.",
    label: "Combat Radius",
    description: "Outbound-only combat mission radius",
    introducedInVersion: "1.0.0",
  },
  {
    id: "range.combat",
    family: "range.",
    label: "Combat Range",
    description: "Mission range under combat load",
    introducedInVersion: "1.0.0",
  },
  {
    id: "range.ferry",
    family: "range.",
    label: "Ferry Range",
    description: "Maximum range without payload/stores",
    introducedInVersion: "1.0.0",
  },
  {
    id: "range.link",
    family: "range.",
    label: "Link/Control Range",
    description: "Line-of-sight communication or data link limit",
    introducedInVersion: "1.0.0",
  },
  {
    id: "range.engagement",
    family: "range.",
    label: "Engagement Range",
    description: "Effective engagement or suppression envelope (C-UAS)",
    introducedInVersion: "1.0.0",
  },
  {
    id: "range.detection",
    family: "range.",
    label: "Detection Range",
    description: "Sensor detection distance",
    introducedInVersion: "1.0.0",
  },
  {
    id: "range.fiber_spool",
    family: "range.",
    label: "Fiber Spool Length",
    description: "Physical tether or optical fiber payout length",
    introducedInVersion: "1.0.0",
  },
  {
    id: "range.min",
    family: "range.",
    label: "Minimum Range",
    description: "Minimum arming, engagement or operating distance",
    introducedInVersion: "1.0.0",
  },

  // ── Altitude ────────────────────────────────────────────────────────────
  {
    id: "altitude.max",
    family: "altitude.",
    label: "Maximum Altitude",
    description: "Absolute operational ceiling",
    introducedInVersion: "1.0.0",
  },
  {
    id: "altitude.service_ceiling",
    family: "altitude.",
    label: "Service Ceiling",
    description: "Aeronautical ceiling (climb rate decay bound)",
    introducedInVersion: "1.0.0",
  },
  {
    id: "altitude.target_max",
    family: "altitude.",
    label: "Max Target Altitude",
    description: "Ceiling of engageable target (C-UAS)",
    introducedInVersion: "1.0.0",
  },
  {
    id: "altitude.target_min",
    family: "altitude.",
    label: "Min Target Altitude",
    description: "Floor of engageable target (C-UAS)",
    introducedInVersion: "1.0.0",
  },

  // ── Payload & Weight ────────────────────────────────────────────────────
  {
    id: "payload.capacity",
    family: "payload.",
    label: "Payload Capacity",
    description: "Maximum carrying capacity for equipment/stores",
    introducedInVersion: "1.0.0",
  },
  {
    id: "payload.mass",
    family: "payload.",
    label: "Payload Mass",
    description: "Nominal carried payload weight",
    introducedInVersion: "1.0.0",
  },
  {
    id: "payload.warhead",
    family: "payload.",
    label: "Warhead Mass",
    description: "Net explosive charge weight",
    introducedInVersion: "1.0.0",
  },
  {
    id: "weight.mtow",
    family: "weight.",
    label: "MTOW",
    description: "Maximum takeoff weight",
    introducedInVersion: "1.0.0",
  },
  {
    id: "weight.empty",
    family: "weight.",
    label: "Empty Weight",
    description: "Airframe weight without fuel or payload",
    introducedInVersion: "1.0.0",
  },
  {
    id: "weight.launch",
    family: "weight.",
    label: "Launch Weight",
    description: "Total weight at moment of launch",
    introducedInVersion: "1.0.0",
  },
  {
    id: "weight.total",
    family: "weight.",
    label: "Total Weight",
    description: "Stated gross system weight",
    introducedInVersion: "1.0.0",
  },

  // ── Dimensions ──────────────────────────────────────────────────────────
  {
    id: "dimension.length",
    family: "dimension.",
    label: "Length",
    description: "Overall airframe/hull length",
    introducedInVersion: "1.0.0",
  },
  {
    id: "dimension.wingspan",
    family: "dimension.",
    label: "Wingspan",
    description: "Total wing span",
    introducedInVersion: "1.0.0",
  },
  {
    id: "dimension.height",
    family: "dimension.",
    label: "Height",
    description: "Overall height",
    introducedInVersion: "1.0.0",
  },
  {
    id: "dimension.width",
    family: "dimension.",
    label: "Width",
    description: "Beam or fuselage width",
    introducedInVersion: "1.0.0",
  },
  {
    id: "dimension.diameter",
    family: "dimension.",
    label: "Diameter",
    description: "Fuselage or body diameter",
    introducedInVersion: "1.0.0",
  },
  {
    id: "dimension.depth",
    family: "dimension.",
    label: "Draft/Depth",
    description: "Subsurface draft or depth",
    introducedInVersion: "1.0.0",
  },
  {
    id: "dimension.caliber",
    family: "dimension.",
    label: "Caliber",
    description: "Bore or munition caliber",
    introducedInVersion: "1.0.0",
  },

  // ── Power ───────────────────────────────────────────────────────────────
  {
    id: "power.rf",
    family: "power.",
    label: "RF Jamming Power",
    description: "Transmitter/jammer output power",
    introducedInVersion: "1.0.0",
  },
  {
    id: "power.engine",
    family: "power.",
    label: "Engine Power",
    description: "Propulsion motor or engine output",
    introducedInVersion: "1.0.0",
  },

  // ── Endurance ───────────────────────────────────────────────────────────
  {
    id: "endurance.flight",
    family: "endurance.",
    label: "Flight Endurance",
    description: "Total operating duration in flight",
    introducedInVersion: "1.0.0",
  },

  // ── Maneuver ────────────────────────────────────────────────────────────
  {
    id: "maneuver.load_factor_max",
    family: "maneuver.",
    label: "Max Load Factor",
    description: "Normal structural acceleration limit (g)",
    introducedInVersion: "1.0.0",
  },

  // ── Capacity ────────────────────────────────────────────────────────────
  {
    id: "capacity.fuel",
    family: "capacity.",
    label: "Fuel Capacity",
    description: "Internal liquid fuel volume",
    introducedInVersion: "1.0.0",
  },
  {
    id: "capacity.target_channels",
    family: "capacity.",
    label: "Target Channels",
    description: "Simultaneous target tracking/engagement channels",
    introducedInVersion: "1.0.0",
  },

  // ── Cost, Production, Inventory, Guidance ───────────────────────────────
  {
    id: "cost.unit",
    family: "cost.",
    label: "Unit Cost",
    description: "Procurement price per unit",
    introducedInVersion: "1.0.0",
  },
  {
    id: "production.rate_monthly",
    family: "production.",
    label: "Monthly Production",
    description: "Manufacturing output per month",
    introducedInVersion: "1.0.0",
  },
  {
    id: "inventory.deployed_count",
    family: "inventory.",
    label: "Deployed Units",
    description: "Active operational inventory count",
    introducedInVersion: "1.0.0",
  },
  {
    id: "guidance.system",
    family: "guidance.",
    label: "Guidance System",
    description: "Navigation and terminal homing technology",
    introducedInVersion: "1.0.0",
  },
]);

/** Fast lookup set, derived once at module initialisation. */
const VALID_CANONICAL_IDS: ReadonlySet<string> = new Set(CANONICAL_CONCEPTS.map((c) => c.id));

/**
 * Strict allowlist validator.
 *
 * Returns true IF AND ONLY IF the string is explicitly registered in
 * CANONICAL_CONCEPTS. Prefix matching is prohibited here: "range.hypothetical"
 * returns false even though "range." is a valid family prefix.
 */
export function isValidCanonicalId(id: string): boolean {
  return VALID_CANONICAL_IDS.has(id);
}
