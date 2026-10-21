import { describe, expect, it } from "vitest";
import type { Drone } from "@/entities/drone/types";
import { DocumentConflictError } from "@/shared/contracts/store";
import { PostgresStore } from "@/shared/infra/postgres/postgres-store.server";

const configured = !!process.env["DATABASE_URL"];

function drone(id: string, summary: string): Drone {
  const at = "2026-10-21T00:00:00.000Z";
  return {
    id,
    name: "Postgres revision test",
    aliases: [],
    domain: "Air",
    origin: "SE",
    operators: [],
    propulsion: "Unknown",
    summary,
    specs: [],
    rf: [],
    components: [],
    evolution: [],
    counterpartIds: [],
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * The conditional write is SQL, so it needs the real database to be trustworthy. Skipped when
 * no DATABASE_URL is configured; the localStorage tests cover the repository retry logic, this
 * covers the store-level compare-and-swap on its own.
 */
describe.skipIf(!configured)("PostgresStore revisions", () => {
  it("rejects stale and insert-only writes, and keeps the winner", async () => {
    const store = new PostgresStore();
    const id = `__rev_test_${crypto.randomUUID()}`;
    try {
      const base = drone(id, "original");
      expect(await store.put("drones", base, null)).toBe(0);

      const loaded = (await store.load("drones"))!.find((entry) => entry.doc.id === id);
      expect(loaded?.rev).toBe(0);

      expect(await store.put("drones", { ...base, summary: "first" }, 0)).toBe(1);

      await expect(store.put("drones", { ...base, summary: "stale" }, 0)).rejects.toBeInstanceOf(
        DocumentConflictError,
      );

      let stored = (await store.load("drones"))!.find((entry) => entry.doc.id === id);
      expect(stored?.rev).toBe(1);
      expect(stored?.doc.summary).toBe("first");

      // Insert-only against an existing row must not overwrite it.
      await expect(
        store.put("drones", { ...base, summary: "resurrect" }, null),
      ).rejects.toBeInstanceOf(DocumentConflictError);
      stored = (await store.load("drones"))!.find((entry) => entry.doc.id === id);
      expect(stored?.rev).toBe(1);
      expect(stored?.doc.summary).toBe("first");

      // Two writers that both read revision 1: exactly one may commit.
      const results = await Promise.allSettled([
        store.put("drones", { ...base, summary: "writer one" }, 1),
        store.put("drones", { ...base, summary: "writer two" }, 1),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((r) => r.status === "rejected");
      expect(rejected && rejected.status === "rejected" ? rejected.reason : null).toBeInstanceOf(
        DocumentConflictError,
      );

      stored = (await store.load("drones"))!.find((entry) => entry.doc.id === id);
      expect(stored?.rev).toBe(2);
      expect(["writer one", "writer two"]).toContain(stored?.doc.summary);
    } finally {
      await store.remove("drones", id);
    }
  });
});
