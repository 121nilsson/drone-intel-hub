import { describe, expect, it } from "vitest";
import { normalizeQuantity } from "@/entities/normalization/units";

describe("missed heuristics from live DB (2)", () => {
  it("normalizes 'exceeding 5,000 kilometers' as a lower bound", () => {
    const n = normalizeQuantity("exceeding 5,000 km");
    expect(n?.range?.qualifier).toBe("greater_than");
    expect(n?.range?.min).toBe(5000);
  });
});
