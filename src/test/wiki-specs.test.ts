import { describe, expect, it } from "vitest";
import { specsFromWikidataClaims, specsFromWikitext } from "@/shared/infra/wiki-specs";
import { applyReference } from "@/features/catalog/reference-import";
import type { Drone, ReferenceCard } from "@/entities/drone/types";

/** Excerpts shaped like the live articles (Oct 2026), trimmed to what the parser reads. */
const SHAHED = `{{Short description|Iranian loitering munition}}
{{Infobox weapon
| name = HESA Shahed 136
| type = [[Loitering munition]]
| weight = {{cvt|200|kg|lb}}<ref name="janes"/>
| length = {{cvt|3.5|m|ft}}
| wingspan = {{cvt|2.5|m|ft}}
| filling_weight = {{convert|50|kg}};<br>90 kg (Russia post 2024)<ref>{{Cite web|url=https://x.example|title=t}}</ref>
| engine = [[Limbach L550E|MD-550 piston engine]]
| vehicle_range = {{cvt|2500|km}}<ref name="janes"/>
| speed = Around {{cvt|185|km/h|mph}}
| guidance = [[Satellite navigation|GNSS]], [[Inertial navigation system|INS]]
}}
Body text.
{{Infobox weapon
| name = Shahed 238
| weight = {{cvt|380|kg}}
}}`;

const ORLAN = `{{Aircraft specs
|ref=<ref>Army Recognition</ref>
|crew=None
|capacity={{convert|6|kg|lb|abbr=on}} payload
|max takeoff weight kg=15
|max takeoff weight lb=
|max speed kmh=150
|endurance=16 hours
|combat range km=110
|ferry range km=600
|ceiling m=5000
|eng1 name=Saito Manufacturing FA-62B
}}`;

const TB2_UK = `{{Картка:БПЛА
| Повна назва = Bayraktar TB2
| Крейсерська швидкість = 130
| Максимальна швидкість = 222
| Практична стеля = 8200
| Довжина = 6,5
| Розмах крила = 12
| Максимальна злітна маса = 650
}}`;

const TB2_EN = `== Characteristics ==
The TB2 is a medium-altitude long-endurance drone with a composite airframe.

== Specifications (TB2) ==
=== General characteristics ===
* '''Length:''' {{convert|6.5|m|ftin|abbr=on}}
* '''Max. take-off mass:''' {{convert|700|kg|lb|-1|abbr=on}}
=== Performance ===
* '''Maximum speed:''' {{convert|120|kn|km/h|abbr=on}}
* '''Endurance:''' >20 hours
== Operators ==
* '''Range:''' 9999 km`;

const byKey = (specs: ReturnType<typeof specsFromWikitext>) =>
  Object.fromEntries(specs.map((s) => [s.key, s.value]));

describe("specsFromWikitext", () => {
  it("reads Infobox weapon, spelling out unit templates and dropping refs", () => {
    const specs = byKey(specsFromWikitext(SHAHED));
    expect(specs).toMatchObject({
      weight_launch: "200 kg",
      length: "3.5 m",
      wingspan: "2.5 m",
      warhead: "50 kg",
      engine: "MD-550 piston engine",
      range: "2500 km",
      speed: "~185 km/h",
      guidance: "GNSS, INS",
    });
  });

  it("keeps the template line as evidence", () => {
    const warhead = specsFromWikitext(SHAHED).find((s) => s.key === "warhead");
    expect(warhead?.evidence).toBe(
      "Infobox weapon: filling_weight = 50 kg; 90 kg (Russia post 2024)",
    );
  });

  it("ignores a second infobox of the same kind, which describes a variant", () => {
    expect(byKey(specsFromWikitext(SHAHED))["weight_launch"]).toBe("200 kg");
  });

  it("reads units from {{Aircraft specs}} parameter names, preferring metric", () => {
    expect(byKey(specsFromWikitext(ORLAN))).toMatchObject({
      payload: "6 kg",
      weight_mtow: "15 kg",
      max_speed: "150 km/h",
      endurance: "16 hours",
      combat_range: "110 km",
      ferry_range: "600 km",
      service_ceiling: "5000 m",
      engine: "Saito Manufacturing FA-62B",
    });
  });

  it("reads Ukrainian infobox fields, with default units and decimal commas", () => {
    expect(byKey(specsFromWikitext(TB2_UK))).toEqual({
      cruise_speed: "130 km/h",
      max_speed: "222 km/h",
      service_ceiling: "8200 m",
      length: "6.5 m",
      wingspan: "12 m",
      weight_mtow: "650 kg",
    });
  });

  it("reads a bulleted specifications section, skipping a prose one and stopping at the next", () => {
    expect(byKey(specsFromWikitext(TB2_EN))).toEqual({
      length: "6.5 m",
      weight_mtow: "700 kg",
      // Knots converted, so the metric figure is what the quantity parser reads.
      max_speed: "222 km/h",
      endurance: "more than 20 hours",
    });
  });

  it("finds nothing in an article without spec templates", () => {
    expect(specsFromWikitext("Just prose about a drone. {{Cite web|url=x}}")).toEqual([]);
  });
});

