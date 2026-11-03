import { describe, expect, it } from "vitest";
import { isDealFigure, splitFinancialSpecs } from "@/entities/procurement/routing";
import { repairDrone } from "@/entities/drone/repair";
import type { Drone, Extraction, SpecAttribute } from "@/entities/drone/types";

const AT = "2026-11-02T00:00:00.000Z";

describe("a sale total read as a unit price", () => {
  it("is a deal figure when its sentence prices a sale and never a unit", () => {
    expect(
      isDealFigure({
        key: "unit_price",
        evidence: "US approves $2.1 billion Patriot missile sale to Ukraine",
      }),
    ).toBe(true);
    expect(
      isDealFigure({ key: "unit_cost", evidence: "a $53.86 billion government contract" }),
    ).toBe(true);
    expect(isDealFigure({ key: "unit_price", evidence: "угода на 2 млрд доларів" })).toBe(true);
  });

  it("stays a unit price when the sentence prices one unit", () => {
    expect(
      isDealFigure({
        key: "unit_price",
        evidence: "the sale covers missiles at about $4 million each",
      }),
    ).toBe(false);
    expect(isDealFigure({ key: "unit_price", evidence: "контракт: 7000 доларів за штуку" })).toBe(
      false,
    );
    expect(isDealFigure({ key: "unit_price", evidence: "costs $20,000 per drone" })).toBe(false);
    expect(isDealFigure({ key: "unit_price", evidence: "in order to cut costs to $500" })).toBe(
      false,
    );
  });

  it("only ever looks at price attributes", () => {
    expect(isDealFigure({ key: "range", evidence: "sale of drones with 300 km range" })).toBe(
      false,
    );
  });

  it("leaves the extraction at the pipeline boundary", () => {
    const extraction = {
      name: "Patriot",
      specs: [
        {
          key: "unit_price",
          label: "Unit price",
          value: "$2.1 billion",
          evidence: "US approves $2.1 billion Patriot missile sale to Ukraine",
        },
      ],
    } as unknown as Extraction;
    const routed = splitFinancialSpecs(extraction);
    expect(routed.extraction.specs).toEqual([]);
    expect(routed.financial).toHaveLength(1);
  });

  it("moves only the deal claims out of a stored price, keeping the real prices", () => {
    const claim = (id: string, value: string, evidence: string, review?: unknown) => ({
      id,
      value,
      evidence,
      source: `Outlet · ${id}`,
      date: AT,
      ...(review ? { review } : {}),
    });
    const spec = {
      key: "unit_price",
      label: "Unit price",
      claims: [
        claim("a", "$2.1 billion", "US approves $2.1 billion Patriot missile sale"),
        claim("b", "$4 million", "each interceptor costs about $4 million"),
        claim("c", "$1 billion", "a $1 billion contract", {
          verdict: "confirmed",
          at: AT,
        }),
      ],
    } as unknown as SpecAttribute;
    const drone = {
      id: "patriot",
      name: "Patriot",
      aliases: [],
      domain: "Air",
      origin: "US",
      operators: [],
      propulsion: "Unknown",
      summary: "",
      specs: [spec],
      rf: [],
      components: [],
      evolution: [],
      counterpartIds: [],
      createdAt: AT,
      updatedAt: AT,
    } as unknown as Drone;
    const r = repairDrone(drone);
    expect(r.financial.flatMap((s) => s.claims.map((c) => c.id))).toEqual(["a"]);
    expect(r.drone.specs[0]!.claims.map((c) => c.id)).toEqual(["b", "c"]);
  });
});
