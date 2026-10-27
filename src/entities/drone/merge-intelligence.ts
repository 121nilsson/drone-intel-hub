import {
  type Drone,
  type Extraction,
  type PayloadObservation,
  type SensorObservation,
  type SupplyComponent,
  type OrganizationLink,
  organizationKey,
} from "./types";
import { cleanAliasList } from "./alias-policy";

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

function mergeOrganizationLinks(
  existing: OrganizationLink[] | undefined,
  incoming: OrganizationLink[] | undefined,
  now: string,
): OrganizationLink[] {
  const out: OrganizationLink[] = [...(existing ?? [])];
  const byId = new Map(out.map((link) => [`${link.organizationId}|${link.role}`, link]));
  for (const link of incoming ?? []) {
    const normalized: OrganizationLink = {
      ...link,
      organizationId: link.organizationId || organizationKey(link.name),
      name: link.name.trim(),
      firstSeen: link.firstSeen ?? now,
      lastSeen: now,
    };
    const key = `${normalized.organizationId}|${normalized.role}`;
    const current = byId.get(key);
    if (current) {
      current.name = current.name || normalized.name;
      if (normalized.country) current.country = current.country ?? normalized.country;
      // Do not overwrite established identity or evidence; only update recency on re-assertion.
      if (!link.firstSeen) current.lastSeen = now;
      const mergedConfidence = Math.max(current.confidence ?? 0, normalized.confidence ?? 0);
      if (mergedConfidence) current.confidence = mergedConfidence;
      if (!current.evidence && normalized.evidence) current.evidence = normalized.evidence;
      if (!current.source && normalized.source) current.source = normalized.source;
    } else {
      byId.set(key, { ...normalized, firstSeen: normalized.firstSeen ?? now });
      out.push(byId.get(key)!);
    }
  }
  return out;
}

/** Conservative enrichment: fill gaps and union observations; never replace established identity. */
export function mergeDroneIntelligence(
  drone: Drone,
  extraction: Extraction,
  sourceId?: string,
): Drone {
  // Alias union under the intake policy: generic class phrases ("interceptor drones") never
  // enter the identity, and ones that slipped in earlier are scrubbed on the next merge.
  const aliases = cleanAliasList([...drone.aliases, ...extraction.aliases], drone.name);
  const operators = [...new Set([...drone.operators, ...extraction.operators])];
  const now = new Date().toISOString();
  const incomingLinks = extraction.manufacturer
    ? [
        {
          organizationId: organizationKey(extraction.manufacturer),
          name: extraction.manufacturer,
          role: "manufacturer" as const,
          evidence: extraction.rationale,
          firstSeen: now,
          lastSeen: now,
        },
      ]
    : [];
  const organizationLinks = mergeOrganizationLinks(drone.organizationLinks, incomingLinks, now);
  return {
    ...drone,
    aliases,
    operators,
    ...(drone.manufacturer || !extraction.manufacturer
      ? {}
      : { manufacturer: extraction.manufacturer }),
    ...(organizationLinks.length ? { organizationLinks } : {}),

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
