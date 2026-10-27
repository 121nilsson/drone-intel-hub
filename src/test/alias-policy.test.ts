import { describe, expect, it } from "vitest";
import { aliasStem, cleanAliasList, isGenericAlias } from "@/entities/drone/alias-policy";
import { mergeDroneIntelligence } from "@/entities/drone/merge-intelligence";
import { promote } from "@/shared/infra/ingest/pipeline-actions";
import { resolveSystems } from "@/shared/infra/heuristic-ai";
import type { Candidate, Drone, Extraction } from "@/entities/drone/types";

const extraction = (over: Partial<Extraction> = {}): Extraction => ({
  aliases: [],
  operators: [],
  specs: [],
  rfBands: [],
  confidence: 0.7,
  rationale: "test",
  ...over,
});

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  id: "cand-1234",
  raw: "report text",
  source: "Test · https://example.com/a",
  createdAt: "2026-10-01T00:00:00.000Z",
  tier: 2,
  extraction: extraction(),
  status: "pending",
  ...over,
});

const drone = (id: string, over: Partial<Drone> = {}): Drone => ({
  id,
  name: id,
  aliases: [],
  domain: "Air",
  origin: "RU",
  operators: [],
  propulsion: "Unknown",
  summary: "",
  specs: [],
  rf: [],
  components: [],
  evolution: [],
  counterpartIds: [],
  createdAt: "",
  updatedAt: "",
  ...over,
});

describe("isGenericAlias", () => {
  it.each([
    "interceptor drones",
    "Interceptor Drones",
    "attack drones",
    "one-way attack drones",
    "cruise missile-drone",
    "loitering munitions",
    "unmanned aerial vehicles",
    "air defense systems",
    "drones",
    "FPV drones",
    "aerial targets",
  ])("bars a bare class phrase: %s", (alias) => {
    expect(isGenericAlias(alias)).toBe(true);
  });

  it.each([
    "Bars interceptor drones",
    "Clark Interceptor",
    "Shahed drones",
    "Shahed rockets",
    "Ukrainian Bars",
    'F7 "Litavr"',
    "БАРС",
    "Shahed-136",
    "Optoviolokno FPV",
  ])("keeps a distinctive alias: %s", (alias) => {
    expect(isGenericAlias(alias)).toBe(false);
  });

  it("exposes the stem a generic alias would lack", () => {
    expect(aliasStem("Bars interceptor drones")).toBe("bars");
    expect(aliasStem("interceptor drones")).toBe("");
  });
});

describe("cleanAliasList", () => {
  it("trims, de-duplicates case-insensitively, drops generic phrases and the entry's own name", () => {
    expect(
      cleanAliasList(
        [" Bars interceptor drones ", "interceptor drones", "BARS", "Bars", ""],
        "Bars",
      ),
    ).toEqual(["Bars interceptor drones"]);
  });
});

describe("mergeDroneIntelligence alias union obeys the policy", () => {
  it("does not accept a model-suggested generic alias", () => {
    const merged = mergeDroneIntelligence(
      drone("bars-b3ed", { name: "Bars", aliases: ["Ukrainian Bars"] }),
      extraction({ aliases: ["Bars interceptor drones", "interceptor drones"] }),
    );
    expect(merged.aliases).toEqual(["Ukrainian Bars", "Bars interceptor drones"]);
  });

  it("scrubs a generic alias already stored on the entry", () => {
    const merged = mergeDroneIntelligence(
      drone("bars-b3ed", {
        name: "Bars",
        aliases: ["interceptor drones", "Ukrainian Bars"],
      }),
      extraction({ aliases: [] }),
    );
    expect(merged.aliases).toEqual(["Ukrainian Bars"]);
  });
});

describe("promote stores cleaned aliases", () => {
  it("leaves a generic model suggestion out of the new catalog entry", () => {
    const stored: Drone[] = [];
    const deps = {
      drones: {
        list: () => stored,
        get: (id: string) => stored.find((d) => d.id === id),
        search: () => stored,
        remove: () => {},
        upsert: (d: Drone) => {
          const i = stored.findIndex((x) => x.id === d.id);
          if (i >= 0) stored[i] = d;
          else stored.push(d);
        },
      },
      candidates: {
        list: () => [],
        add: () => {},
        update: () => {},
      },
    };
    const c = candidate({
      extraction: extraction({
        name: "Bars",
        aliases: ["Bars interceptor drones", "interceptor drones"],
      }),
    });
    const created = promote(c, deps);
    expect(created.aliases).toEqual(["Bars interceptor drones"]);
  });
});

describe("resolveSystems ignores generic aliases at match time", () => {
  const catalog = [
    drone("bars-b3ed", {
      name: "Bars",
      aliases: ["interceptor drones", "Bars interceptor drones"],
    }),
  ];

  it("a stored generic phrase resolves nothing", () => {
    const hits = resolveSystems(
      "Ukraine already has interceptor drones capable of countering jets.",
      catalog,
    ).filter((s) => s.matchId === "bars-b3ed");
    expect(hits).toEqual([]);
  });

  it("the distinctive form still resolves the entry", () => {
    const hits = resolveSystems(
      "Ukraine already has Bars interceptor drones capable of countering jets.",
      catalog,
    ).filter((s) => s.matchId === "bars-b3ed");
    expect(hits).toEqual([{ name: "Bars", matchId: "bars-b3ed" }]);
  });
});
