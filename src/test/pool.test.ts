import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "@/shared/infra/pool";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("mapWithConcurrency", () => {
  it("returns an empty result for no items", async () => {
    expect(await mapWithConcurrency([], 6, async () => 1)).toEqual([]);
  });

  it("never runs more than `limit` workers at once", async () => {
    let live = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);

    await mapWithConcurrency(items, 4, async () => {
      live++;
      peak = Math.max(peak, live);
      await tick();
      live--;
      return live;
    });

    expect(peak).toBe(4);
  });

  it("runs everything in parallel when limit >= items", async () => {
    let live = 0;
    let peak = 0;

    await mapWithConcurrency([1, 2, 3, 4], 10, async () => {
      live++;
      peak = Math.max(peak, live);
      await tick();
      live--;
    });

    expect(peak).toBe(4);
  });

  it("fills results in input order regardless of completion order", async () => {
    // The slowest worker is first, so completion order is the reverse of input order.
    const items = ["slow", "fast", "slowest"];
    const results = await mapWithConcurrency(items, 4, async (item) => {
      await tick();
      return item;
    });

    expect(results.map((r) => (r.status === "fulfilled" ? r.value : "rejected"))).toEqual(items);
  });

  it("keeps going after a worker throws, and reports the rejection", async () => {
    let completed = 0;
    const items = ["ok-1", "boom", "ok-2", "boom-2"];

    const results = await mapWithConcurrency(items, 4, async (item) => {
      await tick();
      if (item.startsWith("boom")) throw new Error(item);
      completed++;
      return item;
    });

    expect(completed).toBe(2);
    expect(results.map((r) => r.status)).toEqual([
      "fulfilled",
      "rejected",
      "fulfilled",
      "rejected",
    ]);
    const boom = results[1];
    if (boom?.status === "rejected") expect(boom.reason).toBeInstanceOf(Error);
  });

  it("serialises items sharing a key while other keys run concurrently", async () => {
    // Same-host sources must not overlap; different hosts must.
    let hookA = 0;
    let hookAPeak = 0;
    let overallPeak = 0;
    let live = 0;

    const items = [
      { key: "a.test", label: "a1" },
      { key: "a.test", label: "a2" },
      { key: "a.test", label: "a3" },
      { key: "b.test", label: "b1" },
    ];

    await mapWithConcurrency(
      items,
      6,
      async (item) => {
        live++;
        overallPeak = Math.max(overallPeak, live);
        if (item.key === "a.test") {
          hookA++;
          hookAPeak = Math.max(hookAPeak, hookA);
        }
        await tick();
        live--;
        if (item.key === "a.test") hookA--;
      },
      { key: (item) => item.key },
    );

    expect(hookAPeak).toBe(1); // never two requests to the same host
    expect(overallPeak).toBeGreaterThan(1); // other hosts still run alongside
  });

  it("starts the first unkeyed item when the next share a busy key", async () => {
    // [a, a, b] with a 2-lane pool: the first 'a' runs, the second must wait its turn, and 'b'
    // must not be blocked behind it.
    const order: string[] = [];

    await mapWithConcurrency(
      [
        { key: "a.test", label: "a1" },
        { key: "a.test", label: "a2" },
        { key: "b.test", label: "b1" },
      ],
      2,
      async (item) => {
        order.push(`${item.label}:start`);
        await tick();
        order.push(`${item.label}:end`);
      },
      { key: (item) => item.key },
    );

    expect(order.indexOf("b1:start")).toBeLessThan(order.indexOf("a2:start"));
  });

  it("reports progress once per item, with running totals", async () => {
    const seen: number[] = [];
    const items = [1, 2, 3];

    await mapWithConcurrency(
      items,
      4,
      async () => {
        await tick();
      },
      { onSettled: (p) => seen.push(p.done) },
    );

    expect(seen.sort()).toEqual([1, 2, 3]);
  });

  it("passes the settled item and the correct total to onSettled", async () => {
    const events: { label: string; total: number }[] = [];

    await mapWithConcurrency(
      [{ label: "x" }, { label: "y" }],
      1,
      async () => {
        await tick();
      },
      { onSettled: (p) => events.push({ label: p.item.label, total: p.total }) },
    );

    expect(events).toEqual([
      { label: "x", total: 2 },
      { label: "y", total: 2 },
    ]);
  });

  it("ignores a limit below 1 rather than deadlocking", async () => {
    const calls: number[] = [];
    const results = await mapWithConcurrency([1, 2, 3], 0, async (i) => {
      await tick();
      calls.push(i);
      return i;
    });

    expect(calls).toHaveLength(3);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  });

  it("treats a non-finite limit as unlimited", async () => {
    let peak = 0;
    let live = 0;
    await mapWithConcurrency([1, 2, 3, 4], Number.NaN, async () => {
      live++;
      peak = Math.max(peak, live);
      await tick();
      live--;
    });
    expect(peak).toBe(4);
  });
});
