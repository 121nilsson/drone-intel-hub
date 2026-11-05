import { describe, expect, it } from "vitest";
import { speedVerdict } from "@/entities/drone/speed-check";
import { SPEED_NATURE_HINT, speedNatureLabel } from "@/features/autonomy/speed-nature";

describe("the label for a speed attribute's nature", () => {
  it("names cruise, top and dive speed", () => {
    expect(speedNatureLabel("speed.cruise")).toBe("Cruise speed");
    expect(speedNatureLabel("speed.max")).toBe("Top speed");
    expect(speedNatureLabel("speed.dive")).toBe("Dive speed");
  });

  it("gives no speed label to any other attribute", () => {
    expect(speedNatureLabel("range.max")).toBeUndefined();
    expect(speedNatureLabel("speed")).toBeUndefined();
  });
});

describe("the reading guide matches speed-check.ts", () => {
  it("says up to, max and top make a top speed", () => {
    expect(SPEED_NATURE_HINT).toMatch(/“Up to”, “max” or “top”/);
    expect(speedVerdict("speed.max", "600", "It can fly at up to 600 km/h.")).toMatchObject({
      verdict: "pass",
    });
    expect(speedVerdict("speed.max", "600", "Maximum speed 600 km/h.")).toMatchObject({
      verdict: "pass",
    });
    expect(speedVerdict("speed.max", "600", "Top speed of 600 km/h.")).toMatchObject({
      verdict: "pass",
    });
  });

  it("says a cruise speed needs the word cruise", () => {
    expect(SPEED_NATURE_HINT).toMatch(/needs the word “cruise”/);
    expect(speedVerdict("speed.cruise", "185", "It cruises at 185 km/h.")).toMatchObject({
      verdict: "pass",
    });
    // Without the word, the figure is not read as cruise: the verdict stays silent.
    expect(speedVerdict("speed.cruise", "185", "It flies at 185 km/h.").applicable).toBe(false);
  });
});
