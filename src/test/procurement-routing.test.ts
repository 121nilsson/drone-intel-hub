import { describe, expect, it } from "vitest";
import type { Extraction } from "@/entities/drone/types";
import {
  isFinancialSpecKey,
  procurementsFrom,
  splitFinancialSpecs,
} from "@/entities/procurement/routing";

const base: Extraction = {
  name: "Akash",
  aliases: [],
  operators: [],
  rfBands: [],
  confidence: 0.8,
  rationale: "",
  specs: [
    { key: "range", label: "Range", value: 30, unit: "km", evidence: "30 km" },
    { key: "unit_cost", label: "Unit Cost", value: "$15,000", evidence: "$15,000 per unit" },
    {
      key: "contract_value",
      label: "Contract value",
      value: "$2 billion",
      evidence: "signing defense contracts worth nearly $2 billion",
    },
  ],
};

describe("procurement routing", () => {
  it("contract value leaves drone specs; unit cost stays", () => {
    const r = splitFinancialSpecs(base);
    expect(r.extraction.specs.map((s) => s.key)).toEqual(["range", "unit_cost"]);
    expect(r.financial.map((s) => s.key)).toEqual(["contract_value"]);
  });

  it("recognises AI-invented financial keys", () => {
    for (const k of [
      "contractValue",
      "contract_value_usd",
      "batch_funding",
      "total_cost",
      "orderValue",
    ])
      expect(isFinancialSpecKey(k)).toBe(true);
    for (const k of ["unit_cost", "range", "max_speed", "weight"])
      expect(isFinancialSpecKey(k)).toBe(false);
  });

  it("$2 billion becomes a procurement in USD", () => {
    const [p] = procurementsFrom(splitFinancialSpecs(base).financial, base, "src", "https://x");
    expect(p?.amount).toBe("$2 billion");
    expect(p?.currency).toBe("USD");
    expect(p?.sourceUrl).toBe("https://x");
  });
});
