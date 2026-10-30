import { describe, expect, it } from "vitest";
import { repairDrone } from "@/entities/drone/repair";
import { mergeSpecs } from "@/entities/drone/spec-engine";
import type { Drone, Extraction, SpecAttribute } from "@/entities/drone/types";
import { countryCode } from "@/entities/normalization/country";
import { semanticKeyFor } from "@/entities/normalization/semantic";
import { narrowLinks } from "@/entities/procurement/linking";
import { isFinancialSpec, procurementsFrom } from "@/entities/procurement/routing";
import type { Procurement } from "@/entities/procurement/types";
import { AIExtractionSchema } from "@/shared/contracts/extraction.schema";
import type { DroneRepository, ProcurementRepository } from "@/shared/contracts/repository";
import { repairCatalog } from "@/shared/infra/ingest/repair-catalog";

/**
 * The reading rules, and the repair that brings stored records up to them. Each case is a record
 * found in the live catalog when the rules were narrowed.
 */

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

const spec = (key: string, label: string, value: number | string, over = {}): SpecAttribute => ({
  key,
  label,
  discoveredBy: "ai",
  claims: [{ value, source: "src", sourceId: "d1", date: "2026-10-01", evidence: String(value) }],
  ...over,
});

describe("semantic rules", () => {
  it("reads the labels it used to miss", () => {
    expect(semanticKeyFor("speed", "Cruising speed")).toBe("speed.cruise");
    expect(semanticKeyFor("range", "Range (one way)")).toBe("range.max");
    expect(semanticKeyFor("altitude_max", "Maximum operating altitude")).toBe("altitude.max");
    expect(semanticKeyFor("payload_capacity", "Maximum payload")).toBe("payload.capacity");
    expect(semanticKeyFor("unit_price", "Unit price")).toBe("cost.unit");
  });

  it("files a count only when the wording is a count", () => {
    expect(semanticKeyFor("cameras", "Number of cameras")).toBe("sensor.camera.count");
    expect(semanticKeyFor("jammers", "Onboard jammers")).toBe("ew.jammer.count");
    expect(semanticKeyFor("net_launchers_quantity", "Net launchers per module")).toBe(
      "launcher.count",
    );
    for (const [key, label] of [
      ["camera_type", "Camera type"],
      ["cameraTilt", "Camera tilt"],
      ["engine", "Engine"],
      ["engine_thrust", "Engine Thrust"],
      ["antenna_elements_current", "Antenna elements (current)"],
      ["missiles_received_90d", "Patriot missiles received in 90 days"],
      ["intercept_range", "Intercept range (ballistic missiles)"],
    ])
      expect(semanticKeyFor(key!, label), label).toBe(key);
  });

  it("reads a bare range as the system's reach unless the label narrows it", () => {
    expect(semanticKeyFor("range", "Дальность")).toBe("range.max");
    expect(semanticKeyFor("range", "Strike range")).toBe("range.max");
    expect(semanticKeyFor("range", "Theoretical line-of-sight range")).toBe("range.link");
    expect(semanticKeyFor("range", "Transmission range")).toBe("range.link");
    expect(semanticKeyFor("range", "Tactical radius")).toBe("range.combat_radius");
    expect(semanticKeyFor("range", "Observed range to Lviv")).toBe("range");
    expect(semanticKeyFor("range", "Range (round trip)")).toBe("range");
    expect(semanticKeyFor("speed", "Top Speed")).toBe("speed.max");
    expect(semanticKeyFor("maxOperatingAltitude", "Max Operating Altitude")).toBe("altitude.max");
  });

  it("files guidance, not everything that mentions navigation", () => {
    expect(semanticKeyFor("guidance", "Guidance / navigation")).toBe("guidance.system");
    expect(semanticKeyFor("navigation_robustness", "Navigation capability")).toBe(
      "navigation_robustness",
    );
  });
});

