import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { LocalStorageStore } from "@/shared/infra/local-store";

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
    await s.put("drones", drone("b"));
    expect((await s.load("drones"))!.map((d) => d.id)).toEqual(["b", "a"]);
    await s.put("drones", drone("a"));
    expect(await s.load("drones")).toHaveLength(2);
  });

  it("removes by id", async () => {
    const s = new LocalStorageStore();
    await s.seed("drones", [drone("a"), drone("b")]);
    await s.remove("drones", "a");
    expect((await s.load("drones"))!.map((d) => d.id)).toEqual(["b"]);
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
});
