export interface StoredTaxonomyTerm extends TaxonomyTerm {
  /** `${taxonomy}/${canonicalId}` */
  id: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface TaxonomyCandidate {
  id: string;
  taxonomy: string;
  rawTerm: string;
  status: "candidate" | "mapped" | "promoted" | "rejected";
  resolvedCanonicalId?: string;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  sources: Array<{ sourceId?: string; source: string; droneId?: string; seenAt: string }>;
}

export function termId(taxonomy: string, canonicalId: string) {
  return `${taxonomy}/${canonicalId}`;
}

export function storedTerm(
  t: TaxonomyTerm,
  extra?: { updatedAt?: string; updatedBy?: string },
): StoredTaxonomyTerm {
  return { ...t, id: termId(t.taxonomy, t.canonicalId), ...extra };
}

export interface TaxonomyTerm {
  taxonomy: string;
  canonicalId: string;
  label: string;
  parentId?: string;
  aliases: string[];
  status: "active" | "rejected" | "candidate";
  origin: "seed" | "db";
}

export interface TermResolution {
  canonicalId?: string;
  confidence: number;
  ambiguous?: boolean;
}

const term = (
  taxonomy: string,
  canonicalId: string,
  label: string,
  aliases: string[],
  parentId?: string,
): TaxonomyTerm => ({
  taxonomy,
  canonicalId,
  label,
  aliases,
  status: "active",
  origin: "seed",
  ...(parentId ? { parentId } : {}),
});

export const PROPULSION_TERMS: TaxonomyTerm[] = [
  term("propulsion", "electric", "Electric", ["bldc", "battery", "brushed", "electric motor"]),
  term("propulsion", "piston", "Piston", [
    "2-stroke",
    "4-stroke",
    "two-stroke",
    "four-stroke",
    "md-550",
    "mado",
    "ice",
    "piston engine",
  ]),
  term("propulsion", "turbojet", "Turbojet", ["turbo jet", "jet engine", "micro turbojet"]),
  term("propulsion", "turbofan", "Turbofan", ["turbo fan"]),
  term("propulsion", "turboprop", "Turboprop", ["turbo prop"]),
  term("propulsion", "rocket", "Rocket", ["rocket-assist", "rocket assist"]),
  term("propulsion", "hybrid", "Hybrid", ["hybrid-electric"]),
  term("propulsion", "waterjet", "Waterjet", ["water jet"]),
  term("propulsion", "outboard", "Outboard", ["outboard motor"]),
  term("propulsion", "unpowered-glide", "Unpowered glide", ["glider", "unpowered"]),
];

/** How the vehicle is installed. Separate from the propulsion family so "electric" and "tracked" both stay filterable. */
export const INSTALLATION_TERMS: TaxonomyTerm[] = [
  term("installation", "tracked", "Tracked", ["tracks", "electric tracked"]),
  term("installation", "wheeled", "Wheeled", ["wheels"]),
  term("installation", "multirotor", "Multirotor", ["multi-rotor", "multicopter"]),
  term("installation", "quadrotor", "Quadrotor", ["quadcopter", "quad"], "multirotor"),
  term("installation", "fixed-wing", "Fixed wing", ["fixed wing"]),
  term("installation", "delta-wing", "Delta wing", ["delta wing"], "fixed-wing"),
  term("installation", "flying-wing", "Flying wing", ["flying wing"], "fixed-wing"),
  term("installation", "pusher", "Pusher", ["pusher propeller"]),
  term("installation", "tractor", "Tractor", ["tractor propeller"]),
  term("installation", "vtol", "VTOL", ["vertical takeoff"]),
  term("installation", "tiltrotor", "Tiltrotor", ["tilt-rotor"], "vtol"),
  term("installation", "helicopter", "Helicopter", ["single-rotor"]),
];

export const PROTOCOL_TERMS: TaxonomyTerm[] = [
  term("protocol", "expresslrs", "ExpressLRS", ["ELRS", "Express LRS"]),
  term("protocol", "crossfire", "Crossfire", ["TBS Crossfire"]),
  term("protocol", "tbs", "TBS", []),
  term("protocol", "ocusync", "OcuSync", []),
  term("protocol", "gps-l1", "GPS L1", ["GPS L1"]),
  term("protocol", "gps-l2", "GPS L2", ["GPS L2"]),
  term("protocol", "gps-l5", "GPS L5", ["GPS L5"]),
  term("protocol", "gps", "GPS", []),
  term("protocol", "glonass", "GLONASS", ["ГЛОНАСС"]),
  term("protocol", "galileo", "Galileo", []),
  term("protocol", "starlink", "Starlink", []),
  term("protocol", "crpa", "CRPA", ["Kometa", "Kometa-M"]),
];

export const SEEDED_TERMS: TaxonomyTerm[] = [
  ...PROPULSION_TERMS,
  ...INSTALLATION_TERMS,
  ...PROTOCOL_TERMS,
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Match an alias even when spaces or hyphens differ ("Express LRS" / "ExpressLRS"). */
function aliasAppears(raw: string, alias: string): boolean {
  const parts = alias
    .trim()
    .split(/[^a-z0-9\u0400-\u04ff]+/i)
    .filter((p) => p.length > 0);
  if (!parts.length) return false;
  const body = parts.map(escapeRegExp).join("[^a-z0-9\\u0400-\\u04ff]*");
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "iu").test(raw);
}

function active(terms: readonly TaxonomyTerm[], taxonomy: string): TaxonomyTerm[] {
  return terms.filter((t) => t.taxonomy === taxonomy && t.status === "active");
}

/** Every canonical id whose alias appears in the text. A broader id is dropped when a more specific one also matched. */
export function matchTerms(
  raw: string,
  taxonomy: string,
  terms: readonly TaxonomyTerm[],
): string[] {
  const ids: string[] = [];
  for (const t of active(terms, taxonomy)) {
    const names = [t.canonicalId, t.label, ...t.aliases];
    if (names.some((alias) => aliasAppears(raw, alias)) && !ids.includes(t.canonicalId))
      ids.push(t.canonicalId);
  }
  return ids.filter((id) => !ids.some((other) => other !== id && other.startsWith(`${id}-`)));
}

/**
 * Resolve one raw label to a single canonical id.
 * Two different ids → no winner. No match → no canonical id (the caller records a candidate).
 */
export function effectivePropulsionId(
  d: { propulsion: string; propulsionId?: string },
  terms: readonly TaxonomyTerm[] = SEEDED_TERMS,
): string | undefined {
  return d.propulsionId ?? resolveTerm(d.propulsion, "propulsion", terms).canonicalId;
}

export function effectiveInstallationId(
  d: { installation?: string; installationId?: string },
  terms: readonly TaxonomyTerm[] = SEEDED_TERMS,
): string | undefined {
  if (d.installationId) return d.installationId;
  const raw = d.installation?.trim();
  if (!raw) return undefined;
  return resolveTerm(raw, "installation", terms).canonicalId;
}

export function resolveTerm(
  raw: string,
  taxonomy: string,
  terms: readonly TaxonomyTerm[],
): TermResolution {
  const text = raw.trim();
  if (!text) return { confidence: 0 };
  const ids = matchTerms(text, taxonomy, terms);
  if (ids.length === 1) {
    const only = ids[0]!;
    const exact = active(terms, taxonomy).some((t) => {
      if (t.canonicalId !== only) return false;
      return [t.canonicalId, t.label, ...t.aliases].some(
        (alias) => alias.trim().toLowerCase() === text.toLowerCase(),
      );
    });
    return { canonicalId: only, confidence: exact ? 1 : 0.8 };
  }
  if (ids.length > 1) return { confidence: 0.5, ambiguous: true };
  return { confidence: 0 };
}
