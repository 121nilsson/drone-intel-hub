import { describe, expect, it } from "vitest";
import { extractClassSpecs } from "@/shared/infra/heuristics";

function specs(raw: string) {
  const out: Array<{ key: string; value: number | string; unit: string | undefined }> = [];
  extractClassSpecs(raw, (key, _l, value, unit) => out.push({ key, value, unit }));
  return out;
}

describe("missed heuristics from live DB (3)", () => {
  it("does not read engagement altitude as the vehicle's own altitude (PAC-3)", () => {
    const s = specs("PAC-3 has an engagement altitude of 40 km and a service ceiling of 20 km.");
    expect(s).toContainEqual({ key: "target_altitude_max", value: 40, unit: "km" });
    expect(s.some((x) => x.key === "altitude" && x.value === 40)).toBe(false);
    expect(s).toContainEqual({ key: "altitude", value: 20, unit: "km" });
  });

  it("does not read interception altitude as the vehicle's own altitude (PAC-2/PAC-3 live phrasing)", () => {
    const s = specs(
      "PAC-3 MSE has a maximum interception altitude of 40 km and engages targets at intercept altitude up to 36 km.",
    );
    expect(s).toContainEqual({ key: "target_altitude_max", value: 40, unit: "km" });
    expect(s).toContainEqual({ key: "target_altitude_max", value: 36, unit: "km" });
    expect(s.some((x) => x.key === "altitude")).toBe(false);
  });
});
