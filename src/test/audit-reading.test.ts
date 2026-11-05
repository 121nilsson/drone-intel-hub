import { describe, expect, it } from "vitest";
import { liveReading } from "@/features/autonomy/audit-reading";
import { claimReading } from "@/entities/drone/claim-reading";
import type { Drone, SpecAttribute, SpecClaim } from "@/entities/drone/types";

const claim = (over: Partial<SpecClaim>): SpecClaim =>
  ({
    id: "c1",
    value: "range of up to 500 km",
    raw: "range of up to 500 km",
    source: "s",
    date: "2026-11-01",
    ...over,
  }) as SpecClaim;
const spec = (over: Partial<SpecAttribute>, claims: SpecClaim[]): SpecAttribute =>
  ({ key: "range", label: "Range", unit: "km", claims, ...over }) as SpecAttribute;
const drone = (specs: SpecAttribute[]) =>
  ({ id: "d1", name: "Iskander-M", specs }) as unknown as Drone;

describe("the reading shown beside an audited claim", () => {
  it("gives the catalogue's reading of the claim the row was drawn from", () => {
    const c = claim({
      normalized: { value: 500, unit: "km", range: { max: 500, qualifier: "up_to" } } as never,
    });
    const s = spec({}, [c]);
    const item = { droneId: "d1", specLabel: "Range", value: claimReading(s, c) };
    expect(liveReading([drone([s])], item)).toEqual({ clean: "up to 500 km" });
  });

  it("says what kind of speed a speed attribute is", () => {
    const c = claim({
      value: "500 km/h",
      raw: "500 km/h",
      normalized: { value: 500, unit: "km/h", range: { value: 500, qualifier: "exact" } } as never,
    });
    const s = spec({ key: "max_speed", label: "Max speed", unit: "km/h" }, [c]);
    const item = { droneId: "d1", specLabel: "Max speed", value: claimReading(s, c) };
    expect(liveReading([drone([s])], item)).toEqual({ clean: "500 km/h", nature: "Top speed" });
  });

  it("returns nothing when the claim has changed since the row was drawn", () => {
    const c = claim({
      normalized: { value: 500, unit: "km", range: { max: 500, qualifier: "up_to" } } as never,
    });
    const s = spec({}, [c]);
    expect(
      liveReading([drone([s])], { droneId: "d1", specLabel: "Range", value: "another string" }),
    ).toBeUndefined();
    expect(
      liveReading([drone([s])], { droneId: "gone", specLabel: "Range", value: claimReading(s, c) }),
    ).toBeUndefined();
  });
});