describe("one attribute or two", () => {
  it("keeps rows apart that only a label rule would have joined", () => {
    const shahed = drone("shahed", {
      specs: [spec("antenna_elements_current", "Antenna elements (current)", "32")],
    });
    const next = mergeSpecs(
      shahed,
      [{ key: "antenna_elements_planned", label: "Antenna elements (planned)", value: "20" }],
      "src",
    );
    expect(next.specs.map((s) => s.key)).toEqual([
      "antenna_elements_current",
      "antenna_elements_planned",
    ]);
  });

  it("still joins a row its label explains to a key that names the attribute", () => {
    const k3 = drone("k3", { specs: [spec("maxSpeed", "Max speed", 80)] });
    const next = mergeSpecs(k3, [{ key: "speed", label: "Maximum speed", value: 82 }], "src");
    expect(next.specs).toHaveLength(1);
    expect(next.specs[0]!.claims).toHaveLength(2);
  });
});

describe("deal figures", () => {
  it("are recognised by what the label says, not only by the key", () => {
    expect(isFinancialSpec({ key: "unit_price", label: "Funding amount" })).toBe(true);
    expect(isFinancialSpec({ key: "unit_price", label: "Sales Value" })).toBe(true);
    expect(isFinancialSpec({ key: "contract_ceiling", label: "Contract ceiling" })).toBe(true);
    expect(isFinancialSpec({ key: "priceTotal", label: "Total price" })).toBe(true);
    expect(isFinancialSpec({ key: "unit_price", label: "Unit Price (Trials)" })).toBe(false);
    expect(isFinancialSpec({ key: "unit_cost", label: "Unit cost" })).toBe(false);
  });

  const post: Extraction = {
    name: "XENTA-M5",
    matchId: "xenta",
    aliases: [],
    operators: [],
    rfBands: [],
    confidence: 0.8,
    rationale: "",
    specs: [],
    systems: [
      { name: "XENTA-M5", matchId: "xenta" },
      { name: "SAN", matchId: "san" },
      { name: "F-35A", matchId: "f35" },
      { name: "Chinook", matchId: "chinook" },
    ],
  };
  const contract = (evidence: string) => ({
    key: "contract_value",
    label: "Contract value",
    value: "€84 million",
    evidence,
  });

  it("link to the systems their own sentence names", () => {
    const [p] = procurementsFrom(
      [contract("Weibel will supply XENTA-M5 radars for the SAN programme, worth €84 million")],
      post,
      "src",
    );
    expect(p?.systemIds).toEqual(["xenta", "san"]);
    expect(p?.product).toBe("XENTA-M5, SAN");
  });

  it("link to the post's subject when the sentence names none", () => {
    const [p] = procurementsFrom([contract("a contract worth €84 million")], post, "src");
    expect(p?.systemIds).toEqual(["xenta"]);
  });

  it("keep their links when the stored text names none of them", () => {
    const record: Procurement = {
      id: "p",
      company: "Weibel",
      country: "DK",
      source: "src",
      notes: "Contract value: worth €84 million",
      systemIds: ["xenta", "f35"],
      systemNames: ["XENTA-M5", "F-35A"],
      createdAt: "",
    };
    const lookup = (id: string) => ({ name: id === "xenta" ? "XENTA-M5" : "F-35A", id });
    expect(narrowLinks(record, lookup)).toBeUndefined();
    const named = narrowLinks({ ...record, notes: "XENTA-M5 radars worth €84 million" }, lookup);
    expect(named?.systemIds).toEqual(["xenta"]);
    expect(named?.systemNames).toEqual(["XENTA-M5"]);
  });
});

describe("country codes", () => {
  it("spells each country one way", () => {
    expect(countryCode("UK")).toBe("GB");
    expect(countryCode("Japan")).toBe("JP");
    expect(countryCode("Russian Federation")).toBe("RU");
    expect(countryCode("Turkey")).toBe("TR");
    expect(countryCode("se")).toBe("SE");
  });

  it("leaves what is not a country spelling alone", () => {
    for (const v of ["??", "NATO", "EU", "SU"]) expect(countryCode(v)).toBe(v);
  });

  it("are normalised where model answers enter", () => {
    const e = AIExtractionSchema.parse({ origin: "Japan", operators: ["UK", "GB", "Ukraine"] });
    expect(e.origin).toBe("JP");
    expect(e.operators).toEqual(["GB", "UA"]);
  });
});

