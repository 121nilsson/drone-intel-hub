import { describe, expect, it } from "vitest";
import { extractClassSpecs, extractContractValue, extractUnitPrice } from "@/shared/infra/heuristics";

function specs(raw: string) {
  const out: Array<{ key: string; value: number | string; unit: string | undefined }> = [];
  extractClassSpecs(raw, (key, _l, value, unit) => out.push({ key, value, unit }));
  return out;
}
const has = (raw: string, key: string, value: number, unit?: string) =>
  expect(specs(raw)).toContainEqual({ key, value, unit });

describe("multilingual class extractors", () => {
  it("reads UAV range in EN/UK/RU/SV", () => {
    has("maximum range of 120 km", "range", 120, "km");
    has("дальність польоту 120 км", "range", 120, "km");
    has("дальность полета 120 км", "range", 120, "km");
    has("räckvidd på 120 km", "range", 120, "km");
  });
  it("reads endurance in hours and minutes across languages", () => {
    has("endurance of 6 hours", "endurance", 6, "h");
    has("час польоту 40 хвилин", "endurance", 40, "min");
    has("flygtid 2 timmar", "endurance", 2, "h");
  });
  it("reads UGV load capacity", () => {
    has("load capacity of 250 kg", "payload", 250, "kg");
    has("вантажопідйомність 300 кг", "payload", 300, "kg");
  });
  it("reads jammer power and suppression radius", () => {
    has("output power of 200 W", "jamming_power", 200, "W");
    has("мощность подавления 1,5 кВт", "jamming_power", 1.5, "kW");
    has("радіус придушення 600 м", "suppression_radius", 600, "m");
  });
  it("keeps SHORAD envelopes out of the vehicle's own range", () => {
    const s = specs("Tor-M2 has an engagement range of 16 km and detection range of 32 km.");
    expect(s).toContainEqual({ key: "engagement_range", value: 16, unit: "km" });
    expect(s).toContainEqual({ key: "detection_range", value: 32, unit: "km" });
    expect(s.some((x) => x.key === "range")).toBe(false);
  });
  it("reads target channels", () => {
    has("engages 4 target channels", "target_channels", 4);
  });
});

describe("price vs contract", () => {
  it("routes contract totals away from unit cost in every language", () => {
    for (const t of [
      "signing defense contracts worth nearly $2 billion since 2020",
      "avtal värt 2 miljarder kronor",
      "контракт на $2 млрд",
    ]) {
      expect(extractUnitPrice(t)).toBeUndefined();
      expect(extractContractValue(t)).toBeDefined();
    }
  });
  it("accepts Swedish unit prices", () => {
    expect(extractUnitPrice("Varje robot kostar 3 miljoner kronor per styck.")?.value).toBe(
      "3 miljoner KRONOR",
    );
  });
});
