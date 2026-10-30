import { describe, expect, it } from "vitest";
import { mentionsPhonetic } from "@/entities/drone/name-key";
import { isFamilyAlias } from "@/entities/drone/alias-policy";
import { addManualAlias, intakeAliasClaims } from "@/entities/drone/alias-claims";
import { detectNames, resolveSystems } from "@/shared/infra/heuristics/names";
import type { Drone } from "@/entities/drone/types";

const d = (id: string, name: string, aliases: string[] = []) =>
  ({ id, name, aliases, specs: [] }) as unknown as Drone;

describe("a designation's variant letter is identity", () => {
  it("F-35A does not match its siblings or the family", () => {
    expect(mentionsPhonetic("The F-35B lands vertically", "F-35A")).toBe(false);
    expect(mentionsPhonetic("The F-35C flies from carriers", "F-35A")).toBe(false);
    expect(mentionsPhonetic("The F-35 is a stealth fighter", "F-35A")).toBe(false);
    expect(mentionsPhonetic("Two F-35A jets", "F-35A")).toBe(true);
    expect(mentionsPhonetic("Norway's F-35As arrived", "F-35A")).toBe(true);
  });

  it("keeps the case-ending bridge for words", () => {
    expect(mentionsPhonetic("Удар Ланцетом по позиции", "Lancet")).toBe(true);
    expect(mentionsPhonetic("Lancet-3M seen", "Lancet-3")).toBe(false);
  });

  it("files lettered siblings under their own designation, not under F-16", () => {
    const catalog = [d("f-16", "F-16"), d("f-35a", "F-35A")];
    expect(resolveSystems("The F-35B lands vertically.", catalog)).toEqual([
      { name: "F-35B", variantOf: "f-35a" },
    ]);
    expect(resolveSystems("The F-35 is a stealth fighter.", catalog)).toEqual([
      { name: "F-35", variantOf: "f-35a" },
    ]);
    expect(resolveSystems("An F-15 took off.", catalog)).toEqual([{ name: "F-15" }]);
  });

  it("still links numbered variants with a real stem", () => {
    expect(resolveSystems("An Orlan-30 was downed.", [d("orlan-10", "Orlan-10")])).toEqual([
      { name: "Orlan-30", variantOf: "orlan-10" },
    ]);
    expect(resolveSystems("A Lancet-3M struck.", [d("lancet-3", "Lancet-3")])).toEqual([
      { name: "Lancet-3M", variantOf: "lancet-3" },
    ]);
  });
});

describe("names with a Roman numeral", () => {
  it("keeps the numeral with the name", () => {
    expect(detectNames("The Lightning II entered service.")).toEqual(["Lightning II"]);
    expect(detectNames("A new Reaper III flew.")).toContain("Reaper III");
  });
});

describe("family aliases", () => {
  it("recognises the designation without its variant letter", () => {
    expect(isFamilyAlias("F-35", ["F-35A"])).toBe(true);
    expect(isFamilyAlias("F-35s", ["F-35A"])).toBe(true);
    expect(isFamilyAlias("F-35", ["F-35A Lightning II"])).toBe(true);
    expect(isFamilyAlias("F-35A Lightning II", ["F-35A"])).toBe(false);
    expect(isFamilyAlias("F-35", ["F-16"])).toBe(false);
    expect(isFamilyAlias("Orlan", ["Orlan-10"])).toBe(false);
  });

  it("is never taken in, by intake or by hand", () => {
    const f35a = d("f-35a", "F-35A");
    const at = "2026-10-29T00:00:00Z";
    const taken = intakeAliasClaims(f35a, ["F-35", "F-35A Lightning II"], { at });
    expect(taken.aliasClaims?.map((c) => c.alias)).toEqual(["F-35A Lightning II"]);
    expect(addManualAlias(f35a, "F-35", at)).toBeUndefined();
  });

  it("no longer resolves a report through an alias stored before the guard", () => {
    const catalog = [d("f-35a", "F-35A", ["F-35", "F-35A Lightning II"])];
    expect(resolveSystems("The F-35 fleet grew.", catalog).some((s) => s.matchId)).toBe(false);
    expect(resolveSystems("An F-35A Lightning II landed.", catalog)[0]).toMatchObject({
      matchId: "f-35a",
    });
  });
});
