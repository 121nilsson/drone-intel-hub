import { describe, expect, it } from "vitest";
import { removalImpact, removeDrone, runTwoTier } from "@/features/intake/pipeline";
import type { IntelExtractor } from "@/shared/contracts/ai";
import type { DispatchRepository } from "@/shared/contracts/repository";
import type { RawDispatch } from "@/entities/dispatch/types";
import type { Candidate, Drone, Extraction } from "@/entities/drone/types";

const drone = (id: string, over: Partial<Drone> = {}): Drone => ({
  id,
  name: id,
  aliases: [],
  domain: "Air",
  origin: "UA",
  operators: [],
  propulsion: "Unknown",
  summary: "",
  specs: [],
  rf: [],
  components: [],
  evolution: [],
  counterpartIds: [],
  createdAt: "2026-10-10T00:00:00Z",
  updatedAt: "2026-10-10T00:00:00Z",
  ...over,
});

function deps(drones: Drone[], candidates: Candidate[], posts: RawDispatch[] = []) {
  const items = [...drones];
  const cands = [...candidates];
  return {
    drones: {
      list: () => items,
      get: (id: string) => items.find((d) => d.id === id),
      search: () => items,
      upsert: (d: Drone) => {
        const i = items.findIndex((x) => x.id === d.id);
        if (i >= 0) items[i] = d;
        else items.push(d);
      },
      remove: (id: string) => {
        const i = items.findIndex((x) => x.id === id);
        if (i >= 0) items.splice(i, 1);
      },
    },
    candidates: {
      list: () => cands,
      add: (c: Candidate) => void cands.push(c),
      update: (id: string, patch: Partial<Candidate>) => {
        const i = cands.findIndex((c) => c.id === id);
        if (i >= 0) cands[i] = { ...cands[i]!, ...patch };
      },
    },
    dispatches: {
      list: () => posts,
      update: (id: string, patch: Partial<RawDispatch>) => {
        const p = posts.find((x) => x.id === id);
        if (p) Object.assign(p, patch);
      },
    } as unknown as DispatchRepository,
    escalationThreshold: 0.6,
    autoMergeThreshold: 0.85,
    autoPromoteThreshold: 0.9,
  };
}

const candidate = (id: string, name: string, over: Partial<Candidate> = {}): Candidate => ({
  id,
  raw: "post",
  source: "Source · https://example.com",
  createdAt: "2026-10-10T00:00:00Z",
  tier: 2,
  extraction: {
    name,
    aliases: [],
    operators: [],
    specs: [],
    rfBands: [],
    confidence: 0.9,
    rationale: "",
  },
  status: "promoted",
  ...over,
});

describe("removeDrone", () => {
  const setup = () =>
    deps(
      [
        drone("ukrinform-444a", { name: "Ukrinform" }),
        drone("lancet", { counterpartIds: ["ukrinform-444a", "geran-2"] }),
        drone("lancet-3", { variantOfId: "ukrinform-444a", variantIds: ["ukrinform-444a"] }),
      ],
      [
        candidate("c1", "Ukrinform", { resolvedInto: "ukrinform-444a" }),
        candidate("c2", "Lancet", { resolvedInto: "lancet" }),
      ],
      [
        {
          id: "p1",
          sourceId: "s",
          sourceName: "Ukrinform (War)",
          externalId: "1",
          url: "https://example.com/1",
          text: "",
          createdAt: "2026-10-10T00:00:00Z",
          status: "processed",
          droneIds: ["ukrinform-444a", "lancet"],
        },
      ],
    );

  it("previews what it will touch without changing anything", () => {
    const d = setup();
    expect(removalImpact("ukrinform-444a", d)).toEqual({
      unlinked: 2,
      discarded: 1,
      dispatches: 1,
    });
    expect(d.drones.list()).toHaveLength(3);
  });

  it("removes the entry and everything pointing at it", () => {
    const d = setup();
    const report = removeDrone("ukrinform-444a", d);
    expect(report).toEqual({ unlinked: 2, discarded: 1, dispatches: 1 });
    expect(d.drones.get("ukrinform-444a")).toBeUndefined();
    expect(d.drones.get("lancet")!.counterpartIds).toEqual(["geran-2"]);
    const variant = d.drones.get("lancet-3")!;
    expect(variant.variantOfId).toBeUndefined();
    expect(variant.variantIds).toEqual([]);
    expect(d.candidates.list()[0]).toMatchObject({ status: "discarded", resolvedBy: "analyst" });
    // Untouched: a candidate for another system.
    expect(d.candidates.list()[1]!.status).toBe("promoted");
    expect(d.dispatches.list()[0]!.droneIds).toEqual(["lancet"]);
  });

  it("does nothing for an unknown id", () => {
    expect(removeDrone("nope", setup())).toBeUndefined();
  });

  it("keeps a deleted name out of the catalog when the next post names it", async () => {
    const d = setup();
    removeDrone("ukrinform-444a", d);
    const extractor: IntelExtractor = {
      tier: 1,
      label: "ai",
      extract: async () =>
        ({
          name: "Ukrinform",
          aliases: [],
          operators: [],
          specs: [],
          rfBands: [],
          systems: [{ name: "Ukrinform" }],
          confidence: 0.95,
          rationale: "",
        }) as Extraction,
    };
    // A different outlet, so only the analyst's earlier rejection can stop the promotion.
    const res = await runTwoTier("Ukrinform again.", "Other Outlet · https://o.example", {
      ...d,
      tier1: extractor,
      tier2: extractor,
    });
    expect(res.kind).toBe("queued");
    expect(d.drones.list().some((x) => x.name === "Ukrinform")).toBe(false);
  });
});
