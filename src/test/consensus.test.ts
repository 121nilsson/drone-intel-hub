import { describe, expect, it } from "vitest";
import { consensus } from "@/entities/drone/consensus";
import type { SpecAttribute, SpecClaim } from "@/entities/drone/types";

const spec = (claims: Array<[number | string, string]>, unit?: string): SpecAttribute => ({
  key: "range",
  label: "Range",
  ...(unit ? { unit } : {}),
  discoveredBy: "ai",
  claims: claims.map(([value, source], i): SpecClaim => ({
    value,
    source,
    date: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
  })),
});

describe("consensus", () => {
  // The original ternary was `min === max ? display : display` - both branches identical, so
  // disagreement was invisible however extreme it got.
  it("distinguishes agreement from disagreement", () => {
    const agreed = consensus(
      spec(
        [
          [1000, "a"],
          [1000, "b"],
        ],
        "km",
      ),
    );
    const disputed = consensus(
      spec(
        [
          [1000, "a"],
          [4000, "b"],
        ],
        "km",
      ),
    );

    expect(agreed.disputed).toBe(false);
    expect(disputed.disputed).toBe(true);
    expect(agreed.display).not.toBe(disputed.display);
  });

  it("shows the observed range when sources disagree", () => {
    const c = consensus(
      spec(
        [
          [1000, "a"],
          [4000, "b"],
          [5000, "c"],
        ],
        "km",
      ),
    );
    // The full observed range (min–max) is what makes the conflict visible.
    expect(c.display).toBe("1000–5000 km");
    expect(c.median).toBe(4000);
    expect(c.max).toBe(5000);
    expect(c.min).toBe(1000);
    expect(c.sources).toBe(3);
  });

  it("renders a single value when all sources agree", () => {
    const c = consensus(
      spec(
        [
          [1000, "a"],
          [1000, "b"],
          [1000, "c"],
        ],
        "km",
      ),
    );
    expect(c.display).toBe("1000 km");
    expect(c.disputed).toBe(false);
    expect(c.confidence).toBe("high");
  });

  it("does not call a single restated source a dispute", () => {
    // One source restating a wide range is not two sources disagreeing.
    const c = consensus(spec([[1000, "a"]], "km"));
    expect(c.disputed).toBe(false);
    expect(c.sources).toBe(1);
  });

  it("ignores a tight spread below the dispute threshold", () => {
    const c = consensus(
      spec(
        [
          [1000, "a"],
          [1100, "b"],
        ],
        "km",
      ),
    );
    expect(c.disputed).toBe(false);
    expect(c.display).toBe("1100 km");
  });

  it("flags disagreeing string claims", () => {
    const c = consensus(
      spec([
        ["long endurance", "a"],
        ["short endurance", "b"],
        ["unknown", "c"],
      ]),
    );
    expect(c.disputed).toBe(true);
  });

  it("agrees on string claims that match", () => {
    const c = consensus(
      spec([
        ["long endurance", "a"],
        ["long endurance", "b"],
      ]),
    );
    expect(c.disputed).toBe(false);
    expect(c.display).toBe("long endurance");
  });

  it("handles an attribute with no claims", () => {
    const c = consensus({ key: "range", label: "Range", discoveredBy: "seed", claims: [] });
    expect(c.display).toBe("—");
    expect(c.disputed).toBe(false);
    expect(c.sources).toBe(0);
  });

  it("counts distinct sources, not claim count", () => {
    const c = consensus(
      spec([
        [1000, "a"],
        [1000, "a"],
        [1000, "b"],
      ]),
    );
    expect(c.sources).toBe(2);
    expect(c.confidence).toBe("medium");
  });

  it("does not render float noise", () => {
    const c = consensus(spec([[2.35, "a"]]));
    expect(c.display).toBe("2.35");
  });

  it("omits the unit when the attribute has none", () => {
    const c = consensus(
      spec([
        [5, "a"],
        [5, "b"],
      ]),
    );
    expect(c.display).toBe("5");
  });
});
