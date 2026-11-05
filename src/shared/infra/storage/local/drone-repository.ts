import type { Drone } from "@/entities/drone/types";
import { ensureClaimIds } from "@/entities/drone/claim-review";
import { ACTIVE_SEED_DRONES, SEED_DRONES } from "@/entities/drone/seed";
import { effectiveInstallationId, effectivePropulsionId } from "@/entities/normalization/taxonomy";
import {
  detectProtocols,
  effectiveIeeeBands,
  effectiveNatoBands,
  linkIsFiber,
} from "@/entities/normalization/rf";
import type { CatalogFacets, DroneRepository } from "@/shared/contracts/repository";
import type { DocumentStore } from "@/shared/contracts/store";
import { CachedRepository } from "./cached-repository";

const norm = (s: string) => s.toLowerCase().normalize("NFKD");

export function droneHaystack(d: Drone) {
  return norm(
    [
      d.name,
      d.cyrillic ?? "",
      ...d.aliases,
      d.manufacturer ?? "",
      ...d.components.map((c) => `${c.manufacturer} ${c.part}`),
    ].join(" | "),
  );
}

export class LocalDroneRepository extends CachedRepository<"drones"> implements DroneRepository {
  constructor() {
    super("drones", SEED_DRONES);
  }
  /**
   * Backfill identities for catalogs written before `SpecClaim.id` existed. One write per affected
   * entry, immediately after load, so a review given later always has a stable key to refer to.
   */
  override async attach(store: DocumentStore) {
    await super.attach(store);
    const normalized = this.items.map((drone) => ensureClaimIds(drone));
    const changed = normalized.filter((drone, i) => drone !== this.items[i]);
    if (!changed.length) return;
    this.items = normalized;
    for (const drone of changed) this.save(drone);
  }
  get(id: string) {
    return this.items.find((d) => d.id === id);
  }
  upsert(drone: Drone, replay?: (fresh: Drone) => Drone) {
    const i = this.items.findIndex((d) => d.id === drone.id);
    this.items =
      i >= 0 ? this.items.map((d) => (d.id === drone.id ? drone : d)) : [...this.items, drone];
    this.save(drone, replay);
  }
  remove(id: string) {
    this.items = this.items.filter((d) => d.id !== id);
    this.drop(id);
  }
  /**
   * Seed entries the catalog does not have yet, the counterpart of the Sources page's "Load
   * default sources". Manual on purpose: an analyst who merged or deleted a seeded system
   * decided it does not belong, and no background process may put it back - an automatic
   * version of this once ran on every load and undid merges, resurrecting a merged-away
   * saab-giraffe-1x every time the page was reloaded.
   */
  addMissingDefaults(): number {
    const existingIds = new Set(this.items.map((d) => d.id));
    const missing = ACTIVE_SEED_DRONES.filter((d) => !existingIds.has(d.id));
    for (const d of missing) {
      this.items = [...this.items, d];
      this.save(d);
    }
    this.emit();
    return missing.length;
  }
  search(query: string, f: CatalogFacets = {}) {
    const q = norm(query.trim());
    return this.items.filter((d) => {
      if (q && !droneHaystack(d).includes(q)) return false;
      if (f.domains?.length && !f.domains.includes(d.domain)) return false;
      if (f.origin?.length && !f.origin.includes(d.origin)) return false;
      if (f.operators?.length && !d.operators.some((o) => f.operators!.includes(o))) return false;
      if (f.bands?.length && !d.rf.some((r) => f.bands!.includes(r.band))) return false;
      if (f.propulsion?.length && !f.propulsion.includes(d.propulsion)) return false;
      if (
        f.ieeeBands?.length &&
        !d.rf.some((r) => effectiveIeeeBands(r).some((b) => f.ieeeBands!.includes(b)))
      )
        return false;
      if (
        f.natoBands?.length &&
        !d.rf.some((r) => effectiveNatoBands(r).some((b) => f.natoBands!.includes(b)))
      )
        return false;
      if (f.propulsionIds?.length) {
        const id = effectivePropulsionId(d);
        if (!id || !f.propulsionIds.includes(id)) return false;
      }
      if (f.installationIds?.length) {
        const id = effectiveInstallationId(d);
        if (!id || !f.installationIds.includes(id)) return false;
      }
      if (
        f.protocols?.length &&
        !d.rf.some((r) => {
          const ids = r.protocols?.length
            ? r.protocols
            : detectProtocols(`${r.band} ${r.notes ?? ""}`);
          return ids.some((p) => f.protocols!.includes(p));
        })
      )
        return false;
      if (f.fiberOnly && !d.rf.some((r) => linkIsFiber(r))) return false;
      return true;
    });
  }
}
