import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { DocumentConflictError } from "@/shared/contracts/store";
import { LocalStorageStore } from "@/shared/infra/storage/local-store";

const KEY = "dti.drones.v1";

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

const drone = (id: string) => ({ id, name: id }) as never;
const docs = (loaded: { doc: { id: string } }[] | null) => loaded?.map((entry) => entry.doc);

describe("LocalStorageStore", () => {
  it("returns null when a collection has never been written", async () => {
    expect(await new LocalStorageStore().load("drones")).toBeNull();
  });

  it("round-trips a collection", async () => {
    const s = new LocalStorageStore();
    await s.seed("drones", [drone("a"), drone("b")]);
    expect(await s.load("drones")).toHaveLength(2);
  });

  it("upserts by id and prepends new documents", async () => {
    const s = new LocalStorageStore();
    await s.seed("drones", [drone("a")]);
    await s.put("drones", drone("b"), null);
    expect(docs(await s.load("drones"))!.map((d) => d.id)).toEqual(["b", "a"]);
    await s.put("drones", drone("a"), 0);
    expect(await s.load("drones")).toHaveLength(2);
  });

  it("removes by id", async () => {
    const s = new LocalStorageStore();
    await s.seed("drones", [drone("a"), drone("b")]);
    await s.remove("drones", "a");
    expect(docs(await s.load("drones"))!.map((d) => d.id)).toEqual(["b"]);
  });

  it("carries the revision from one store instance to the next", async () => {
    const first = new LocalStorageStore();
    await first.seed("drones", [drone("a")]);
    expect(await first.put("drones", drone("a"), 0)).toBe(1);

    const second = new LocalStorageStore();
    const loaded = await second.load("drones");
    expect(loaded![0]!.rev).toBe(1);
    expect(await second.put("drones", drone("a"), 1)).toBe(2);
  });

  it("rejects a write based on a stale revision", async () => {
    const s = new LocalStorageStore();
    await s.seed("drones", [drone("a")]);
    await s.put("drones", drone("a"), 0);

    await expect(s.put("drones", drone("a"), 0)).rejects.toBeInstanceOf(DocumentConflictError);
    // The stale write must not have replaced the stored copy.
    expect((await s.load("drones"))![0]!.rev).toBe(1);
  });

  it("rejects an insert-only write when the document already exists", async () => {
    const s = new LocalStorageStore();
    await s.seed("drones", [drone("a")]);
    await expect(s.put("drones", drone("a"), null)).rejects.toBeInstanceOf(DocumentConflictError);
  });

  it("rejects a conditional update when the document is gone", async () => {
    const s = new LocalStorageStore();
    await s.seed("drones", [drone("a")]);
    await s.remove("drones", "a");
    await expect(s.put("drones", drone("a"), 0)).rejects.toBeInstanceOf(DocumentConflictError);
  });

  it("treats data written before revisions existed as revision 0", async () => {
    localStorage.setItem(KEY, JSON.stringify([drone("a")]));
    const loaded = await new LocalStorageStore().load("drones");
    expect(loaded![0]!.rev).toBe(0);
  });

  // Regression: read() swallowed JSON.parse errors and returned null, which attach() reads as
  // "never initialised" - so one corrupt byte silently reseeded and wiped the user's catalog.
  it("backs up unparseable content instead of silently discarding it", async () => {
    localStorage.setItem(KEY, "{ this is not json");
    const s = new LocalStorageStore();

    const loaded = await s.load("drones");

    // null is what triggers a reseed; the original must survive under the backup key.
    expect(loaded).toBeNull();
    expect(localStorage.getItem(`${KEY}.corrupt`)).toBe("{ this is not json");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(KEY));
  });

  it("treats a non-array JSON value as corrupt", async () => {
    localStorage.setItem(KEY, '{"not":"an array"}');
    expect(await new LocalStorageStore().load("drones")).toBeNull();
    expect(localStorage.getItem(`${KEY}.corrupt`)).toBe('{"not":"an array"}');
  });

  it("does not overwrite an existing backup with a second failure", async () => {
    localStorage.setItem(`${KEY}.corrupt`, "the good earlier value");
    localStorage.setItem(KEY, "garbage one");
    await new LocalStorageStore().load("drones");
    expect(localStorage.getItem(`${KEY}.corrupt`)).toBe("the good earlier value");
  });

  it("does not touch a healthy collection", async () => {
    localStorage.setItem(KEY, JSON.stringify([drone("a")]));
    const loaded = await new LocalStorageStore().load("drones");
    expect(loaded).toHaveLength(1);
    expect(localStorage.getItem(`${KEY}.corrupt`)).toBeNull();
  });

  it("rejects a write the browser refuses instead of reporting a successful save", async () => {
    const s = new LocalStorageStore();
    await s.seed("drones", [drone("a")]);
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });

    await expect(s.put("drones", drone("a"), 0)).rejects.toThrow(
      /browser storage could not save revisions for drones/,
    );

    setItem.mockRestore();
    const loaded = await s.load("drones");
    expect(loaded![0]!.rev).toBe(0);
  });

  it("keeps unreadable data in place when it cannot make a backup", async () => {
    localStorage.setItem(KEY, "garbage that must survive");
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });

    // Returning null would trigger a reseed and overwrite the only copy.
    await expect(new LocalStorageStore().load("drones")).rejects.toThrow(/could not back up/);

    setItem.mockRestore();
    expect(localStorage.getItem(KEY)).toBe("garbage that must survive");
  });
});
