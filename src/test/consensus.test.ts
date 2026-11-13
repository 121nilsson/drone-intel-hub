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
    // The source's own words carry the unit: a figure with none is held back from consensus.
    ...(unit && typeof value === "number" ? { evidence: `${value} ${unit}` } : {}),
  })),
});

describe("consensus", () => {
  const price = (...values: string[]): SpecAttribute => ({
    ...spec(values.map((v, i): [string, string] => [v, `s${i}`])),
    key: "unit_cost",
    label: "Unit cost",
    semantic: "cost.unit",
  });

  it("reads a price written in words, with its currency", () => {
    expect(consensus(price("5–7 тисяч доларів", "7000 доларів")).display).toBe("7000 USD");
    expect(consensus(price("5–7 тисяч доларів")).display).toBe("5000–7000 USD");
    expect(consensus(price("more than $50 million")).display).toBe("≥50000000 USD");
  });

  it("does not take a median across currencies, or past a price it cannot read", () => {
    // The row keeps a source's own wording rather than an aggregate in one of the currencies.
    expect(consensus(price("$2.1 billion", "€100 million")).display).not.toMatch(/ (USD|EUR)$/);
    expect(consensus(price("40 million Swedish krona", "$2.1 billion")).display).toBe(
      "40 million Swedish krona",
    );
  });

  it("reads thrust stated in kilogram-force", () => {
    expect(consensus({ ...spec([["8–10 кгс", "s"]]), key: "engine_thrust" }).display).toBe(
      "78.45–98.07 N",
    );
  });

  // A claim stored as raw text before its wording could be read showed that text untranslated.
  it("reads a stored text bound in the catalogue's unit", () => {
    expect(consensus(spec([["не менше ніж 500 м", "Militarnyi"]], "km")).display).toBe("≥0.5 km");
    expect(
      consensus({ ...spec([["щонайменше 3,5 години", "Militarnyi"]], "min"), key: "endurance" })
        .display,
    ).toBe("≥3.5 h");
  });

  // Durations are stored in minutes; "1440 min" had to be worked out by the reader.
  it("shows a long duration in hours or days, and keeps the stored minutes", () => {
    const endurance = (value: number) => ({ ...spec([[value, "s"]], "min"), key: "endurance" });
    expect(consensus(endurance(90)).display).toBe("90 min");
    expect(consensus(endurance(210)).display).toBe("3.5 h");
    expect(consensus(endurance(1440)).display).toBe("24 h");
    expect(consensus(endurance(4320)).display).toBe("3 d");
    expect(consensus(endurance(210)).median).toBe(210);
  });

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

  it("shows the median, not an envelope, when sources disagree", () => {
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
    // The disagreement is shown by the disputed flag. The min–max envelope mixes sources and was
    // read as a source's own range, so the display is the median (previously "1000–5000 km").
    expect(c.display).toBe("4000 km");
    expect(c.disputed).toBe(true);
    expect(c.median).toBe(4000);
    expect(c.max).toBe(5000);
    expect(c.min).toBe(1000);
    expect(c.sources).toBe(3);
  });

  it("does not let an adjudicated outlier feed the aggregate", () => {
    // Thunder, live: an 800 km reference claim next to 15/10 km claims the adjudicator marked.
    const claim = (value: number, source: string, verdict: "supported" | "outlier"): SpecClaim => ({
      value,
      source,
      date: "2026-10-01T00:00:00.000Z",
      evidence: `${value} km`,
      adjudication: { verdict, confidence: 0.9, at: "2026-10-02T00:00:00.000Z" },
    });
    const c = consensus({
      key: "range",
      label: "Range",
      unit: "km",
      discoveredBy: "ai",
      claims: [
        claim(800, "Wikipedia", "supported"),
        claim(15, "Blog A", "outlier"),
        claim(10, "Blog B", "outlier"),
      ],
    });
    expect(c.display).toBe("800 km");
    expect(c.disputed).toBe(false);
    expect(c.sources).toBe(1);
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
      spec(
        [
          [1000, "a"],
          [1000, "a"],
          [1000, "b"],
        ],
        "km",
      ),
    );
    expect(c.sources).toBe(2);
    expect(c.confidence).toBe("medium");
  });

  it("does not render float noise", () => {
    const c = consensus(spec([[2.35, "a"]], "km"));
    expect(c.display).toBe("2.35 km");
  });

  it("omits the unit when the attribute has none", () => {
    // An attribute with no measured unit: nothing to get wrong, so a bare figure is counted.
    const c = consensus({
      ...spec([
        [5, "a"],
        [5, "b"],
      ]),
      key: "launch_tubes",
      label: "Launch tubes",
    });
    expect(c.display).toBe("5");
  });

  it("reads currency from evidence for a numeric unit_cost claim", () => {
    // Clark's stored claim: value 50000, no unit, no normalized, but evidence contains "$50,000".
    const c = consensus({
      key: "unit_cost",
      label: "Unit Cost / Price",
      semantic: "cost.unit",
      discoveredBy: "ai",
      claims: [
        {
          value: 50000,
          source: "Defense Express",
          date: "2026-10-23T12:01:36.545Z",
          raw: "VoltX expects Clark will cost approximately $50,000 per unit and will be capable of intercepting not only drones but also cruise missiles.",
          evidence: "VoltX expects Clark will cost approximately $50,000 per unit.",
        },
      ],
    });
    expect(c.display).toBe("50000 USD");
    expect(c.sources).toBe(1);
  });
});
