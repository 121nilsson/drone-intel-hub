/** Canonical measurement id, or the original key when nothing in the seed table matches. */
export function semanticKeyFor(key: string, label = ""): string {
  const k = key
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_(km|m|kmh|kg|min|w|l)$/, "");
  const lab = label.trim();

  // Counter-drone envelopes first: "effective range" / "target speed" must not fall into the
  // vehicle's own range or speed.
  if (
    k === "engagement_range" ||
    k === "suppression_radius" ||
    k === "effective_range" ||
    /engagement range|kill range|suppression radius|jamming radius|effective range/i.test(lab)
  )
    return "range.engagement";
  if (k === "detection_range" || /detection range/i.test(lab)) return "range.detection";
  if (k === "target_altitude_max" || /engagement altitude|max(?:imum)? target altitude/i.test(lab))
    return "altitude.target_max";
  if (k === "target_altitude_min" || /min(?:imum)? target altitude/i.test(lab))
    return "altitude.target_min";
  if (k === "target_speed_max" || /target speed/i.test(lab)) return "speed.target_max";
  if (k === "jamming_power" || k === "output_power" || /jamming power|output power/i.test(lab))
    return "power.rf";
  if (k === "engine_power" || /engine power/i.test(lab)) return "power.engine";
  if (k === "distributable_power" || /distributable power/i.test(lab)) return "power.distributable";
  if (k === "laser_power" || /laser power/i.test(lab)) return "power.laser";
  if (k === "target_channels" || /target channels/i.test(lab)) return "capacity.target_channels";
  if (k === "fuel_capacity" || /fuel capacity|internal fuel/i.test(lab)) return "capacity.fuel";

  if (k === "fiber_spool" || k === "spool_length" || /spool/i.test(lab)) return "range.fiber_spool";
  if (
    k === "operational_range" ||
    k === "cruise_range" ||
    k === "environmental_operational_range" ||
    k === "range_on_land" ||
    k === "range_on_water" ||
    /operational range|cruise range|environmental operational range|range on (?:land|water)/i.test(
      lab,
    )
  )
    return "range.operational";
  if (
    k === "practical_range" ||
    k === "instrumented_range" ||
    /practical range|instrumented range/i.test(lab)
  )
    return "range.max";
  if (k === "combat_range" || /combat range/i.test(lab)) return "range.combat";
  if (k === "ferry_range" || /ferry range/i.test(lab)) return "range.ferry";
  if (k === "strike_range_high" || /strike range high/i.test(lab)) return "range.strike_high";
  if (k === "strike_range_low" || /strike range low/i.test(lab)) return "range.strike_low";
  if (k === "remote_control_range" || /remote control range/i.test(lab))
    return "range.remote_control";
  if (k === "ballistic_intercept_range" || /ballistic intercept range/i.test(lab))
    return "range.intercept_ballistic";
  if (k === "tbm_intercept_range" || /tbm intercept range/i.test(lab)) return "range.intercept_tbm";
  if (k === "max_range" || k === "maximum_range" || k === "range_max") return "range.max";
  if (k === "combat_radius" || /combat radius/i.test(lab)) return "range.combat_radius";
  if (
    k === "link_range" ||
    k === "control_range" ||
    k === "communication_range" ||
    k === "control_link_range" ||
    /link range|communication range|control link/i.test(lab)
  )
    return "range.link";
  if (
    k === "max_range" ||
    k === "maximum_range" ||
    (k === "range" && (lab === "" || /^range$/i.test(lab) || /max(?:imum)? range/i.test(lab)))
  )
    return "range.max";

  if (k === "dive_speed" || /\bdive\b/i.test(lab)) return "speed.dive";
  if (
    k === "max_speed" ||
    k === "speed_max" ||
    k === "top_speed" ||
    (k === "speed" && /\bmax(?:imum)?\b/i.test(lab))
  )
    return "speed.max";
  if (k === "cruise_speed" || k === "speed_cruise" || (k === "speed" && /\bcruise\b/i.test(lab)))
    return "speed.cruise";

  if (k === "service_ceiling" || /service ceiling/i.test(lab)) return "altitude.service_ceiling";
  if (k === "max_altitude" || (k === "altitude" && /\bmax(?:imum)?\b/i.test(lab)))
    return "altitude.max";
  if (k === "altitude" && /recommended/i.test(lab)) return "altitude.recommended";
  // A bare "altitude" is the airframe's own ceiling; a stated minimum keeps its own key.
  if (k === "altitude" && !/min(?:imum)?\b/i.test(lab)) return "altitude.max";

  if (k === "warhead" || (k === "payload" && /warhead/i.test(lab))) return "payload.warhead";
  if (k === "payload_mass" || /payload mass/i.test(lab)) return "payload.mass";
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
  if (
    k === "weight" ||
    k === "system_weight" ||
    k === "total_mass" ||
    k === "mass" ||
    k === "weight_gross" ||
    /(?:^|\\s)weight$|total mass/i.test(lab)
  )
    return "weight.total";

  if (k === "unit_cost" || k === "cost" || /unit cost|price/i.test(lab)) return "cost.unit";
  if (k === "endurance" || k === "flight_time" || /endurance|flight time/i.test(lab))
    return "endurance.flight";
  if (k === "guidance" || /guidance|navigation/i.test(lab)) return "guidance.system";
  if (k === "cameras" || /camera/i.test(lab)) return "sensor.camera.count";
  if (k === "jammers" || /jammer/i.test(lab)) return "ew.jammer.count";
  if (k === "missiles" || /missile/i.test(lab)) return "payload.missile.count";
  if (k === "engines" || /engine/i.test(lab)) return "propulsion.engine.count";
  if (k === "launchers" || /launcher/i.test(lab)) return "launcher.count";
  if (k === "rotors" || /rotor/i.test(lab)) return "propulsion.rotor.count";
  if (k === "antennas" || /antenna/i.test(lab)) return "sensor.antenna.count";
  if (k === "bombs" || /bomb/i.test(lab)) return "payload.bomb.count";

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
  if (k === "caliber" || /caliber|calibre/i.test(lab)) return "dimension.caliber";

  // Collapse long-tail variants of counter-drone envelopes to their family.
  if (k.startsWith("detection_range_")) return "range.detection";
  if (k.startsWith("engagement_range_")) return "range.engagement";

  return key;
}

export function canonicalUnitForSemantic(semantic: string): string | undefined {
  if (semantic.startsWith("dimension.")) return "m";
  if (semantic.startsWith("range.") || semantic.startsWith("altitude.")) return "km";
  if (semantic.startsWith("speed.")) return "km/h";
  if (semantic.startsWith("payload.") || semantic.startsWith("weight.")) return "kg";
  if (semantic.startsWith("endurance.")) return "min";
  if (semantic.startsWith("power.")) return "W";
  if (semantic === "capacity.fuel") return "l";
  return undefined;
}
