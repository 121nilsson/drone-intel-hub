import { describe, expect, it } from "vitest";
import { pct, pctPrecise } from "@/shared/ui/format";

describe("percent formatting", () => {
  it("rounds to a whole percent by default", () => {
    expect(pct(0)).toBe("0%");
    expect(pct(0.954)).toBe("95%");
    expect(pct(0.955)).toBe("96%");
    expect(pct(1)).toBe("100%");
  });

  it("keeps one decimal for error bounds", () => {
    expect(pctPrecise(0.0125)).toBe("1.3%");
    expect(pctPrecise(0.05)).toBe("5.0%");
  });
});
