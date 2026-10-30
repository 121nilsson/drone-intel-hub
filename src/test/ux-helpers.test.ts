import { describe, expect, it } from "vitest";
import { groupSpecs, headlineSpec } from "@/entities/drone/spec-groups";
import { groupSameDeal, isUnknown } from "@/entities/procurement/same-deal";
import type { SpecAttribute } from "@/entities/drone/types";
import type { Procurement } from "@/entities/procurement/types";
import { splitSourceLabel } from "@/shared/ui/source-label";
import { relativeTime } from "@/shared/ui/time";

const spec = (key: string, label: string): SpecAttribute => ({
  key,
  label,
  discoveredBy: "ai",
  claims: [{ id: key, value: "1", source: "s", date: "2026-10-30" }],
});

describe("headline figure", () => {
  it("prefers reach and speed over a contract value or a programme figure", () => {
    const specs = [
      spec("contract_value", "Contract value"),
      spec("residual_capability", "Residual Operational Capability"),
      spec("max_speed", "Maximum speed"),
      spec("range", "Maximum range"),
    ];
    expect(headlineSpec(specs)?.key).toBe("range");
  });

  it("has no headline when no figure says what the system is", () => {
    expect(headlineSpec([spec("fleet_size_poland", "Fleet size (Poland)")])).toBeUndefined();
  });
});

describe("spec groups", () => {
  it("keeps every spec and files the unclaimed ones under programme and other", () => {
    const specs = [
      spec("fleet_size_poland", "Fleet size (Poland)"),
      spec("wingspan", "Wingspan"),
      spec("range", "Maximum range"),
      spec("unit_cost", "Unit cost"),
    ];
    const groups = groupSpecs(specs);
    expect(groups.map((g) => g.id)).toEqual(["performance", "physical", "cost", "other"]);
    expect(groups.flatMap((g) => g.specs)).toHaveLength(specs.length);
  });
});

const deal = (over: Partial<Procurement>): Procurement => ({
  id: Math.random().toString(36),
  company: "Unknown",
  country: "",
  amount: "$32 million",
  source: "Defence Industry Europe",
  sourceUrl: "https://example.test/c17",
  createdAt: "2026-10-30T00:00:00Z",
  ...over,
});

describe("same deal", () => {
  it("folds one report's figure read three ways into one row, led by the named company", () => {
    const rows = [
      deal({ company: "Unknown" }),
      deal({ company: "Boeing", country: "US" }),
      deal({ company: "Boeing", country: "US", amount: "US$32 million" }),
      deal({ amount: "$97 million" }),
    ];
    const grouped = groupSameDeal(rows);
    expect(grouped).toHaveLength(2);
    expect(grouped[0]!.reports).toBe(3);
    expect(grouped[0]!.contract.company).toBe("Boeing");
  });

  it("keeps the same figure from two different reports apart", () => {
    expect(
      groupSameDeal([deal({}), deal({ sourceUrl: "https://example.test/other" })]),
    ).toHaveLength(2);
  });

  it("reads Unknown and blanks as not stated", () => {
    expect(isUnknown("Unknown")).toBe(true);
    expect(isUnknown(undefined)).toBe(true);
    expect(isUnknown("Boeing")).toBe(false);
  });
});

describe("relative time", () => {
  const now = Date.parse("2026-10-30T12:00:00Z");
  it("says how long ago, then falls back to a short date", () => {
    expect(relativeTime("2026-10-30T11:59:30Z", now)).toBe("just now");
    expect(relativeTime("2026-10-30T11:48:00Z", now)).toBe("12 min ago");
    expect(relativeTime("2026-10-30T09:00:00Z", now)).toBe("3 h ago");
    expect(relativeTime("2026-10-28T12:00:00Z", now)).toBe("2 d ago");
    expect(relativeTime("2026-10-01T12:00:00Z", now)).toMatch(/^1 Oct$/);
    expect(relativeTime("2025-10-01T12:00:00Z", now)).toMatch(/^1 Oct 2025$/);
  });

  it("parses the RFC 822 dates feeds carry, which used to be cut to '28 Oc'", () => {
    expect(relativeTime("Wed, 28 Oct 2026 10:00:00 GMT", now)).toBe("2 d ago");
  });
});

describe("source labels", () => {
  it("splits 'Feed · URL', and keeps a bare name or URL whole", () => {
    expect(splitSourceLabel("sUAS News · https://suasnews.com/x")).toEqual({
      name: "sUAS News",
      url: "https://suasnews.com/x",
    });
    expect(splitSourceLabel("armyofdrones")).toEqual({ name: "armyofdrones" });
    expect(splitSourceLabel("https://t.me/x/1")).toEqual({
      name: "https://t.me/x/1",
      url: "https://t.me/x/1",
    });
  });
});
