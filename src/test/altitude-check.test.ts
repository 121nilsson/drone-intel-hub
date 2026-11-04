import { describe, expect, it } from "vitest";
import { altitudeVerdict } from "@/entities/drone/altitude-check";
import { extractClassSpecs } from "@/shared/infra/heuristics";

const verdict = (value: string, passage: string, semantic = "altitude.target_max") => {
  const v = altitudeVerdict(semantic, value, passage);
  return v.applicable ? v.verdict : "n/a";
};

describe("an altitude whose words say it is a distance", () => {
  it("fails a strike drone's reach filed as a target altitude (the audit's three)", () => {
    expect(
      verdict(
        "targets up to 2,000 km",
        "designed to hit targets up to 2,000 km (1,240 miles) away without relying on satellite navigation",
      ),
    ).toBe("fail");
    expect(
      verdict("targets up to 80 km", "The drone can strike targets up to 80 km (50 miles)"),
    ).toBe("fail");
    expect(
      verdict("100 km", "a launcher for drones that can hit targets up to 100 km (62 miles) away"),
    ).toBe("fail");
  });

  it("passes an interception height", () => {
    expect(verdict("25 км", "Aster 30 Block 1 can intercept targets up to 25 km altitude.")).toBe(
      "pass",
    );
    expect(verdict("до 35", "та висотою до 35 кілометрів")).toBe("pass");
  });

  it("reads beside the figure, so a radar's distance does not fail the aircraft's height", () => {
    expect(
      verdict(
        "35,000 feet",
        "the radar can detect targets up to about 550 km (342 miles) away when the aircraft flies at 35,000 feet",
        "altitude.max",
      ),
    ).toBe("pass");
  });

  it("says nothing where the words beside the figure name neither", () => {
    expect(verdict("40 km", "PAC-3 is said to reach 40 km.")).toBe("n/a");
    expect(verdict("2,000 km", "range of 2,000 km", "range.max")).toBe("n/a");
  });
});

describe("the target-altitude cue", () => {
  const specs = (raw: string) => {
    const out: Array<{ key: string; value: number | string }> = [];
    extractClassSpecs(raw, (key, _l, value) => out.push({ key, value }));
    return out;
  };

  it("does not take a bare 'targets up to' as an altitude", () => {
    const s = specs("The drone can hit targets up to 100 km away.");
    expect(s.some((x) => x.key === "target_altitude_max")).toBe(false);
  });

  it("still takes a phrase that names the height", () => {
    expect(specs("The interceptor engages targets at altitudes up to 25 km.")).toContainEqual({
      key: "target_altitude_max",
      value: 25,
    });
  });
});
