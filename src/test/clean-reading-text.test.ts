import { describe, expect, it } from "vitest";
import { cleanReading } from "@/entities/drone/claim-reading";
import type { SpecClaim } from "@/entities/drone/types";

const read = (raw: string, unit = "km") =>
  cleanReading({ unit }, { value: raw, raw, source: "s", date: "2026-11-01" } as SpecClaim);

describe("the clean reading of a claim kept as the post's phrase", () => {
  it("puts the qualifier, figure and unit of a clipped phrase together", () => {
    expect(read("range to at least 1,000 kilometers")).toBe("at least 1000 km");
    expect(read("(approximately 100 km/h", "km/h")).toBe("approx. 100 km/h");
    expect(read("targets up to 100 km")).toBe("up to 100 km");
    expect(read("speed of up to 500 km/h", "km/h")).toBe("up to 500 km/h");
  });

  it("drops the prose that came before a figure, and the second half of a clipped pair", () => {
    expect(read(" km, speed 850 km/h", "km/h")).toBe("850 km/h");
  });

  it("does not take a qualifier from further back in the sentence", () => {
    expect(read("The system, which can fly up to a point, weighs 40 kg", "kg")).toBe("40 kg");
  });

  it("leaves a plain value as it was", () => {
    expect(read("500 km")).toBe("500 km");
  });

  it("falls back to the stated reading when no figure and unit can be read", () => {
    expect(read("GPS", "")).toBe("GPS");
  });
});
