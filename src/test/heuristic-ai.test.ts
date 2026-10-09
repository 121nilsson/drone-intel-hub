import { describe, expect, it } from "vitest";
import {
  HeuristicExtractor,
  detectNames,
  extractPrice,
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

describe("HeuristicExtractor extraction", () => {
  it("counts repeated nouns", async () => {
    const e = await t1.extract("fitted with 4 jammers and 2 antennas", CATALOG);
    expect(specOf(e.specs, "jammers")).toBe(4);
    expect(specOf(e.specs, "antennas")).toBe(2);
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
