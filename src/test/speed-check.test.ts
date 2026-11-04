import { describe, expect, it } from "vitest";
import { speedVerdict } from "@/entities/drone/speed-check";
import { repairDrone } from "@/entities/drone/repair";
import type { Drone, SpecAttribute, SpecClaim } from "@/entities/drone/types";

const verdict = (semantic: string, value: string, passage: string) => {
  const v = speedVerdict(semantic, value, passage);
  return v.applicable ? v.verdict : "n/a";
};

describe("a cruise speed whose words make it a top speed", () => {
  it("fails 'up to' and 'accelerate to' filed as cruise", () => {
    expect(
      verdict("speed.cruise", "500 km/h", "The drone reaches a speed of up to 500 km/h."),
    ).toBe("fail");
    expect(verdict("speed.cruise", "900", "Розробники прагнуть розігнати до 900 км/год.")).toBe(
      "fail",
    );
  });

  it("passes a stated cruise speed, in any registered language", () => {
    expect(verdict("speed.cruise", "185", "It cruises at 185 km/h.")).toBe("pass");
    expect(verdict("speed.cruise", "75", "Має крейсерську швидкість 75 км/год.")).toBe("pass");
  });

  it("fails a cruise figure filed as the top speed", () => {
    expect(
      verdict("speed.max", "50", "The craft must cruise at no less than 50 knots (93 km/h)."),
    ).toBe("fail");
    expect(verdict("speed.max", "600", "It can fly at up to 600 km/h.")).toBe("pass");
  });

  it("says nothing about a plain speed", () => {
    expect(verdict("speed.cruise", "150", "The drone flies 150 km/h.")).toBe("n/a");
    expect(verdict("speed.plain", "150", "up to 150 km/h")).toBe("n/a");
  });
});

describe("the catalogue repair of a plain speed labelled cruise", () => {
  const claim = (id: string, over: Partial<SpecClaim>): SpecClaim => ({
    id,
    value: 500,
    source: "s",
    date: "2026-10-01T00:00:00.000Z",
    ...over,
  });
  const spec = (claims: SpecClaim[]): SpecAttribute => ({
    key: "speed",
    label: "Cruise speed",
    unit: "km/h",
    discoveredBy: "ai",
    claims,
  });
  const drone = (specs: SpecAttribute[]) =>
    ({ id: "d", name: "D", aliases: [], operators: [], specs }) as unknown as Drone;

  it("files the plain speeds as Speed and keeps the real cruise speeds", () => {
    const { drone: out, changes } = repairDrone(
      drone([
        spec([
          claim("plain", {
            raw: "a speed of up to 500 km/h",
            evidence: "a speed of up to 500 km/h",
          }),
          claim("cruise", {
            raw: "cruises at 180 km/h",
            evidence: "cruises at 180 km/h",
            value: 180,
          }),
          claim("seed", { value: 185 }),
        ]),
      ]),
    );
    expect(changes.some((c) => c.kind === "speed")).toBe(true);
    const by = (key: string) => out.specs.find((s) => s.key === key);
    expect(by("speed")).toMatchObject({ label: "Speed" });
    expect(by("speed")!.claims.map((c) => c.id)).toEqual(["plain"]);
    expect(
      by("cruise_speed")!
        .claims.map((c) => c.id)
        .sort(),
    ).toEqual(["cruise", "seed"]);
  });

  it("is a no-op once repaired", () => {
    const once = repairDrone(
      drone([spec([claim("plain", { raw: "speed of 500 km/h", evidence: "speed of 500 km/h" })])]),
    ).drone;
    expect(repairDrone(once).changes).toEqual([]);
  });
});
