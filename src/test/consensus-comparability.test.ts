import { describe, expect, it } from "vitest";
import { consensus } from "@/entities/drone/consensus";
import type { SpecAttribute, SpecClaim } from "@/entities/drone/types";
import { simHash64 } from "@/entities/dispatch/simhash";
import { normalizeQuantityLoose } from "@/entities/normalization/units";

const at = (i: number) => `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`;

/** A claim with its wording; the value is read from the wording when it is not a number. */
const stated = (raw: string, source: string, i = 0, extra: Partial<SpecClaim> = {}): SpecClaim => ({
  value: raw,
  raw,
  source,
  date: at(i),
  ...extra,
});

const attribute = (
  semantic: string,
  claims: SpecClaim[],
  canonicalUnit?: string,
): SpecAttribute => ({
  key: semantic,
  label: semantic,
  semantic,
  ...(canonicalUnit ? { canonicalUnit } : {}),
  discoveredBy: "ai",
  claims,
});

describe("consensus comparability", () => {
  it("does not call 100, 105 and 130 km a dispute (spread 30 is below 0.6 of 105)", () => {
    const c = consensus(
      attribute(
        "range.max",
        [stated("100 km", "a", 0), stated("105 km", "b", 1), stated("130 km", "c", 2)],
        "km",
      ),
    );
    expect(c.disputed).toBe(false);
    expect(c.display).toBe("105 km");
  });

  it("does not call 20–35, 25–40 and 50 kW a dispute, and keeps each source's range", () => {
    const c = consensus(
      attribute(
        "power.max",
        [
          stated("20–35 kW", "Outlet A · https://a", 0),
          stated("25–40 kW", "Outlet B · https://b", 1),
          stated("50 kW", "Outlet C · https://c", 2),
        ],
        "W",
      ),
    );
    expect(c.disputed).toBe(false);
    // Two explicit ranges, one per source. Nothing merges them into a 20–40 range.
    expect(c.explicitRanges).toHaveLength(2);
    expect(c.explicitRanges!.map((r) => r.source)).toEqual([
      "Outlet A · https://a",
      "Outlet B · https://b",
    ]);
    expect(c.explicitRanges!.map((r) => [r.min, r.max])).toEqual([
      [20000, 35000],
      [25000, 40000],
    ]);
    expect(c.explicitRanges!.every((r) => r.kind === "range")).toBe(true);
    expect(c.explicitRanges!.every((r) => r.canonicalUnit === "W")).toBe(true);
  });

  it("never shows two sources' ranges as the envelope of both: no source stated that span", () => {
    const c = consensus(
      attribute(
        "power.max",
        [
          stated("20–35 kW", "Outlet A · https://a", 0),
          stated("25–40 kW", "Outlet B · https://b", 1),
        ],
        "W",
      ),
    );
    expect(c.disputed).toBe(false);
    expect(c.display).not.toContain("–");
    expect(c.display).toBe("32500 W");
    expect(c.explicitRanges).toHaveLength(2);
    // One source's own range is still shown as it was written.
    const single = consensus(
      attribute("power.max", [stated("20–35 kW", "Outlet A · https://a", 0)], "W"),
    );
    expect(single.display).toBe("20000–35000 W");
  });

  it("compares a point with an upper bound and an upper bound with a lower bound by their gap", () => {
    // Point 300 against "up to 100": the gap is 200, above 0.6 of 300. Disputed.
    const disputed = consensus(
      attribute("range.max", [stated("300 km", "a", 0), stated("up to 100 km", "b", 1)], "km"),
    );
    expect(disputed.disputed).toBe(true);
    expect(disputed.explicitRanges).toEqual([
      expect.objectContaining({ kind: "up_to", max: 100, canonicalUnit: "km" }),
    ]);

    // Point 150 against "up to 100": the gap is 50, below 0.6 of 150. Not disputed.
    const close = consensus(
      attribute("range.max", [stated("150 km", "a", 0), stated("up to 100 km", "b", 1)], "km"),
    );
    expect(close.disputed).toBe(false);

    // "up to 100" against "at least 120": the gap is 20. Not disputed.
    const bounds = consensus(
      attribute(
        "range.max",
        [stated("up to 100 km", "a", 0), stated("at least 120 km", "b", 1)],
        "km",
      ),
    );
    expect(bounds.disputed).toBe(false);
    expect(bounds.median).toBeUndefined();
  });

  it("uses the absolute tolerance around a zero median", () => {
    // The median is 0, so the relative tolerance is 0 and the count tolerance of 1 decides.
    const spreadApart = consensus(
      attribute("capacity.target_channels", [
        stated("0", "a", 0, { value: 0 }),
        stated("0", "b", 1, { value: 0 }),
        stated("50", "c", 2, { value: 50 }),
      ]),
    );
    expect(spreadApart.median).toBe(0);
    expect(spreadApart.disputed).toBe(true);

    const withinAbs = consensus(
      attribute("capacity.target_channels", [
        stated("0", "a", 0, { value: 0 }),
        stated("0", "b", 1, { value: 0 }),
        stated("0.5", "c", 2, { value: 0.5 }),
      ]),
    );
    expect(withinAbs.median).toBe(0);
    expect(withinAbs.disputed).toBe(false);
  });

  it("handles negative values with the magnitude of the median", () => {
    // Altitude below sea level: the same tolerance as positive figures of the same size.
    const agree = consensus(
      attribute(
        "altitude.min",
        [
          stated("-100 km", "a", 0, { value: -100 }),
          stated("-105 km", "b", 1, { value: -105 }),
          stated("-130 km", "c", 2, { value: -130 }),
        ],
        "km",
      ),
    );
    expect(agree.disputed).toBe(false);
    expect(agree.median).toBe(-105);
    expect(agree.display).toBe("-105 km");
    expect(agree.spreadPct).toBeCloseTo(30 / 105, 6);

    const disagree = consensus(
      attribute(
        "altitude.min",
        [stated("-100 km", "a", 0, { value: -100 }), stated("-300 km", "b", 1, { value: -300 })],
        "km",
      ),
    );
    expect(disagree.disputed).toBe(true);
    expect(disagree.display).toBe("-100 km");
  });

  it("shows the median, never the min–max envelope, when disputed", () => {
    const c = consensus(
      attribute(
        "range.max",
        [
          stated("1000 km", "a", 0, { value: 1000 }),
          stated("4000 km", "b", 1, { value: 4000 }),
          stated("5000 km", "c", 2, { value: 5000 }),
        ],
        "km",
      ),
    );
    expect(c.disputed).toBe(true);
    expect(c.display).toBe("4000 km");
    expect(c.display).not.toContain("–");
    // The envelope stays on the object for compatibility, and only there.
    expect(c.min).toBe(1000);
    expect(c.max).toBe(5000);
  });

  it("reports the spread between point readings only, and none for a single point", () => {
    const two = consensus(
      attribute(
        "range.max",
        [stated("100 km", "a", 0, { value: 100 }), stated("130 km", "b", 1, { value: 130 })],
        "km",
      ),
    );
    expect(two.observedSpread).toEqual({ min: 100, max: 130 });

    const one = consensus(attribute("range.max", [stated("100 km", "a", 0, { value: 100 })], "km"));
    expect(one.observedSpread).toBeUndefined();
  });

  it("does not put a range or bound into the observed spread", () => {
    const c = consensus(
      attribute(
        "range.max",
        [stated("100 km", "a", 0, { value: 100 }), stated("up to 900 km", "b", 1)],
        "km",
      ),
    );
    expect(c.observedSpread).toBeUndefined();
    expect(c.explicitRanges).toEqual([expect.objectContaining({ kind: "up_to", max: 900 })]);
  });

  it("counts one wire text carried by two outlets as one observation, even with different figures", () => {
    const text = "Drone X has a range of 150 kilometres according to the ministry statement.";
    const hash = simHash64(text);
    const c = consensus(
      attribute(
        "range.max",
        [
          stated("100 km", "Outlet One · https://one", 0, {
            value: 100,
            lineage: { contentHash: hash },
          }),
          stated("150 km", "Outlet Two · https://two", 1, {
            value: 150,
            lineage: { contentHash: hash },
          }),
        ],
        "km",
      ),
    );
    expect(c.sources).toBe(1);
    expect(c.disputed).toBe(false);
    expect(c.display).toBe("150 km");
  });

  it("counts an outlet that publishes two figures once, with its latest", () => {
    const c = consensus(
      attribute(
        "range.max",
        [
          stated("100 km", "Ukrinform (War) · https://a", 0, { value: 100 }),
          stated("130 km", "Ukrinform (Economy) · https://b", 1, { value: 130 }),
        ],
        "km",
      ),
    );
    expect(c.sources).toBe(1);
    expect(c.disputed).toBe(false);
    expect(c.display).toBe("130 km");
    expect(c.observedSpread).toBeUndefined();
  });

  it("does not show a bound-only dispute as a source range", () => {
    const c = consensus(
      attribute(
        "range.max",
        [stated("up to 100 km", "a", 0), stated("at least 300 km", "b", 1)],
        "km",
      ),
    );
    expect(c.disputed).toBe(true);
    expect(c.display).not.toContain("–");
    expect(c.explicitRanges).toHaveLength(2);
  });

  it("keeps a single source's range as its display when nothing disagrees", () => {
    const c = consensus(
      attribute("range.max", [stated("20–35 kW", "Outlet A · https://a", 0)], "W"),
    );
    expect(c.disputed).toBe(false);
    expect(c.display).toBe("20000–35000 W");
    expect(c.explicitRanges).toEqual([
      expect.objectContaining({ kind: "range", min: 20000, max: 35000 }),
    ]);
  });

  it("gives a unit basis to an explicit range only when a unit is evidenced", () => {
    // A bare figure with no unit in its text and no quoted unit has no canonical number to keep.
    const bare = consensus(
      attribute("range.max", [stated("20–35", "a", 0, { raw: "20–35", value: "20–35" })], "km"),
    );
    expect(bare.explicitRanges ?? []).toEqual([]);

    // The reading was taken from the quote ("20–35 km"); the figure's own text has no unit.
    const quoted = consensus(
      attribute(
        "range.max",
        [
          stated("20–35", "a", 0, {
            raw: "20–35",
            value: "20–35",
            normalized: normalizeQuantityLoose("20–35 km")!,
            sourceUnit: "km",
            sourceUnitBasis: "quote",
          }),
        ],
        "km",
      ),
    );
    expect(quoted.explicitRanges).toEqual([
      expect.objectContaining({ unitBasis: "quote", rawUnit: "km" }),
    ]);
  });

  it("keeps the claim's id when it has one and falls back to a stable key when it does not", () => {
    const c = consensus(
      attribute(
        "range.max",
        [stated("20–35 km", "a", 0, { id: "claim-1" }), stated("up to 50 km", "b", 1)],
        "km",
      ),
    );
    const ids = c.explicitRanges!.map((r) => r.claimId);
    expect(ids[0]).toBe("claim-1");
    expect(ids[1]).toEqual(expect.any(String));
    expect(ids[1]!.length).toBeGreaterThan(0);
  });
});

