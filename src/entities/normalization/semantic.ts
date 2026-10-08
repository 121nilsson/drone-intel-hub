/** Canonical measurement id, or the original key when nothing in the seed table matches. */
export function semanticKeyFor(key: string, label = ""): string {
  const k = key.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const lab = label.trim();

  if (k === "fiber_spool" || k === "spool_length" || /spool/i.test(lab)) return "range.fiber_spool";
  if (k === "operational_range" || k === "cruise_range" || /operational range|cruise range/i.test(lab))
    return "range.operational";
  if (k === "combat_radius" || /combat radius/i.test(lab)) return "range.combat_radius";
  if (k === "link_range" || k === "control_range" || /link range/i.test(lab)) return "range.link";
  if (
    k === "max_range" ||
    k === "maximum_range" ||
    (k === "range" && (lab === "" || /^range$/i.test(lab) || /max(?:imum)? range/i.test(lab)))
  )
    return "range.max";

  if (k === "dive_speed" || /\bdive\b/i.test(lab)) return "speed.dive";
  if (k === "max_speed" || (k === "speed" && /\bmax(?:imum)?\b/i.test(lab))) return "speed.max";
  if (k === "cruise_speed" || (k === "speed" && /\bcruise\b/i.test(lab))) return "speed.cruise";

  if (k === "service_ceiling" || /service ceiling/i.test(lab)) return "altitude.service_ceiling";
  if (k === "max_altitude" || (k === "altitude" && /\bmax(?:imum)?\b/i.test(lab))) return "altitude.max";
  if (k === "altitude" && /recommended/i.test(lab)) return "altitude.recommended";

  if (k === "warhead" || (k === "payload" && /warhead/i.test(lab))) return "payload.warhead";
  if ((k === "payload" || k === "payload_capacity") && (/^payload$/i.test(lab) || /capacity/i.test(lab)))
    return "payload.capacity";

  if (k === "unit_cost" || k === "cost" || /unit cost|price/i.test(lab)) return "cost.unit";
  if (k === "endurance" || k === "flight_time" || /endurance|flight time/i.test(lab)) return "endurance.flight";

  return key;
}

export function canonicalUnitForSemantic(semantic: string): string | undefined {
  if (semantic.startsWith("range.") || semantic.startsWith("altitude.")) return "km";
  if (semantic.startsWith("speed.")) return "km/h";
  if (semantic.startsWith("payload.") || semantic.startsWith("weight.")) return "kg";
  if (semantic.startsWith("endurance.")) return "min";
  return undefined;
}