describe("repairing a stored entry", () => {
  it("re-reads a semantic stored by a rule since narrowed", () => {
    const r = repairDrone(
      drone("geran-5", {
        specs: [{ ...spec("engine", "Engine", "TJ2000A"), semantic: "propulsion.engine.count" }],
      }),
    );
    expect(r.drone.specs[0]!.semantic).toBeUndefined();
    expect(r.changes.map((c) => c.kind)).toEqual(["semantic"]);
  });

  it("takes a deal figure out of the specs, unless an analyst ruled on it", () => {
    const r = repairDrone(
      drone("thaad", { specs: [spec("contract_value", "Contract value", "$218 million")] }),
    );
    expect(r.drone.specs).toEqual([]);
    expect(r.financial.map((s) => s.key)).toEqual(["contract_value"]);

    const ruled = spec("contract_value", "Contract value", "$218 million");
    ruled.claims[0]!.review = { verdict: "confirmed", at: "2026-10-01" } as never;
    expect(repairDrone(drone("thaad", { specs: [ruled] })).financial).toEqual([]);
  });

  it("folds a duplicate row and spells operators one way", () => {
    const r = repairDrone(
      drone("tyr", {
        operators: ["GB", "UK"],
        specs: [spec("range", "Range", 40), spec("range_max", "Range", 42)],
      }),
    );
    expect(r.drone.operators).toEqual(["GB"]);
    expect(r.drone.specs).toHaveLength(1);
    expect(r.drone.specs[0]!.claims).toHaveLength(2);
  });

  it("returns an entry the rules already describe untouched", () => {
    const clean = drone("clean", { specs: [spec("range", "Range", 40)] });
    expect(repairDrone(clean).drone).toBe(clean);
  });
});

describe("catalog repair", () => {
  const setup = () => {
    let drones = [
      drone("thaad", {
        operators: ["US", "UK"],
        specs: [spec("contract_value", "Contract value", "$218 million")],
      }),
      drone("tomahawk", { specs: [spec("contract_value", "Contract value", "$23 billion")] }),
    ];
    const procurements: Procurement[] = [
      // The pipeline already filed Tomahawk's figure from the same post.
      {
        id: "x",
        company: "RTX",
        country: "US",
        source: "src",
        sourceId: "d1",
        amount: "$23 billion",
        createdAt: "",
      },
    ];
    const droneRepo = {
      list: () => drones,
      get: (id: string) => drones.find((d) => d.id === id),
      upsert: (d: Drone) => {
        drones = drones.map((x) => (x.id === d.id ? d : x));
      },
    } as unknown as DroneRepository;
    const procRepo: ProcurementRepository = {
      list: () => procurements,
      add: (p) => procurements.push(p),
      update: () => {},
    };
    return { droneRepo, procRepo, procurements, drones: () => drones };
  };

  it("previews without writing anything", () => {
    const s = setup();
    const rep = repairCatalog(s.droneRepo, s.procRepo, { apply: false });
    expect(rep.drones).toBe(2);
    expect(rep.procurementsAdded).toBe(1);
    expect(s.procurements).toHaveLength(1);
    expect(s.drones()[0]!.specs).toHaveLength(1);
  });

  it("files each deal once and is a no-op the second time", () => {
    const s = setup();
    repairCatalog(s.droneRepo, s.procRepo);
    expect(s.procurements.map((p) => p.amount)).toEqual(["$23 billion", "$218 million"]);
    expect(s.drones().every((d) => d.specs.length === 0)).toBe(true);
    expect(s.drones()[0]!.operators).toEqual(["US", "GB"]);
    const again = repairCatalog(s.droneRepo, s.procRepo);
    expect(again.entries).toEqual([]);
  });
});
