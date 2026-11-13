import { describe, expect, it } from "vitest";
import { consensus } from "@/entities/drone/consensus";
import { feedsNumbers, unitStanding } from "@/entities/drone/unit-policy";
import { boundsCheck, unitCheck } from "@/entities/drone/verification-measure";
import type { SpecAttribute, SpecClaim } from "@/entities/drone/types";
import { normalizeQuantity } from "@/entities/normalization/units";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The rule for a figure's unit: evidenced in the text is a number, anything else is not. One
 * table, applied to consensus and to the unit check alike.
 */
const spec = (claims: SpecClaim[], over: Partial<SpecAttribute> = {}): SpecAttribute => ({
  key: "payload_mass",
  label: "Payload",
  semantic: "payload.mass",
  unit: "kg",
  discoveredBy: "ai",
  claims,
  ...over,
});
const at = "2026-01-01T00:00:00.000Z";
const claim = (over: Partial<SpecClaim>): SpecClaim => ({
  value: 105,
  source: "Outlet · https://o",
  date: at,
  ...over,
});

const cases: Array<{
  name: string;
  claim: SpecClaim;
  standing: string;
  numeric: boolean;
  verdict: "pass" | "uncertain" | "fail";
}> = [
  {
    name: "unit in the value text",
    claim: claim({ value: "105 kg", raw: "105 kg" }),
    standing: "evidenced",
    numeric: true,
    verdict: "pass",
  },
  {
    name: "unit in the quote",
    claim: claim({ evidence: "The payload weighed 105 kg" }),
    standing: "evidenced",
    numeric: true,
    verdict: "pass",
  },
  {
    name: "only the extractor's unit",
    claim: claim({ sourceUnit: "kg", sourceUnitBasis: "extractor_unverified" }),
    standing: "unverified",
    numeric: false,
    verdict: "uncertain",
  },
  {
    name: "no unit anywhere",
    claim: claim({}),
    standing: "unknown",
    numeric: false,
    verdict: "uncertain",
  },
  {
    name: "a unit built into normalized, and no text with one",
    claim: claim({ normalized: normalizeQuantity("105 kg")! }),
    standing: "unknown",
    numeric: false,
    verdict: "uncertain",
  },
  {
    name: "extractor and quote disagree",
    claim: claim({
      evidence: "The payload weighed 105 lbs",
      sourceUnit: "kg",
      sourceUnitBasis: "conflict",
    }),
    standing: "conflict",
    numeric: false,
    verdict: "fail",
  },
];

describe("the unit policy", () => {
  it.each(cases)("$name", ({ claim: c, standing, numeric, verdict }) => {
    const s = spec([c]);
    expect(unitStanding(s, c)).toBe(standing);
    expect(feedsNumbers(unitStanding(s, c))).toBe(numeric);
    expect(unitCheck(s, c, at).verdict).toBe(verdict);
    const result = consensus(s);
    if (numeric) expect(result.display).toBe("105 kg");
    else {
      expect(result.display).toBe("unit unknown");
      expect(result.heldBack).toBe(1);
    }
  });

  it("keeps the claim and its figure whole when it is held back", () => {
    const c = claim({});
    const s = spec([c]);
    consensus(s);
    expect(s.claims).toEqual([c]);
    expect(c.value).toBe(105);
  });

  it("counts a figure an analyst or the seed catalogue gave with its unit", () => {
    const analyst = claim({ source: "Analyst" });
    const seeded = claim({ id: "seed:payload_mass:0:x:105:0" });
    for (const c of [analyst, seeded]) expect(unitStanding(spec([c]), c)).toBe("declared");
  });

  it("leaves an attribute with no unit to get wrong, and text that is no figure, alone", () => {
    const { unit: _kg, ...bare } = spec([claim({ value: 40 })]);
    const tubes: SpecAttribute = {
      ...bare,
      key: "launch_tubes",
      label: "Launch tubes",
      semantic: "launch_tubes",
    };
    expect(unitStanding(tubes, tubes.claims[0]!)).toBe("not_needed");
    const text = claim({ value: "solid rocket motor" });
    expect(unitStanding(spec([text]), text)).toBe("not_needed");
  });

  it("does not hold a figure against bounds when its unit is not evidenced", () => {
    const wild = claim({ value: 9_000_000 });
    expect(boundsCheck(spec([wild]), wild, at).verdict).toBe("uncertain");
    expect(boundsCheck(spec([wild]), wild, at).applicable).toBe(false);
  });
});

describe("migration 028", () => {
  const sql = readFileSync(resolve(__dirname, "../../migrations/028_audit_not_null.sql"), "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .toLowerCase();
  it("backfills legacy rows first and then makes the classification mandatory", () => {
    expect(sql).toMatch(/where a\.sampling_purpose is null/);
    expect(sql.indexOf("update verification_audit")).toBeLessThan(sql.indexOf("set not null"));
    expect(sql).toMatch(/alter column sampling_purpose set not null/);
    expect(sql).toMatch(/alter column audit_batch_id set not null/);
  });
});
