import type {
  FlightProfile,
  RelationDisplayKind,
  RelationKind,
  SystemClass,
} from "@/entities/drone/types";

/**
 * How a relation reads from the entry being viewed, singular for one link and plural for the
 * group heading. Shared: the dossier, the families review and the graph name relations the same
 * way.
 */
export const RELATION_LABEL: Record<RelationDisplayKind, { one: string; many: string }> = {
  variant_of: { one: "Variant of", many: "Variant of" },
  has_variant: { one: "Variant", many: "Variants" },
  derived_from: { one: "Derived from", many: "Derived from" },
  parent_of: { one: "Derivative", many: "Derivatives" },
  subsystem_of: { one: "Subsystem of", many: "Subsystem of" },
  has_subsystem: { one: "Subsystem", many: "Subsystems" },
  effector_for: { one: "Effector for", many: "Effector for" },
  operates_effector: { one: "Effector", many: "Effectors" },
  carried_by: { one: "Carried by", many: "Carried by" },
  carries: { one: "Carries", many: "Carried equipment" },
  counterpart_to: { one: "Counterpart", many: "Counterparts" },
};

/** The kinds an analyst can store, in the order a link form offers them, with what each means. */
export const STORED_KIND_HINT: Record<RelationKind, string> = {
  variant_of: "a variant or block of a family or platform",
  derived_from: "a licensed copy, clone or redesign of an origin system",
  subsystem_of: "a radar, ground station, launcher or engine of a battery",
  effector_for: "a missile or munition fired by a launcher or complex",
  carried_by: "a pod, jammer or optronic ball mounted on a carrier",
  counterpart_to: "a peer or adversary counterpart",
};

export const FLIGHT_PROFILE_LABEL: Record<FlightProfile, string> = {
  ballistic: "Ballistic missile",
};

export const SYSTEM_CLASS_LABEL: Record<SystemClass, string> = {
  platform: "Platform",
  family: "Family",
  complex: "Complex",
  subsystem: "Subsystem",
  effector: "Effector",
  payload_ew: "Payload / EW",
};
