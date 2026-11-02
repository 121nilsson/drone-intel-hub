import { repairDrone, type RepairKind } from "@/entities/drone/repair";
import { legacyRelationsToMigrate } from "@/entities/drone/system-hierarchy";
import type { Drone, SpecAttribute, SpecClaim } from "@/entities/drone/types";
import { narrowLinks } from "@/entities/procurement/linking";
import { procurementsFromStoredSpec } from "@/entities/procurement/routing";
import type {
  DispatchRepository,
  DroneRepository,
  ProcurementRepository,
} from "@/shared/contracts/repository";

/**
 * Applies today's reading rules to the stored catalog (entities/drone/repair.ts), so a fix at
 * the ingest boundary reaches old records too. Deterministic and free, like auto-correct, and a
 * no-op once the catalog matches the rules - safe to run after every sync.
 *
 * `apply: false` is the preview: the same report, nothing written. That is how a new rule's
 * effect on old data is read before it is let loose on it.
 */

export interface RepairEntry {
  droneId: string;
  name: string;
  kind: RepairKind | "procurement" | "links" | "relations";
  detail: string;
}

export interface CatalogRepairReport {
  /** Entries whose stored record changes. */
  drones: number;
  /** Procurement records filed from deal figures that were stored as specs. */
  procurementsAdded: number;
  /** Procurement records whose system links were narrowed to the ones their text names. */
  linksNarrowed: number;
  entries: RepairEntry[];
}

const amountKey = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

export function repairCatalog(
  drones: DroneRepository,
  procurements: ProcurementRepository,
  opts: {
    apply?: boolean;
    now?: number;
    /** The archived posts, for when a claim's post was published. */
    dispatches?: Pick<DispatchRepository, "list">;
  } = {},
): CatalogRepairReport {
  const apply = opts.apply !== false;
  const at = new Date(opts.now ?? Date.now()).toISOString();
  const rep: CatalogRepairReport = {
    drones: 0,
    procurementsAdded: 0,
    linksNarrowed: 0,
    entries: [],
  };

  // A deal the pipeline already filed from the same post: same post, same figure.
  const filed = new Set(
    procurements.list().map((p) => `${p.sourceId ?? p.source}|${amountKey(p.amount)}`),
  );
  const file = (drone: Drone, spec: SpecAttribute) => {
    for (const p of procurementsFromStoredSpec(drone, spec, at)) {
      const key = `${p.sourceId ?? p.source}|${amountKey(p.amount)}`;
      if (filed.has(key)) continue;
      filed.add(key);
      rep.procurementsAdded++;
      rep.entries.push({
        droneId: drone.id,
        name: drone.name,
        kind: "procurement",
        detail: `${p.amount} from ${p.source}`,
      });
      if (apply) procurements.add(p);
    }
  };

  const published = new Map(
    (opts.dispatches?.list() ?? []).flatMap((p) => (p.publishedAt ? [[p.id, p.publishedAt]] : [])),
  );
  const publishedFor = (c: SpecClaim) => (c.sourceId ? published.get(c.sourceId) : undefined);
  // Entries whose stored record changes, each once whatever changed in it.
  const changed = new Set<string>();
  for (const drone of drones.list()) {
    const r = repairDrone(drone, publishedFor);
    if (!r.changes.length) continue;
    changed.add(drone.id);
    for (const c of r.changes) rep.entries.push({ droneId: drone.id, name: drone.name, ...c });
    for (const s of r.financial) file(drone, s);
    if (!apply) continue;
    drones.upsert({ ...r.drone, updatedAt: at }, (fresh) => {
      // Another writer won the race: repair what it stored, filing any deal figure it holds.
      const again = repairDrone(fresh, publishedFor);
      for (const s of again.financial) file(fresh, s);
      return again.changes.length ? { ...again.drone, updatedAt: at } : fresh;
    });
  }

  // The legacy links, copied into typed relations; the legacy fields stay for the readers that
  // still use them, and system-hierarchy.ts reads both until they are retired.
  for (const [droneId, add] of legacyRelationsToMigrate(drones.list(), at)) {
    const drone = drones.get(droneId);
    if (!drone) continue;
    changed.add(droneId);
    for (const r of add)
      rep.entries.push({
        droneId,
        name: drone.name,
        kind: "relations",
        detail: `${r.kind} → ${r.targetSystemId} (from the legacy link)`,
      });
    if (!apply) continue;
    const merge = (fresh: Drone): Drone => {
      const have = new Set((fresh.relations ?? []).map((r) => `${r.targetSystemId}|${r.kind}`));
      const missing = add.filter((r) => !have.has(`${r.targetSystemId}|${r.kind}`));
      return missing.length
        ? { ...fresh, relations: [...(fresh.relations ?? []), ...missing], updatedAt: at }
        : fresh;
    };
    drones.upsert(merge(drone), merge);
  }

  rep.drones = changed.size;

  const byId = new Map(drones.list().map((d) => [d.id, d]));
  const systemFor = (id: string) => {
    const d = byId.get(id);
    return d ? { name: d.name, id: d.id, aliases: d.aliases } : undefined;
  };
  for (const p of procurements.list()) {
    const next = narrowLinks(p, systemFor);
    if (!next) continue;
    rep.linksNarrowed++;
    rep.entries.push({
      droneId: "",
      name: p.company,
      kind: "links",
      detail: `${p.amount ?? "deal"}: ${(p.systemNames ?? []).join(", ")} → ${(next.systemNames ?? []).join(", ")} (${p.systemIds?.length ?? 0} → ${next.systemIds?.length ?? 0} linked entries)`,
    });
    if (apply) procurements.update(next, (fresh) => narrowLinks(fresh, systemFor) ?? fresh);
  }
  return rep;
}
