import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Drone, SpecClaim } from "@/entities/drone/types";
import { reviewClaim } from "@/entities/drone/claim-review";
import type { DocumentStore } from "@/shared/contracts/store";
import { LocalDroneRepository } from "@/shared/infra/storage/local-repository";
import { LocalStorageStore } from "@/shared/infra/storage/local-store";

const AT = "2026-10-21T00:00:00.000Z";

function claim(id: string, value: number): SpecClaim {
  return {
    id,
    value,
    source: `source-${id}`,
    date: "2026-10-01T00:00:00.000Z",
    evidence: `report ${id}`,
  };
}

function drone(): Drone {
  return {
    id: "revision-test",
    name: "Revision test",
    aliases: [],
    domain: "Air",
    origin: "SE",
    operators: [],
    propulsion: "Unknown",
    summary: "original",
    specs: [
      {
        key: "range",
        label: "Range",
        claims: [claim("a", 10), claim("b", 20)],
        discoveredBy: "seed",
      },
    ],
    rf: [],
    components: [],
    evolution: [],
    counterpartIds: [],
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

/**
 * Two repositories on one store is the shape of the bug: each holds a whole-collection
 * snapshot, and before revisions the second write replaced the first writer's document. The
 * first test proves both edits survive when the conflicting writer can reapply; the second
 * proves a writer that cannot reapply never overwrites the fresh copy.
 */
describe("repository revisions", () => {
  it("keeps both edits when a conflicting writer reapplies its change", async () => {
    const store = new LocalStorageStore();
    const base = drone();
    await store.seed("drones", [base]);

    const reviewer = new LocalDroneRepository();
    const editor = new LocalDroneRepository();
    await reviewer.attach(store);
    await editor.attach(store);

    const applyReview = (fresh: Drone): Drone =>
      reviewClaim(fresh, "range", base.specs[0]!.claims[0]!, {
        verdict: "confirmed",
        at: AT,
        by: "analyst",
      }) ?? fresh;
    const applySummary = (fresh: Drone): Drone => ({
      ...fresh,
      summary: "edited by the other tab",
    });

    reviewer.upsert(applyReview(base), applyReview);
    editor.upsert(applySummary(base), applySummary);

    await Promise.all([reviewer.flush(), editor.flush()]);

    const reloaded = new LocalDroneRepository();
    await reloaded.attach(store);
    const stored = reloaded.get(base.id)!;
    expect(stored.summary).toBe("edited by the other tab");
    expect(stored.specs[0]!.claims.find((c) => c.id === "a")!.review?.verdict).toBe("confirmed");
  });

  it("reloads instead of clobbering when the stale writer has no replay", async () => {
    const store = new LocalStorageStore();
    const base = drone();
    await store.seed("drones", [base]);

    const reviewer = new LocalDroneRepository();
    const stale = new LocalDroneRepository();
    await reviewer.attach(store);
    await stale.attach(store);

    // The reviewer wins the race first, so the second repository is now definitely stale.
    const applyReview = (fresh: Drone): Drone =>
      reviewClaim(fresh, "range", base.specs[0]!.claims[0]!, {
        verdict: "confirmed",
        at: AT,
        by: "analyst",
      }) ?? fresh;
    reviewer.upsert(applyReview(base), applyReview);
    await reviewer.flush();

    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnings: string[] = [];
    const off = stale.onStorageError((message) => warnings.push(message));
    stale.upsert({ ...base, summary: "stale edit" });
    await stale.flush();
    off();

    const reloaded = new LocalDroneRepository();
    await reloaded.attach(store);
    const stored = reloaded.get(base.id)!;
    expect(stored.summary).toBe(base.summary);
    expect(stored.specs[0]!.claims.find((c) => c.id === "a")!.review?.verdict).toBe("confirmed");
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("changed in another session"), "");
    expect(warnings[0]).toMatch(/changed in another session/);
  });

  it("reports a rejected write and restores the stored copy", async () => {
    const store = new LocalStorageStore();
    const base = drone();
    await store.seed("drones", [base]);
    const repo = new LocalDroneRepository();
    await repo.attach(store);

    const warnings: string[] = [];
    const off = repo.onStorageError((message) => warnings.push(message));
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });

    repo.upsert({ ...base, summary: "not saved" });
    await repo.flush();
    setItem.mockRestore();
    off();

    expect(warnings[0]).toMatch(/could not save drones\/revision-test/);
    // The optimistic edit must not stay in the UI after the write failed.
    expect(repo.get(base.id)!.summary).toBe(base.summary);
  });

  it("backfills legacy claim ids once and persists them", async () => {
    const store = new LocalStorageStore();
    const legacy = drone();
    legacy.specs[0]!.claims = legacy.specs[0]!.claims.map((c) => ({
      value: c.value,
      source: c.source,
      date: c.date,
      ...(c.evidence ? { evidence: c.evidence } : {}),
    }));
    await store.seed("drones", [legacy]);

    const repo = new LocalDroneRepository();
    await repo.attach(store);
    const loaded = repo.get(legacy.id)!;
    const ids = loaded.specs[0]!.claims.map((c) => c.id);
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
    await repo.flush();

    const reloaded = new LocalDroneRepository();
    await reloaded.attach(store);
    expect(reloaded.get(legacy.id)!.specs[0]!.claims.map((c) => c.id)).toEqual(ids);
  });

  it("stays on the old store when the new store cannot be loaded", async () => {
    const store = new LocalStorageStore();
    const base = drone();
    await store.seed("drones", [base]);
    const repo = new LocalDroneRepository();
    await repo.attach(store);

    const failing = {
      load: async () => {
        throw new Error("server unavailable");
      },
      seed: async () => {},
      put: async () => 0,
      remove: async () => {},
    } as unknown as DocumentStore;
    await expect(repo.attach(failing)).rejects.toThrow("server unavailable");

    const applySummary = (fresh: Drone): Drone => ({ ...fresh, summary: "still local" });
    repo.upsert(applySummary(repo.get(base.id)!), applySummary);
    await repo.flush();

    const reloaded = new LocalDroneRepository();
    await reloaded.attach(store);
    expect(reloaded.get(base.id)!.summary).toBe("still local");
  });

  it("runs a queued save as an update even when the caller deletes immediately after", async () => {
    const store = new LocalStorageStore();
    const base = drone();
    await store.seed("drones", [base]);
    const repo = new LocalDroneRepository();
    await repo.attach(store);
    const warnings: string[] = [];
    const off = repo.onStorageError((message) => warnings.push(message));

    // The save is still queued when the delete is requested. Dropping the revision upfront would
    // turn the save into an insert, collide with the stored document and report a bogus conflict.
    repo.upsert({ ...base, summary: "edited" });
    repo.remove(base.id);
    await repo.flush();
    off();

    expect(warnings).toEqual([]);
    expect(await store.load("drones")).toEqual([]);
  });
});
