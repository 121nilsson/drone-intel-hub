import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Drone } from "@/entities/drone/types";
import { RemoteStore } from "@/shared/infra/storage/remote-store";

const { storeLoadPage } = vi.hoisted(() => ({ storeLoadPage: vi.fn() }));

vi.mock("@/shared/infra/storage/store.functions", () => ({
  storeLoadPage,
  storeSeed: vi.fn(),
  storePut: vi.fn(),
  storeRemove: vi.fn(),
  storeClaim: vi.fn(),
  storeRelease: vi.fn(),
}));

const drone = (id: string) => ({ id }) as Drone;

describe("RemoteStore.load", () => {
  beforeEach(() => storeLoadPage.mockReset());

  it("walks bounded pages instead of asking the transport for the whole catalog", async () => {
    storeLoadPage
      .mockResolvedValueOnce(
        JSON.stringify({
          initialized: true,
          items: [{ doc: drone("a"), rev: 1 }],
          hasMore: true,
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          initialized: true,
          items: [{ doc: drone("b"), rev: 2 }],
          hasMore: false,
        }),
      );

    const loaded = await new RemoteStore().load("drones");
    expect(loaded).toEqual([
      { doc: drone("a"), rev: 1 },
      { doc: drone("b"), rev: 2 },
    ]);
    expect(storeLoadPage).toHaveBeenNthCalledWith(1, { data: { c: "drones", offset: 0 } });
    expect(storeLoadPage).toHaveBeenNthCalledWith(2, { data: { c: "drones", offset: 1 } });
  });

  it("keeps one copy when an insert shifts a page boundary", async () => {
    storeLoadPage
      .mockResolvedValueOnce(
        JSON.stringify({
          initialized: true,
          items: [{ doc: drone("a"), rev: 1 }],
          hasMore: true,
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          initialized: true,
          items: [
            { doc: drone("a"), rev: 1 },
            { doc: drone("b"), rev: 2 },
          ],
          hasMore: false,
        }),
      );

    await expect(new RemoteStore().load("drones")).resolves.toEqual([
      { doc: drone("a"), rev: 1 },
      { doc: drone("b"), rev: 2 },
    ]);
  });

  it("keeps null as an uninitialised collection rather than an empty catalog", async () => {
    storeLoadPage.mockResolvedValue(
      JSON.stringify({ initialized: false, items: [], hasMore: false }),
    );
    await expect(new RemoteStore().load("sources")).resolves.toBeNull();
  });

  it("refuses a page that claims more data but makes no progress", async () => {
    storeLoadPage.mockResolvedValue(
      JSON.stringify({ initialized: true, items: [], hasMore: true }),
    );
    await expect(new RemoteStore().load("candidates")).rejects.toThrow(/made no progress/);
  });
});