describe("specsFromWikidataClaims", () => {
  const quantity = (amount: string, unit: string, rank = "normal") => ({
    rank,
    mainsnak: {
      datavalue: { value: { amount, unit: `http://www.wikidata.org/entity/${unit}` } },
    },
  });

  it("reads quantity statements with known units and prefers a preferred rank", () => {
    const specs = specsFromWikidataClaims({
      P2050: [quantity("+2.5", "Q11573")],
      P2254: [quantity("+24000", "Q3710"), quantity("+18000", "Q3710", "preferred")],
      P2043: [quantity("+3.5", "Q99999")],
    });
    expect(Object.fromEntries(specs.map((s) => [s.key, s.value]))).toEqual({
      wingspan: "2.5 m",
      // Feet converted to metres, as for {{convert}}.
      max_altitude: "5486 m",
    });
  });
});

describe("applyReference with card specs", () => {
  const card = (over: Partial<ReferenceCard> = {}): ReferenceCard => ({
    wikidataId: "Q1",
    name: "Orlan-10",
    aliases: [],
    domain: "Air",
    origin: "RU",
    operators: ["RU"],
    summary: "Reconnaissance UAV.",
    lang: "en",
    title: "Orlan-10",
    revisionId: 7,
    url: "https://en.wikipedia.org/wiki/Orlan-10",
    specs: specsFromWikitext(ORLAN),
    ...over,
  });

  it("adds normalized specs to a new catalog entry, sourced to the article", () => {
    const report = applyReference([], [card()]);
    expect(report.specClaims).toBe(8);
    const [drone] = report.changed;
    const mtow = drone!.specs.find((s) => s.semantic === "weight.mtow");
    expect(mtow?.discoveredBy).toBe("seed");
    expect(mtow?.claims).toHaveLength(1);
    expect(mtow?.claims[0]).toMatchObject({
      source: "https://en.wikipedia.org/wiki/Orlan-10",
      extractionEngine: "reference",
      evidence: "Aircraft specs: max takeoff weight kg = 15",
    });
    const endurance = drone!.specs.find((s) => s.semantic === "endurance.flight");
    expect(endurance?.claims[0]?.normalized?.canonicalValue).toBe(960);
  });

  it("adds a claim beside an existing report instead of replacing it", () => {
    const existing = applyReference([], [card({ specs: [] })]).changed[0]!;
    const reported: Drone = {
      ...existing,
      specs: [
        {
          key: "weight_mtow",
          label: "MTOW",
          semantic: "weight.mtow",
          discoveredBy: "ai",
          claims: [{ value: "18 kg", source: "telegram", date: "2026-01-01" }],
        },
      ],
    };
    const next = applyReference([reported], [card()]).changed[0]!;
    const mtow = next.specs.find((s) => s.semantic === "weight.mtow")!;
    expect(mtow.discoveredBy).toBe("ai");
    expect(mtow.claims.map((c) => c.source)).toEqual([
      "telegram",
      "https://en.wikipedia.org/wiki/Orlan-10",
    ]);
  });

  it("does not add the same figures again on a re-import", () => {
    const first = applyReference([], [card()]).changed[0]!;
    const again = applyReference([first], [card()]);
    expect(again.changed).toEqual([]);
    expect(again.skipped).toBe(1);
  });
});
