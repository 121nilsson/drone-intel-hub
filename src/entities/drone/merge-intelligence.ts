import type {
  Drone,
  Extraction,
  PayloadObservation,
  SensorObservation,
  SupplyComponent,
} from "./types";

const norm = (s: string) => s.trim().toLowerCase();

function uniqueBy<T>(current: T[], incoming: T[], key: (value: T) => string): T[] {
  const out = [...current];
  const seen = new Set(current.map(key));
  for (const value of incoming) {
    const id = key(value);
    if (!seen.has(id)) {
      seen.add(id);
      out.push(value);
    }
  }
  return out;
}

function components(
  current: SupplyComponent[],
  incoming: SupplyComponent[],
  sourceId?: string,
): SupplyComponent[] {
  return uniqueBy(
    current,
    incoming.map((c) => ({ ...c, ...(sourceId && !c.sourceId ? { sourceId } : {}) })),
    (c) => `${norm(c.part)}|${norm(c.manufacturer)}|${norm(c.model ?? "")}`,
  );
}

function payloads(
  current: PayloadObservation[],
  incoming: PayloadObservation[],
  sourceId?: string,
): PayloadObservation[] {
  return uniqueBy(
    current,
    incoming.map((p) => ({ ...p, ...(sourceId && !p.sourceId ? { sourceId } : {}) })),
    (p) => `${norm(p.name)}|${p.weightKg ?? ""}|${p.quantity ?? ""}`,
  );
}

function sensors(
  current: SensorObservation[],
  incoming: SensorObservation[],
  sourceId?: string,
): SensorObservation[] {
  return uniqueBy(
    current,
    incoming.map((s) => ({ ...s, ...(sourceId && !s.sourceId ? { sourceId } : {}) })),
    (s) => `${s.category}|${norm(s.name)}|${norm(s.model ?? "")}`,
  );
}

/** Conservative enrichment: fill gaps and union observations; never replace established identity. */
export function mergeDroneIntelligence(
  drone: Drone,
  extraction: Extraction,
  sourceId?: string,
): Drone {
  const aliases = [...new Set([...drone.aliases, ...extraction.aliases])].filter(
    (a) => norm(a) !== norm(drone.name),
  );
  const operators = [...new Set([...drone.operators, ...extraction.operators])];
  return {
    ...drone,
    aliases,
    operators,
    ...(drone.manufacturer || !extraction.manufacturer
      ? {}
      : { manufacturer: extraction.manufacturer }),
    ...((drone.propulsion && drone.propulsion !== "Unknown") || !extraction.propulsion
      ? {}
      : { propulsion: extraction.propulsion }),
    ...(drone.installation || !extraction.installation
      ? {}
      : { installation: extraction.installation }),
    components: components(drone.components, extraction.components ?? [], sourceId),
    payloads: payloads(drone.payloads ?? [], extraction.payloads ?? [], sourceId),
    sensors: sensors(drone.sensors ?? [], extraction.sensors ?? [], sourceId),
    updatedAt: new Date().toISOString(),
  };
}

export function linkVariant(parent: Drone, child: Drone): [Drone, Drone] {
  if (parent.id === child.id) return [parent, child];
  const now = new Date().toISOString();
  return [
    {
      ...parent,
      variantIds: [...new Set([...(parent.variantIds ?? []), child.id])],
      updatedAt: now,
    },
    { ...child, variantOfId: parent.id, updatedAt: now },
  ];
}