describe("what a consensus shows is something a source said or a central figure", () => {
  it("shows a lower and an upper bound as two statements, never as a span", () => {
    const c = consensus(
      attribute(
        "range.max",
        [
          stated("at least 20 km", "Outlet A · https://a", 0),
          stated("up to 100 km", "Outlet B · https://b", 1),
        ],
        "km",
      ),
    );
    expect(c.display).toBe("≥20 km · ≤100 km");
    expect(c.display).not.toContain("–");
  });

  it("shows a range with an upper bound as the central figure, not as the span of both", () => {
    const c = consensus(
      attribute(
        "power.max",
        [
          stated("20–35 kW", "Outlet A · https://a", 0),
          stated("up to 50 kW", "Outlet B · https://b", 1),
        ],
        "W",
      ),
    );
    expect(c.display).not.toBe("20000–50000 W");
    expect(c.display).not.toContain("–");
  });

  it("keeps min below max when a lower bound sits above an upper one", () => {
    const c = consensus(
      attribute(
        "range.max",
        [
          stated("up to 10 km", "Outlet A · https://a", 0),
          stated("at least 100 km", "Outlet B · https://b", 1),
        ],
        "km",
      ),
    );
    expect(c.min!).toBeLessThanOrEqual(c.max!);
    expect(c.disputed).toBe(true);
  });
});

