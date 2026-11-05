import { describe, expect, it } from "vitest";
import {
  decideOrigin,
  originFor,
  originProposal,
  withOriginClaim,
} from "@/entities/drone/origin-audit";
import { repairDrone } from "@/entities/drone/repair";
import type { Drone, Extraction } from "@/entities/drone/types";

const AT = "2026-11-05T00:00:00.000Z";

const drone = (origin: string, countries: string[] = []): Drone => {
  let d = {
    id: "pac-2",
    name: "PAC-2",
    aliases: [],
    domain: "Air",
    origin,
    operators: [],
    propulsion: "Unknown",
    summary: "",
    specs: [],
    rf: [],
    components: [],
    evolution: [],
    counterpartIds: [],
    createdAt: AT,
    updatedAt: AT,
  } as Drone;
  countries.forEach((country, i) => {
    d = withOriginClaim(d, { country, source: `s${i}`, candidateId: `c${i}`, at: AT });
  });
  return d;
};

describe("the origin a report gives a system", () => {
  it("is the system's own extraction, not the digest's top-level origin", () => {
    // PAC-2's case: a 31-system digest, top-level origin RU, PAC-2's own extraction without one.
    const e = {
      name: "PAC-2",
      origin: "RU",
      systemExtractions: [
        { name: "PAC-2", specs: [], rfBands: [] },
        { name: "Geran-2", origin: "RU", specs: [], rfBands: [] },
      ],
    } as unknown as Extraction;
    expect(originFor(e, { name: "PAC-2" })).toBeUndefined();
    expect(originFor(e, { name: "Geran-2" })).toBe("RU");
  });

  it("falls back to the top-level origin only for a report about that one system", () => {
    const e = { name: "PAC-2", origin: "United States" } as unknown as Extraction;
    expect(originFor(e, { name: "PAC-2" })).toBe("US");
    expect(originFor(e, { name: "Patriot" })).toBeUndefined();
  });

  it("counts each candidate once", () => {
    const d = drone("??", ["US"]);
    expect(withOriginClaim(d, { country: "US", source: "s", candidateId: "c0", at: AT })).toBe(d);
  });
});

describe("what the reports support", () => {
  it("fills an unknown origin two reports agree on, and the repair applies it", () => {
    const d = drone("??", ["US", "US"]);
    expect(originProposal(d)).toMatchObject({ kind: "fill", country: "US" });
    expect(repairDrone(d).drone.origin).toBe("US");
  });

  it("leaves an unknown origin the reports split on", () => {
    expect(originProposal(drone("??", ["US", "US", "GB"]))).toBeUndefined();
  });

  it("proposes, never applies, a change most reports support", () => {
    const d = drone("RU", ["US", "US", "US", "RU"]);
    expect(originProposal(d)).toMatchObject({ kind: "change", country: "US", support: 3 });
    expect(repairDrone(d).drone.origin).toBe("RU");
  });

  it("needs a majority and at least two reports", () => {
    expect(originProposal(drone("RU", ["US"]))).toBeUndefined();
    expect(originProposal(drone("RU", ["US", "US", "RU", "RU"]))).toBeUndefined();
  });
});

describe("the analyst's decision", () => {
  it("sets the origin and turns down the rest, so nothing is proposed again", () => {
    const set = decideOrigin(drone("RU", ["US", "US", "RU"]), "US", AT);
    expect(set.origin).toBe("US");
    expect(set.originReview).toMatchObject({ origin: "US", turnedDown: ["RU"], by: "analyst" });
    expect(originProposal(set)).toBeUndefined();
  });

  it("keeping the stored origin outranks any number of later reports", () => {
    let kept = decideOrigin(drone("IR", ["RU", "RU", "RU"]), "IR", AT);
    for (let i = 10; i < 20; i++)
      kept = withOriginClaim(kept, { country: "RU", source: "s", candidateId: `n${i}`, at: AT });
    expect(originProposal(kept)).toBeUndefined();
  });
});
