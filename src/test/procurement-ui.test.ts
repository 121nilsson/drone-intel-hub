import { describe, expect, it } from "vitest";
import type { Drone } from "@/entities/drone/types";
import type { Procurement } from "@/entities/procurement/types";
import { byNewestContract, contractsForDrone } from "@/entities/procurement/match";
import { procurementDay, procurementSystemRefs } from "@/entities/procurement/presentation";
import {
  filterProcurements,
  fromProcurementSearchParams,
  parseProcurementSearchParams,
  procurementFacets,
  toProcurementSearchParams,
} from "@/features/procurement/procurement-state";

const contract = (over: Partial<Procurement> = {}): Procurement => ({
  id: "p1",
  company: "Rheinmetall",
  country: "DE",
  amount: "€100M",
  currency: "EUR",
  customer: "German MoD",
  program: "Future Soldier",
  product: "Recon drones",
  announcedAt: "2026-09-01T00:00:00.000Z",
  source: "Defense News",
  sourceUrl: "https://example.test/deal",
  systemIds: ["luna-ng"],
  systemNames: ["Luna NG"],
  notes: "Framework contract",
  createdAt: "2026-09-02T00:00:00.000Z",
  ...over,
});

const drone = (over: Partial<Drone> = {}): Drone => ({
  id: "luna-ng",
  name: "Luna NG",
  aliases: ["LUNA"],
  domain: "Air",
  origin: "DE",
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

describe("procurement search state", () => {
  it("validates URL params and round-trips only non-default values", () => {
    const parsed = parseProcurementSearchParams({
      q: "luna",
      country: "DE, FR,DE",
      currency: "EUR",
      buyer: "German MoD",
      system: "luna-ng",
      unknown: "drop me",
    });
    expect(parsed).toEqual({
      q: "luna",
      country: "DE,FR",
      currency: "EUR",
      buyer: "German MoD",
      system: "luna-ng",
    });
    expect(toProcurementSearchParams(fromProcurementSearchParams(parsed))).toEqual(parsed);
    expect(toProcurementSearchParams(fromProcurementSearchParams({}))).toEqual({});
  });

  it("derives sorted facets and filters by every facet", () => {
    const rows = [
      contract(),
      contract({
        id: "p2",
        company: "Anduril",
        country: "US",
        currency: "USD",
        customer: "US DoD",
        systemIds: ["ghost-x"],
        systemNames: ["Ghost X"],
      }),
    ];
    expect(procurementFacets(rows)).toEqual({
      countries: ["DE", "US"],
      currencies: ["EUR", "USD"],
      buyers: ["German MoD", "US DoD"],
    });
    expect(filterProcurements(rows, fromProcurementSearchParams({ country: "US" }))).toHaveLength(
      1,
    );
    expect(filterProcurements(rows, fromProcurementSearchParams({ currency: "EUR" }))[0]!.id).toBe(
      "p1",
    );
    expect(filterProcurements(rows, fromProcurementSearchParams({ buyer: "US DoD" }))[0]!.id).toBe(
      "p2",
    );
    expect(
      filterProcurements(rows, fromProcurementSearchParams({ system: "ghost-x" }))[0]!.id,
    ).toBe("p2");
    expect(filterProcurements(rows, fromProcurementSearchParams({ q: "framework" }))[0]!.id).toBe(
      "p1",
    );
  });
});

describe("procurement presentation", () => {
  it("links a contract to a system by id, name or alias and nothing fuzzy", () => {
    const rows = [
      contract(),
      contract({ id: "p2", systemIds: [], systemNames: ["LUNA"], product: "LUNA" }),
      contract({ id: "p3", systemIds: [], systemNames: ["Luna NG"], product: "Other" }),
      contract({
        id: "p4",
        systemIds: [],
        systemNames: [],
        product: "FPV drones",
      }),
    ];
    expect(contractsForDrone(rows, drone()).map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("resolves stored names to catalog links and keeps unresolved names", () => {
    const rows = procurementSystemRefs(
      contract({ systemNames: ["Luna NG", "Ghost X"], systemIds: ["luna-ng", "missing"] }),
      [drone()],
    );
    expect(rows).toEqual([{ id: "luna-ng", name: "Luna NG" }, { name: "Ghost X" }]);
  });

  it("uses the announcement date for display and newest-first ordering", () => {
    const old = contract({ id: "old", announcedAt: "2026-01-01T00:00:00.000Z" });
    const recent = contract({ id: "recent", announcedAt: "2026-10-01T00:00:00.000Z" });
    expect(procurementDay(recent)).toBe("2026-10-01");
    expect([old, recent].sort(byNewestContract).map((p) => p.id)).toEqual(["recent", "old"]);
  });
});
