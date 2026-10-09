/** Canonical measurement id, or the original key when nothing in the seed table matches. */
export function semanticKeyFor(key: string, label = ""): string {
  const k = key
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const lab = label.trim();

  if (k === "fiber_spool" || k === "spool_length" || /spool/i.test(lab)) return "range.fiber_spool";
  if (
    k === "operational_range" ||
    k === "cruise_range" ||
    /operational range|cruise range/i.test(lab)
  )
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
  if (k === "max_altitude" || (k === "altitude" && /\bmax(?:imum)?\b/i.test(lab)))
    return "altitude.max";
  if (k === "altitude" && /recommended/i.test(lab)) return "altitude.recommended";

  if (k === "warhead" || (k === "payload" && /warhead/i.test(lab))) return "payload.warhead";
  if (
    (k === "payload" || k === "payload_capacity") &&
    (/^payload$/i.test(lab) || /capacity/i.test(lab))
  )
    return "payload.capacity";
  if (k === "weight_mtow" || k === "mtow" || /maximum takeoff|mtow/i.test(lab))
    return "weight.mtow";
  if (k === "weight_empty" || k === "empty_weight" || /empty weight|dry weight/i.test(lab))
    return "weight.empty";
  if (k === "weight_launch" || k === "launch_weight" || /launch weight/i.test(lab))
    return "weight.launch";

  if (k === "unit_cost" || k === "cost" || /unit cost|price/i.test(lab)) return "cost.unit";
  if (k === "endurance" || k === "flight_time" || /endurance|flight time/i.test(lab))
    return "endurance.flight";
  if (k === "guidance" || /guidance|navigation/i.test(lab)) return "guidance.system";
  if (k === "cameras" || /camera/i.test(lab)) return "sensor.camera.count";
  if (k === "jammers" || /jammer/i.test(lab)) return "ew.jammer.count";

  if (k === "length" || k === "loa" || /^length$/i.test(lab) || /overall length/i.test(lab))
    return "dimension.length";
  if (k === "diameter" || /^diameter$/i.test(lab)) return "dimension.diameter";
  if (k === "wingspan" || k === "span" || /wingspan|wing span/i.test(lab))
    return "dimension.wingspan";
  if (k === "height" || /^height$/i.test(lab) || /overall height/i.test(lab))
    return "dimension.height";
  if (k === "width" || /^width$/i.test(lab)) return "dimension.width";
  if (k === "beam" && /beam/i.test(lab)) return "dimension.width";
  if (k === "draft" || /^draft$/i.test(lab)) return "dimension.depth";

  return key;
}

export function canonicalUnitForSemantic(semantic: string): string | undefined {
  if (semantic.startsWith("dimension.")) return "m";
  if (semantic.startsWith("range.") || semantic.startsWith("altitude.")) return "km";
  if (semantic.startsWith("speed.")) return "km/h";
  if (semantic.startsWith("payload.") || semantic.startsWith("weight.")) return "kg";
  if (semantic.startsWith("endurance.")) return "min";
  return undefined;
}
