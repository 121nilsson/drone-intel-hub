import { describe, expect, it } from "vitest";
import { mentionsPhonetic, phoneticKey } from "@/entities/drone/name-key";
import { duplicateGroups } from "@/entities/drone/duplicates";
import { resolveSystems } from "@/shared/infra/heuristic-ai";
import type { Drone } from "@/entities/drone/types";

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

describe("phoneticKey", () => {
  it.each([
    ["Ланцет-3", "Lancet-3"],
    ["Герань-2", "Geran-2"],
    ["Шахед-136", "Shahed 136"],
    ["Мавик 3", "Mavic 3"],
    ["Баба Яга", "Baba Yaga"],
    ["Молния", "Molniya"],
    ["Лютий", "Liutyi"],
    ["Лютый", "Lyutyi"],
    ["Вампир", "Vampire"],
  ])("%s and %s share a key", (a, b) => {
    expect(phoneticKey(a)).toBe(phoneticKey(b));
  });

  it("keeps different variants apart", () => {
    expect(phoneticKey("Shahed-136")).not.toBe(phoneticKey("Shahed-238"));
    expect(phoneticKey("Lancet-3")).not.toBe(phoneticKey("Lancet-3M"));
  });
});

describe("mentionsPhonetic", () => {
  it.each([
    ["запуск Ланцет-3 под Херсоном", "Lancet-3", true],
    ["Шахеды летят на Киев", "Shahed", true],
    ["удар Ланцетом по позиции", "Lancet", true],
    ["сбиты три Герани", "Geran", true],
    ["Lancet-3M spotted near Kherson", "Lancet-3", false],
    ["the Lancet medical journal", "Lancet-3", false],
    ["an Orion drone", "Orlan", false],
  ])("%s / %s -> %s", (text, name, want) => {
    expect(mentionsPhonetic(text, name)).toBe(want);
  });

  it("ignores names too short to be distinctive once folded", () => {
    expect(mentionsPhonetic("К-3 и Ka-3", "Ka3")).toBe(false);
  });
});

describe("resolveSystems across scripts", () => {
  const catalog = [drone("lancet-3", { name: "Lancet-3" }), drone("geran-2", { name: "Geran-2" })];

  it("matches a Cyrillic mention to the catalog entry without proposing a new system", () => {
    expect(resolveSystems("ВС РФ применили Ланцет-3 и Герань-2.", catalog)).toEqual([
      { name: "Lancet-3", matchId: "lancet-3" },
      { name: "Geran-2", matchId: "geran-2" },
    ]);
  });

  it("recognises a Cyrillic variant designation as a variant of the catalog entry", () => {
    const systems = resolveSystems("Замечен новый Ланцет-4 под Курском.", catalog);
    expect(systems).toContainEqual({ name: "Ланцет-4", variantOf: "lancet-3" });
  });
});

describe("duplicateGroups", () => {
  const ids = (groups: ReturnType<typeof duplicateGroups>) => groups.map((g) => g.ids.sort());

  it("groups the same name in another script", () => {
    const groups = duplicateGroups([
      drone("lancet-3", { name: "Lancet-3" }),
      drone("lantset-3", { name: "Ланцет-3" }),
      drone("orlan-10", { name: "Orlan-10" }),
    ]);
    expect(ids(groups)).toEqual([["lancet-3", "lantset-3"]]);
    expect(groups[0]!.reasons).toEqual(["same name in another spelling"]);
  });

  it("groups a name that is another entry's alias, but not two entries sharing an alias", () => {
    const groups = duplicateGroups([
      drone("shahed-136", { name: "Shahed-136", aliases: ["Geran-2", "Shahed"] }),
      drone("geran-2", { name: "Geran-2" }),
      drone("shahed-238", { name: "Shahed-238", aliases: ["Shahed"] }),
    ]);
    expect(ids(groups)).toEqual([["geran-2", "shahed-136"]]);
  });

  it("groups entries that point at the same Wikidata item", () => {
    const ref = (wikidataId: string) => ({
      wikidataId,
      alsoIds: [],
      lang: "en" as const,
      title: "t",
      revisionId: 1,
      url: "u",
      license: "CC BY-SA 4.0" as const,
      importedAt: "",
    });
    const groups = duplicateGroups([
      drone("a", { name: "Orion", reference: ref("Q1") }),
      drone("b", { name: "Inokhodets", reference: ref("Q1") }),
    ]);
    expect(groups[0]!.reasons).toEqual(["same Wikidata item (Q1)"]);
  });

  it("groups the same name in bare singular and plural", () => {
    const groups = duplicateGroups([
      drone("patriot-97a5", { name: "Patriot" }),
      drone("patriots-c7da", { name: "Patriots" }),
    ]);
    expect(ids(groups)).toEqual([["patriot-97a5", "patriots-c7da"]]);
    expect(groups[0]!.reasons).toEqual(["same name differing only in plural"]);
  });

  it("matches an alias to a name once its category tail is set aside", () => {
    const groups = duplicateGroups([
      drone("patriot-97a5", { name: "Patriot" }),
      drone("plural-card", { name: "Patriots", aliases: ["Patriot systems"] }),
    ]);
    expect(ids(groups)).toEqual([["patriot-97a5", "plural-card"]]);
    expect(groups[0]!.reasons).toContain("same name differing only in plural");
  });

  it("does not group a generic alias with anything", () => {
    expect(
      duplicateGroups([drone("bars-b3ed", { name: "Bars", aliases: ["interceptor drones"] })]),
    ).toEqual([]);
  });
});
