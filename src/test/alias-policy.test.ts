import { describe, expect, it } from "vitest";
import {
  aliasFold,
  aliasLemma,
  aliasStem,
  cleanAliasList,
  isGenericAlias,
  pluralIdentities,
} from "@/entities/drone/alias-policy";
import { mergeDroneIntelligence } from "@/entities/drone/merge-intelligence";
import { migrateAliasList } from "@/entities/drone/alias-claims";
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

describe("aliasLemma", () => {
  it.each([
    ["Шахедів", "Шахед"],
    ["Шахедах", "Шахед"],
    ["Шахедами", "Шахед"],
    ["Шахедом", "Шахед"],
    ["Шахеды", "Шахед"],
    ["Шахеда", "Шахед"],
    ["Ланцетів", "Ланцет"],
    ["Ланцетом", "Ланцет"],
    ["Мавика", "Мавик"],
  ])("folds a declension to the stem: %s", (alias, lemma) => {
    expect(aliasLemma(alias)).toBe(lemma);
  });

  it.each(["Герань", "Ланцет", "Мавик", "Patriots", "F7 Litavr", "БАРС"])(
    "keeps a name that carries no case ending: %s",
    (alias) => {
      expect(aliasLemma(alias)).toBe(alias);
    },
  );

  it("never strips a short name into its ending", () => {
    expect(aliasLemma("Оса")).toBe("Оса");
    expect(aliasLemma("Осы")).toBe("Осы");
  });

  it("reads the Latin look-alike letters of a mixed-script alias as the Cyrillic they were", () => {
    // The live geran list carried "Шелахaх" (Latin a) beside the Cyrillic "Шелахах".
    expect(aliasLemma("Шелахaх")).toBe(aliasLemma("Шелахах"));
    expect(aliasFold("Шелахaх")).toBe(aliasFold("Шелахах"));
  });

  it("never strips the endings of an all-Latin alias through homoglyphs", () => {
    expect(aliasLemma("Panorama")).toBe("Panorama");
    expect(aliasLemma("Dream")).toBe("Dream");
  });
});

describe("aliasFold", () => {
  it("folds every declension of one name to one key", () => {
    const forms = new Set(["Шахед", "Шахедів", "Шахедах", "Шахедами", "Шахеда"].map(aliasFold));
    expect(forms.size).toBe(1);
  });
});

describe("pluralIdentities", () => {
  it("meets the folded plural from the bare singular and the reverse, through the t/s swap", () => {
    // phoneticText turns "ts" into "s", so folded "Patriots" stores "patrios".
    const plural = pluralIdentities("patrios");
    const singular = pluralIdentities("patriot");
    expect(plural).toContain("patriot");
    expect(singular).toContain("patrios");
  });
});

describe("mergeDroneIntelligence obeys the alias claim policy", () => {
  it("captures a model-suggested distinctive alias as a candidate, not an alias", () => {
    const merged = mergeDroneIntelligence(
      drone("bars-b3ed", { name: "Bars", aliases: ["Ukrainian Bars"] }),
      extraction({ aliases: ["Bars interceptor drones", "interceptor drones"] }),
    );
    // The legacy list migrated to claims on first merge; the new suggestion is unapproved.
    expect(merged.aliases).toEqual(["Ukrainian Bars"]);
    const candidate = merged.aliasClaims!.find((c) => c.alias === "Bars interceptor drones");
    expect(candidate).toMatchObject({ status: "candidate" });
    expect(candidate?.kind).toBeUndefined();
    expect(
      merged.aliasClaims!.find((c) => isGenericAlias(c.alias) && c.status !== "rejected"),
    ).toBeUndefined();
    expect(merged.aliasClaims!.some((c) => c.alias === "Ukrainian Bars")).toBe(true);
  });

  it("scrubs a generic alias already stored on the entry when it migrates", () => {
    const merged = mergeDroneIntelligence(
      drone("bars-b3ed", {
        name: "Bars",
        aliases: ["interceptor drones", "Ukrainian Bars"],
      }),
      extraction({ aliases: [] }),
    );
    expect(merged.aliases).toEqual(["Ukrainian Bars"]);
    expect(merged.aliasClaims!.map((c) => c.alias)).toEqual(["Ukrainian Bars"]);
  });

  it("records where a suggestion came from", () => {
    const merged = mergeDroneIntelligence(
      drone("bars-b3ed", { name: "Bars" }),
      extraction({ aliases: ["F7 Litavr"] }),
      "dispatch-42",
      { source: "Defence Blog · https://defence-blog.com/x", sourceCandidateId: "cand-9" },
    );
    expect(merged.aliasClaims![0]).toMatchObject({
      source: "Defence Blog · https://defence-blog.com/x",
      sourceId: "dispatch-42",
      sourceCandidateId: "cand-9",
      status: "candidate",
    });
  });
});

describe("promote stores alias claims, awaiting approval", () => {
  it("keeps a model suggestion out of the new entry's aliases but on record", () => {
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
    expect(created.aliases).toEqual([]);
    const claims = created.aliasClaims!;
    expect(claims.map((x) => x.alias)).toEqual(["Bars interceptor drones"]);
    expect(claims[0]).toMatchObject({
      status: "candidate",
      source: "Test · https://example.com/a",
      sourceCandidateId: "cand-1234",
    });
  });

  it("flags a suggested alias that is another entry's canonical identity", () => {
    const stored: Drone[] = [drone("osа-x1", { name: "Osa", aliases: [] })];
    const deps = {
      drones: {
        list: () => stored,
        get: (id: string) => stored.find((c) => c.id === id),
        search: () => stored,
        remove: () => {},
        upsert: (d: Drone) => {
          const i = stored.findIndex((x) => x.id === d.id);
          if (i >= 0) stored[i] = d;
          else stored.push(d);
        },
      },
      candidates: { list: () => [], add: () => {}, update: () => {} },
    };
    const c = candidate({
      extraction: extraction({ name: "Puma", aliases: ["Osa", "Interceptor"] }),
    });
    const created = promote(c, deps);
    const claim = created.aliasClaims!.find((x) => x.alias === "Osa");
    expect(claim?.conflictWithDroneIds).toEqual(["osа-x1"]);
    const generic = created.aliasClaims!.find((x) => x.alias === "Interceptor");
    expect(generic).toBeUndefined();
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