describe("what a source is, and which figure speaks for it", () => {
  it("lists a stated range with its evidenced unit, and leaves out one whose unit is only an extractor's", () => {
    const wrote = consensus(
      attribute("power.max", [stated("20–35 kW", "Outlet A · https://a", 0)], "W"),
    );
    expect(wrote.explicitRanges?.[0]).toMatchObject({ unitBasis: "value_text" });
    expect(wrote.explicitRanges?.[0]?.rawUnit).toBeDefined();

    // Read from "20–35" plus the attribute's "kW": the normalized reading holds a unit nobody wrote.
    const built: SpecClaim = {
      value: "20–35",
      source: "Outlet B · https://b",
      date: at(1),
      normalized: normalizeQuantityLoose("20–35 kW")!,
    };
    const c = consensus(attribute("power.max", [built], "W"));
    expect(c.explicitRanges).toBeUndefined();
  });

  it("does not aggregate a figure whose extractor unit and source text disagree", () => {
    const conflicted: SpecClaim = {
      value: 105,
      source: "Outlet A · https://a",
      date: at(0),
      sourceUnit: "kg",
      sourceUnitBasis: "conflict",
      normalized: normalizeQuantityLoose("105 kg")!,
    };
    const ok = stated("40 kg", "Outlet B · https://b", 1);
    const c = consensus(attribute("weight.mtow", [conflicted, ok], "kg"));
    expect(c.display).toBe("40 kg");
    expect(c.sources).toBe(1);
  });

  it("does not make every claim without a source name one source", () => {
    const c = consensus(
      attribute("range.max", [stated("40 km", "", 0), stated("41 km", "", 1)], "km"),
    );
    expect(c.sources).toBe(2);
  });

  it("lets the same claims speak the same way whatever order they are stored in", () => {
    const a = stated("40 km", "Outlet · https://x/1", 0, { id: "a" });
    const b = stated("60 km", "Outlet · https://x/2", 0, { id: "b" });
    const one = consensus(attribute("range.max", [a, b], "km"));
    const two = consensus(attribute("range.max", [b, a], "km"));
    expect(one.display).toBe(two.display);
    expect(one.sources).toBe(1);
  });
});
