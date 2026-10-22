import type { Candidate, Drone, Extraction } from "@/entities/drone/types";
import type { PipelineDeps } from "./pipeline-types";
import {
  applyNormalization,
  linkVariantReplay,
  withCounterparts,
  withNormalizedRf,
} from "./pipeline-internal";
import { counterpartIdsFor, linkCounterparts } from "@/entities/drone/relations";
import { linkVariant, mergeDroneIntelligence } from "@/entities/drone/merge-intelligence";
import { mergeSpecs } from "@/entities/drone/spec-engine";
import { organizationKey } from "@/entities/drone/types";
import { toRFLink } from "@/entities/normalization/apply";

export function promote(
  c: Candidate,
  d: Pick<PipelineDeps, "drones" | "candidates">,
  nameOverride?: string,
): Drone {
  const e = applyNormalization(c.extraction).extraction;
  const name =
    nameOverride?.trim() ||
    e.name ||
    `Uncataloged ${e.domain ?? "system"} ${c.id.slice(0, 4).toUpperCase()}`;
  const now = new Date().toISOString();
  const base: Drone = {
    id:
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") +
      "-" +
      c.id.slice(0, 4),
    name,
    aliases: e.aliases,
    domain: e.domain ?? "Multi",
    origin: e.origin ?? "??",
    ...(e.manufacturer
      ? {
          manufacturer: e.manufacturer,
          organizationLinks: [
            {
              organizationId: organizationKey(e.manufacturer),
              name: e.manufacturer,
              role: "manufacturer",
              source: c.source,
              firstSeen: now,
              lastSeen: now,
            },
          ],
        }
      : {}),
    operators: e.operators,
    propulsion: e.propulsion ?? "Unknown",
    ...(e.propulsionId ? { propulsionId: e.propulsionId } : {}),
    ...(e.installation?.trim() ? { installation: e.installation.trim() } : {}),
    ...(e.installationId ? { installationId: e.installationId } : {}),
    summary: c.raw.slice(0, 200),
    specs: [],
    rf: (e.rf ?? []).map(toRFLink),
    components: e.components ?? [],
    ...(e.payloads?.length ? { payloads: e.payloads } : {}),
    ...(e.sensors?.length ? { sensors: e.sensors } : {}),
    evolution: [
      { date: now, kind: "other", description: "Promoted from intake queue", source: c.source },
    ],
    counterpartIds: [],
    createdAt: now,
    updatedAt: now,
  };
  const drone = mergeSpecs(base, e.specs, c.source);
  d.drones.upsert(drone);
  // A promoted system often arrives alongside ones already catalogued ("Shahed-136 seen
  // with Geran-2"), so seed its relations from the same systems[] the auto-merge path uses.
  const catalog = d.drones.list();
  const counterpartIds = counterpartIdsFor(e, catalog, drone.id);
  const changed = linkCounterparts(drone, counterpartIds, catalog);
  for (const c2 of changed) {
    const gained = c2.id === drone.id ? counterpartIds : [drone.id];
    d.drones.upsert(c2, (fresh) =>
      withCounterparts(
        fresh,
        gained.filter((id) => id !== fresh.id && d.drones.get(id)),
      ),
    );
  }
  const variantOf = e.systems?.find((s) => s.name.toLowerCase() === name.toLowerCase())?.variantOf;
  if (variantOf) {
    const parent = d.drones.get(variantOf);
    const child = d.drones.get(drone.id);
    if (parent && child) {
      for (const linked of linkVariant(parent, child))
        d.drones.upsert(linked, (fresh) => linkVariantReplay(fresh, parent.id, child.id, d.drones));
    }
  }
  d.candidates.update(c.id, { status: "promoted", resolvedInto: drone.id });
  // Return the linked version so callers don't hold a stale copy without counterpartIds.
  return changed.find((x) => x.id === drone.id) ?? drone;
}

export function mergeInto(
  c: Candidate,
  droneId: string,
  d: Pick<PipelineDeps, "drones" | "candidates">,
) {
  const target = d.drones.get(droneId);
  if (!target) return;
  const extracted = applyNormalization(c.extraction).extraction;
  const applyMerge = (base: Drone) => {
    const merged = mergeDroneIntelligence(
      withNormalizedRf(
        mergeSpecs(base, extracted.specs, c.source, {
          extractionConfidence: extracted.confidence,
        }),
        extracted,
      ),
      extracted,
    );
    merged.evolution = [
      ...merged.evolution,
      {
        date: new Date().toISOString(),
        kind: "other",
        description: `Merged intake: ${c.extraction.rationale}`,
        source: c.source,
      },
    ];
    return merged;
  };
  d.drones.upsert(applyMerge(target), applyMerge);
  d.candidates.update(c.id, { status: "merged", resolvedInto: droneId });
}
export function recordMention(
  c: Candidate,
  droneId: string,
  d: Pick<PipelineDeps, "drones" | "candidates">,
): Drone | undefined {
  const target = d.drones.get(droneId);
  if (!target) return undefined;
  const now = new Date().toISOString();
  const apply = (fresh: Drone): Drone => {
    const already = fresh.evolution.some(
      (e) => e.date === now && e.kind === "mention" && e.source === c.source,
    );
    if (already) return fresh;
    return {
      ...fresh,
      evolution: [
        ...fresh.evolution,
        {
          date: now,
          kind: "mention" as const,
          description: "Mentioned in source: " + (c.source || "unknown source"),
          source: c.source,
        },
      ],
      updatedAt: now,
    };
  };
  const recorded = apply(target);
  d.drones.upsert(recorded, apply);
  d.candidates.update(c.id, { status: "merged", resolvedInto: droneId, resolvedBy: "analyst" });
  return recorded;
}
