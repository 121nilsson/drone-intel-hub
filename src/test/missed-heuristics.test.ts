import { describe, expect, it } from "vitest";
import { normalizeQuantity } from "@/entities/normalization/units";
import { parseMoney } from "@/entities/normalization/currency";

describe("missed heuristics from live DB", () => {
  it("normalizes 'roughly 330 km/h' (Geran-3 cruise speed claim)", () => {
    const n = normalizeQuantity("roughly 330 km/h");
    expect(n?.canonicalValue).toBe(330);
    expect(n?.range?.qualifier).toBe("approximate");
  });

  it("parses Ukrainian million magnitude in money ('$832 мільйони')", () => {
    const m = parseMoney("$832 мільйони");
    expect(m?.amount).toBe(832_000_000);
    expect(m?.currency).toBe("USD");
  });
});
