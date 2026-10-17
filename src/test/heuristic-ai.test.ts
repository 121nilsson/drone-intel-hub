import { describe, expect, it } from "vitest";
import {
  HeuristicExtractor,
  detectNames,
  extractPrice,
  extractUnitPrice,
  mentions,
  resolveSystems,
} from "@/shared/infra/heuristic-ai";
import type { Drone, ExtractedSpec } from "@/entities/drone/types";
import { parseMoneyRange } from "@/entities/normalization/currency";

const drone = (id: string, over: Partial<Drone> = {}): Drone => ({
  id,
  name: id,
  aliases: [],
  domain: "Air",
  origin: "IR",
  operators: [],
  propulsion: "Unknown",
  summary: "",
  specs: [],
  rf: [],
  components: [],
  evolution: [],
  counterpartIds: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

const CATALOG = [
  drone("shahed-136", { name: "Shahed-136", aliases: ["MShahed"] }),
  drone("geran-2", { name: "Geran-2", cyrillic: "Герань-2", aliases: ["GEHANG"] }),
];

const t1 = new HeuristicExtractor(1);
const specOf = (e: ExtractedSpec[], key: string) => e.find((s) => s.key === key)?.value;

describe("mentions", () => {
  it("matches a full designation", () => {
    expect(mentions("a Geran-2 launch", "Geran-2")).toBe(true);
  });

  // The whole point of the token-boundary regex: variant numbers must not cross-match.
  it("does not match a different variant", () => {
    expect(mentions("a Geran-5 launch", "Geran-2")).toBe(false);
    expect(mentions("a Geran-25 launch", "Geran-2")).toBe(false);
  });

  it("matches Cyrillic names", () => {
    expect(mentions("поражена цель Герань-2", "Герань-2")).toBe(true);
  });

  it("ignores names too short to be meaningful", () => {
    expect(mentions("a B unit", "B")).toBe(false);
  });
});

describe("detectNames", () => {
  it("finds quoted designations", () => {
    expect(detectNames(`launched "Geran-5" today`)).toContain("Geran-5");
  });

  it("finds model designations", () => {
    expect(detectNames("a new Shahed-238 was seen")).toContain("Shahed-238");
  });

  it("does not split a designation from a bare stem", () => {
    // "Geran" alone is dropped in favour of the fuller "Geran-5".
    expect(detectNames("Geran-5 launched")).not.toContain("Geran");
  });

  it("ignores stop words", () => {
    expect(detectNames("The Russians reported it")).not.toContain("The");
  });

  it("does not read a headline's words as names", () => {
    // Regression: one press-release headline ("AKINCI STRIKES WITH SUPERSONIC UAV-300
    // MISSILE!") named a munition as a system, promoted it into the catalog, and had its
    // adjectives absorbed into the designation.
    expect(detectNames("AKINCI STRIKES WITH SUPERSONIC UAV-300 MISSILE!")).toEqual(["UAV-300"]);
  });

  it("still reads names in body prose beside a designation", () => {
    const names = detectNames("The AKINCI carried the UAV-300 missile");
    expect(names).toContain("AKINCI");
    expect(names).toContain("UAV-300");
  });
});

describe("extractPrice", () => {
  it("reads a dollar range", () => {
    expect(extractPrice("unit cost $15,000-$20,000 each")).toBe("$15,000 - $20,000");
  });

  it("reads a currency with a magnitude suffix", () => {
    expect(extractPrice("around $2,000 per airframe")).toContain("2,000");
  });

  it("reads euros", () => {
    expect(extractPrice("procurement at €50k per unit")).toContain("50k");
  });

  it("reads a spelled-out currency", () => {
    expect(extractPrice("cost estimate $30,000")).toContain("30,000");
  });

  it("returns undefined when there is no price", () => {
    expect(extractPrice("a drone was seen near Kharkiv")).toBeUndefined();
  });

  it("normalizes a price range without collapsing it", () => {
    expect(parseMoneyRange("$15,000-$20,000")).toMatchObject({
      min: 15000,
      max: 20000,
      currency: "USD",
    });
  });

  it("keeps a spelled-out billion instead of dropping it", () => {
    // Regression: "$2 billion" matched "$2" and the magnitude vanished, so the Akash dossier
    // carried a unit price of $2 from a sentence about $2 billion of contracts.
    expect(extractPrice("costs $2 billion per unit")).toBe("$2 billion");
    expect(extractPrice("costs $2bn each")).toBe("$2bn");
    expect(extractPrice("costs $2b each")).toBe("$2b");
    expect(extractPrice("2 billion USD per unit")).toBe("2 billion USD");
  });
});

describe("extractUnitPrice", () => {
  it("reads a per-unit price and keeps the sentence as its evidence", () => {
    const p = extractUnitPrice("The Akash missile costs $2 million per unit, officials said.");
    expect(p?.value).toBe("$2 million");
    expect(p?.evidence).toContain("per unit");
  });

  it("refuses a programme total - the case that put $2 on the Akash dossier", () => {
    expect(
      extractUnitPrice(
        "In fact, Armenia has emerged as India’s largest buyer of military equipment, signing defense contracts worth nearly $2 billion since 2020, according to reports. Its purchases include multiple-launch rocket systems, counter-drone systems and anti-tank missiles.",
      ),
    ).toBeUndefined();
  });

  it("refuses money with no price cue at all", () => {
    expect(extractUnitPrice("the strike destroyed $3 million of equipment")).toBeUndefined();
    expect(extractUnitPrice("operators received $5 million in funding last year")).toBeUndefined();
  });

  it("refuses a clause describing a total even when it names a price", () => {
    expect(extractUnitPrice("the $2 billion contract was signed in March")).toBeUndefined();
    expect(extractUnitPrice("a deal worth $30 million was announced")).toBeUndefined();
  });

  it("reads a real price in a post that also mentions totals", () => {
    const p = extractUnitPrice(
      "India signed a $2 billion agreement with Armenia. The Akash launcher costs about $4 million apiece.",
    );
    expect(p?.value).toBe("$4 million");
    expect(p?.evidence).toContain("apiece");
  });

  it("returns undefined for a post with no money", () => {
    expect(extractUnitPrice("a drone was seen near Kharkiv")).toBeUndefined();
  });
});

describe("price magnitudes across languages", () => {
  // Each case is about the magnitude surviving the parse, not about the exact word: the
  // Ukrainian soft sign and the double-l spelling both appear in the wild, so the assertions
  // match the word's shape rather than its bytes.
  it("keeps an English billion", () => {
    expect(extractPrice("costs $2 billion per unit")).toBe("$2 billion");
  });

  it("keeps a Russian billion and million", () => {
    expect(extractPrice("цена $2 млрд")).toMatch(/^\$2 млрд$/);
    expect(extractPrice("стоимость $2,5 млн")).toMatch(/^\$2,5 млн$/);
  });

  it("keeps a Ukrainian billion, either spelling", () => {
    expect(extractPrice("вартість $2 мільярда")).toMatch(/^\$2 міл.+рд\p{L}*$/u);
  });

  it("keeps a Swedish billion and million", () => {
    // The ordering hazard this guards: a bare latin "m" would match the first letter of
    // "miljard" and read 2 million instead of 2 billion.
    expect(extractPrice("kostar $2 miljarder")).toBe("$2 miljarder");
    expect(extractPrice("kostar $2 miljoner")).toBe("$2 miljoner");
  });

  it("keeps the magnitude on a real unit price with a Ukrainian price cue", () => {
    const p = extractUnitPrice("Вартість одного комплексу становить $1,04 мільярда.");
    expect(p?.value).toMatch(/^\$1,04 міл.+рд\p{L}*$/u);
    expect(p?.evidence).toContain("Вартість");
  });
});

describe("resolveSystems", () => {
  it("matches a catalog entry exactly", () => {
    const s = resolveSystems("two Geran-2 units", CATALOG);
    expect(s).toContainEqual({ name: "Geran-2", matchId: "geran-2" });
  });

  it("marks a new variant as variantOf its parent", () => {
    const s = resolveSystems("a Geran-5 appeared", CATALOG);
    expect(s).toContainEqual({ name: "Geran-5", variantOf: "geran-2" });
  });

  it("returns nothing for text with no systems", () => {
    expect(resolveSystems("nothing of interest here", CATALOG)).toEqual([]);
  });

  it("does not match a catalog alias that is a Cyrillic calendar word (Starlink → Lyutyi)", () => {
    // Live data: "Февраль" (February) sat as a Lyutyi alias and auto-merged a Starlink-restriction
    // post that only used the word in its calendar sense.
    const lyutyi = drone("lyutyi", {
      name: "FP-1 / Lyutyi",
      cyrillic: "Лютий",
      aliases: ["Liutyi", "AN-196", "Лютый", "Февраль"],
    });
    expect(resolveSystems("Февраль потерял связь с терминалами Starlink", [lyutyi])).toEqual([]);
  });
});

describe("HeuristicExtractor number parsing", () => {
  // Regression: `parseFloat(s.replace(",", "."))` swapped only the first comma, so "1,234"
  // parsed as 1.234 and a 1,000 km range was stored as 1 km.
  it("reads a thousands-separated speed", async () => {
    const e = await t1.extract("Cruise 1,234 km/h reported", CATALOG);
    expect(specOf(e.specs, "speed")).toBe(1234);
  });

  it("reads a thousands-separated range", async () => {
    const e = await t1.extract("range 2,000 km", CATALOG);
    expect(specOf(e.specs, "range")).toBe(2000);
  });
  it("still reads a plain integer", async () => {
    const e = await t1.extract("Cruise 600 km/h", CATALOG);
    expect(specOf(e.specs, "speed")).toBe(600);
  });

  it("reads a decimal comma as a decimal point", async () => {
    const e = await t1.extract("Cruise 1,5 km/h", CATALOG);
    expect(specOf(e.specs, "speed")).toBe(1.5);
  });

  it("reads a decimal point", async () => {
    const e = await t1.extract("Cruise 2.35 km/h", CATALOG);
    expect(specOf(e.specs, "speed")).toBe(2.35);
  });

  it("does not mistake a leading-zero decimal for grouping", async () => {
    // "0,500" is European decimal 0.5; a grouped number never starts with a zero.
    const e = await t1.extract("Cruise 0,500 km/h", CATALOG);
    expect(specOf(e.specs, "speed")).toBe(0.5);
  });
});

describe("multi-system attribution (characterization)", () => {
  // Current contract: facts are attributed per system from the clauses that NAME it, splitting
  // at sentence boundaries only. These pins keep that semantics visible — tighten matching
  // (per-fact disambiguation) only with new pins alongside, never silently.

  it("gives a shared sentence's numbers to both systems named in it", async () => {
    const e = await t1.extract(
      "The Shahed-136 flew with range 1,500 km while the Geran-2 carried a 50 kg warhead.",
      CATALOG,
    );
    const shahed = e.systemExtractions!.find((s) => s.name === "Shahed-136")!;
    const geran = e.systemExtractions!.find((s) => s.name === "Geran-2")!;
    expect(shahed.specs.some((s) => s.key === "range" && s.value === 1500)).toBe(true);
    expect(geran.specs.some((s) => s.key === "warhead" && s.value === 50)).toBe(true);
    // The rough edge, pinned: each system's view also carries the other one's values.
    expect(shahed.specs.some((s) => s.key === "warhead")).toBe(true);
    expect(geran.specs.some((s) => s.key === "range")).toBe(true);
  });

  it("attributes a number only to the system named in its own clause", async () => {
    const e = await t1.extract(
      "Shahed-136 flew with range 1,500 km. The Geran-2 has range 800 km. Both launched overnight.",
      CATALOG,
    );
    const shahed = e.systemExtractions!.find((s) => s.name === "Shahed-136")!;
    const geran = e.systemExtractions!.find((s) => s.name === "Geran-2")!;
    expect(shahed.specs.some((s) => s.key === "range" && s.value === 1500)).toBe(true);
    expect(shahed.specs.some((s) => s.key === "range" && s.value === 800)).toBe(false);
    expect(geran.specs.some((s) => s.key === "range" && s.value === 800)).toBe(true);
    expect(geran.specs.some((s) => s.key === "range" && s.value === 1500)).toBe(false);
  });

  it("keeps facts outside every named system's clauses on the whole-text extraction only", async () => {
    // The fiber-spool clause names neither system, so the per-system views have nothing there;
    // the whole-text specs keep it.
    const e = await t1.extract(
      "The Shahed-136 was seen over Sumy while the Geran-2 was recovered. The launcher paid out 30 km of fiber spool.",
      CATALOG,
    );
    expect(specOf(e.specs, "fiber_spool")).toBe(30);
    for (const s of e.systemExtractions!)
      expect(s.specs.find((x) => x.key === "fiber_spool")).toBeUndefined();
  });
});

describe("HeuristicExtractor extraction", () => {
  it("counts repeated nouns", async () => {
    const e = await t1.extract("fitted with 4 jammers and 2 antennas", CATALOG);
    expect(specOf(e.specs, "jammers")).toBe(4);
    expect(specOf(e.specs, "antennas")).toBe(2);
  });

  it("does not read a designation's number as a quantity", async () => {
    // Regression: "UAV-300 MISSILE" read as 300 missiles, so AKINCI's dossier carried a
    // "Number of missiles: 300" spec out of one press-release headline.
    const e = await t1.extract("AKINCI STRIKES WITH SUPERSONIC UAV-300 MISSILE!", CATALOG);
    expect(e.specs.find((s) => s.key === "missiles")).toBeUndefined();
    expect(e.payloads).toEqual([]);
  });

  it("still counts real quantities of munitions", async () => {
    const e = await t1.extract("The UAV carries 4 missiles and 2 bombs", CATALOG);
    expect(specOf(e.specs, "missiles")).toBe(4);
    expect(specOf(e.specs, "bombs")).toBe(2);
  });

  it("keeps counting nouns when a designation shares the sentence", async () => {
    const e = await t1.extract("The UAV-300 carries 6 missiles", CATALOG);
    expect(specOf(e.specs, "missiles")).toBe(6);
  });

  it("picks up RF bands", async () => {
    const e = await t1.extract("operating on 900 MHz with CRPA", CATALOG);
    expect(e.rfBands).toContain("900 MHZ");
    expect(e.rfBands).toContain("CRPA");
  });

  it("infers domain", async () => {
    expect((await t1.extract("a USV launch", CATALOG)).domain).toBe("Sea");
    expect((await t1.extract("a UGV on tracks", CATALOG)).domain).toBe("Land");
  });

  it("infers origin", async () => {
    expect((await t1.extract("Russian forces used Geran-2", CATALOG)).origin).toBe("RU");
  });

  it("matches a single unambiguous catalog entry", async () => {
    const e = await t1.extract("a Geran-2 was launched", CATALOG);
    expect(e.matchId).toBe("geran-2");
  });

  it("does not auto-match when a novel system is present", async () => {
    // A new variant alongside a known one must not be attributed to the known one.
    const e = await t1.extract("a Geran-5 seen, similar to Geran-2", CATALOG);
    expect(e.matchId).toBeUndefined();
    expect(e.systems?.some((s) => s.variantOf === "geran-2")).toBe(true);
  });

  it("keeps confidence inside 0..1", async () => {
    const rich = await t1.extract(
      "Russian Geran-2 USV, 600 km/h, range 2,000 km, 90 kg, 4 jammers, 900 MHz, CRPA, $250,000",
      CATALOG,
    );
    expect(rich.confidence).toBeGreaterThan(0);
    expect(rich.confidence).toBeLessThanOrEqual(1);
  });

  it("gives tier 2 a higher confidence than tier 1", async () => {
    const text = "Russian Geran-2 with 600 km/h and 2,000 km range";
    const a = await t1.extract(text, CATALOG);
    const b = await new HeuristicExtractor(2).extract(text, CATALOG);
    expect(b.confidence).toBeGreaterThan(a.confidence);
  });

  it("records a rationale", async () => {
    const e = await t1.extract("a Geran-2 was launched", CATALOG);
    expect(e.rationale).toContain("Tier 1");
  });

  it("separates weight classes and endurance", async () => {
    const e = await t1.extract(
      "Geran-2 empty weight 200 kg, MTOW 250 kg, 50 kg warhead and endurance 6 hours.",
      CATALOG,
    );
    expect(specOf(e.specs, "weight_empty")).toBe(200);
    expect(specOf(e.specs, "weight_mtow")).toBe(250);
    expect(specOf(e.specs, "warhead")).toBe(50);
    expect(specOf(e.specs, "endurance")).toBe(6);
  });

  it("reads weights through the lexicons in RU/UK/SV", async () => {
    const cases: Array<[string, string, number]> = [
      ["максимальная взлетная масса 300 кг", "weight_mtow", 300],
      ["сухая масса 200 кг", "weight_empty", 200],
      ["стартовая масса 220 кг", "weight_launch", 220],
      ["максимальна злітна маса 310 кг", "weight_mtow", 310],
      ["пуста маса 190 кг", "weight_empty", 190],
      ["стартова маса 230 кг", "weight_launch", 230],
      ["max startvikt 280 kg", "weight_mtow", 280],
      ["tomvikt 170 kg", "weight_empty", 170],
      ["startvikt 205 kg", "weight_launch", 205],
    ];
    for (const [text, key, value] of cases) {
      const e = await t1.extract(text, CATALOG);
      expect(specOf(e.specs, key)).toBe(value);
    }
  });

  it("reads dimensions through the lexicons in RU/UK/SV", async () => {
    const cases: Array<[string, string, number]> = [
      ["длина 1,5 м", "length", 1.5],
      ["высота 2 м", "height", 2],
      ["ширина 0,8 м", "width", 0.8],
      ["диаметр 0,3 м", "diameter", 0.3],
      ["довжина 1,2 м", "length", 1.2],
      ["висота 3 м", "height", 3],
      ["ширина 1,1 м", "width", 1.1],
      ["діаметр 0,4 м", "diameter", 0.4],
      ["längd 4 m", "length", 4],
      ["höjd 2 m", "height", 2],
      ["bredd 1,5 m", "width", 1.5],
      ["diameter 0,6 m", "diameter", 0.6],
    ];
    for (const [text, key, value] of cases) {
      const e = await t1.extract(text, CATALOG);
      expect(specOf(e.specs, key)).toBe(value);
    }
  });

  it("extracts dimensions, guidance and a named thermal camera", async () => {
    const e = await t1.extract(
      "Shahed-136 has a wingspan of 2.5 m and uses GPS/INS with a Boson 640 thermal camera.",
      CATALOG,
    );
    expect(specOf(e.specs, "wingspan")).toBe(2.5);
    expect(e.guidance).toEqual(expect.arrayContaining(["GPS", "INS"]));
    expect(e.sensors?.[0]?.category).toBe("thermal");
  });

  it("attributes clauses independently in a multi-system report", async () => {
    const e = await t1.extract("Geran-2 reached 600 km/h. Shahed-136 reached 220 km/h.", CATALOG);
    expect(e.systemExtractions).toHaveLength(2);
    const geran = e.systemExtractions?.find((s) => s.matchId === "geran-2");
    const shahed = e.systemExtractions?.find((s) => s.matchId === "shahed-136");
    expect(specOf(geran?.specs ?? [], "speed")).toBe(600);
    expect(specOf(shahed?.specs ?? [], "speed")).toBe(220);
  });
});

describe("extractPriceNumeric", () => {
  it("returns a numeric amount in the written currency", async () => {
    const { extractPriceNumeric } = await import("@/shared/infra/heuristics");
    expect(extractPriceNumeric("kostar 50 mkr per styck")).toMatchObject({
      amount: 50e6,
      currency: "SEK",
    });
    expect(extractPriceNumeric("signed a $2 billion deal")).toMatchObject({
      amount: 2e9,
      currency: "USD",
    });
  });
});
