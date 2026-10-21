import { describe, expect, it } from "vitest";
import { ACTIVE_SEED_DRONES, RETIRED_SEED_IDS, SEED_DRONES } from "@/entities/drone/seed";
import { LocalDroneRepository } from "@/shared/infra/storage/local-repository";
import type { Drone } from "@/entities/drone/types";
import type { DocumentStore } from "@/shared/contracts/store";

const drone = (id: string): Drone =>
  ({
    id,
    name: id,
    aliases: [],
    domain: "Land",
    origin: "SE",
    operators: [],
    propulsion: "Unknown",
    summary: "",
    specs: [],
    rf: [],
    components: [],
    evolution: [],
    counterpartIds: [],
    createdAt: "2026-10-11T00:00:00.000Z",
    updatedAt: "2026-10-11T00:00:00.000Z",
  }) as Drone;

/** In-memory store for the drones collection, so attach/remove/re-attach is a real reload. */
function storeFor() {
  let items: Drone[] | null = null;
  const revisions = new Map<string, number>();
  return {
    load: async () =>
      items ? items.map((doc) => ({ doc, rev: revisions.get(doc.id) ?? 0 })) : null,
    seed: async (_c: string, seeded: Drone[]) => {
      if (items === null) {
        items = [...seeded];
        for (const doc of seeded) revisions.set(doc.id, 0);
      }
    },
    put: async (_c: string, doc: Drone) => {
      items = [...(items ?? []).filter((d) => d.id !== doc.id), doc];
      const rev = (revisions.get(doc.id) ?? -1) + 1;
      revisions.set(doc.id, rev);
      return rev;
    },
    remove: async (_c: string, id: string) => {
      items = (items ?? []).filter((d) => d.id !== id);
      revisions.delete(id);
    },
  } as unknown as DocumentStore;
}

describe("seed hygiene", () => {
  it("gives every seeded system a unique id", () => {
    const ids = SEED_DRONES.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never seeds a retired id back", () => {
    // The counterpart of the sources test: bellingcat-news is absent from SEED_SOURCES because
    // an install that already stored it keeps polling it otherwise.
    for (const id of RETIRED_SEED_IDS) {
      expect(SEED_DRONES.map((d) => d.id)).not.toContain(id);
      expect(ACTIVE_SEED_DRONES.map((d) => d.id)).not.toContain(id);
    }
  });
});

describe("seeded systems survive an analyst's removal", () => {
  it("stays removed across a reload", async () => {
    // Regression: the repository used to re-add a hardcoded list of "late-seeded" ids on every
    // attach, so merging saab-giraffe-1x away and reloading the page brought it straight back,
    // and the catalog offered the same duplicate pair forever.
    const store = storeFor();
    const first = new LocalDroneRepository();
    await first.attach(store);
    expect(first.get("geran-2")).toBeDefined();

    first.remove("geran-2");
    await first.flush();
    expect(first.get("geran-2")).toBeUndefined();

    // A reload is a new repository instance attaching to the same store.
    const reloaded = new LocalDroneRepository();
    await reloaded.attach(store);
    expect(reloaded.get("geran-2")).toBeUndefined();
  });

  it("comes back only through the explicit Load-missing action", async () => {
    const store = storeFor();
    const first = new LocalDroneRepository();
    await first.attach(store);
    const seeded = new Set(SEED_DRONES.map((d) => d.id));
    first.remove("lancet-3");

    const added = first.addMissingDefaults();
    expect(added).toBe(1);
    expect(first.get("lancet-3")).toBeDefined();
    // Idempotent, and a second call reports nothing.
    expect(first.addMissingDefaults()).toBe(0);
    expect(seeded.has("lancet-3")).toBe(true);
  });

  it("never re-adds a retired id, however it left the catalog", async () => {
    const store = storeFor();
    const repo = new LocalDroneRepository();
    await repo.attach(store);
    // An install seeded before the retirement already has the duplicate: it merges it away.
    repo.upsert(drone("saab-giraffe-1x"));
    repo.remove("saab-giraffe-1x");
    repo.addMissingDefaults();
    expect(repo.get("saab-giraffe-1x")).toBeUndefined();
  });
});
