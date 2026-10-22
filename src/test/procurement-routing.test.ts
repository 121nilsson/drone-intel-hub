import { describe, expect, it } from "vitest";
import type { Extraction } from "@/entities/drone/types";
import {
  enrichProcurement,
  isFinancialSpecKey,
  procurementDedupeKey,
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

  it("keeps only a real ISO2 origin on the record", () => {
    const financial = splitFinancialSpecs(base).financial;
    const [unknown] = procurementsFrom(financial, { ...base, origin: "??" }, "src");
    expect(unknown?.country).toBe("");
    const [known] = procurementsFrom(financial, { ...base, origin: "se" }, "src");
    expect(known?.country).toBe("SE");
  });

  it("carries the post identity, publication date and every named system", () => {
    const multi: Extraction = {
      ...base,
      matchId: "akash",
      systems: [
        { name: "Akash", matchId: "akash" },
        { name: "Akash-NG", matchId: "akash-ng" },
      ],
    };
    const [p] = procurementsFrom(splitFinancialSpecs(multi).financial, multi, "src", "https://x", {
      sourceId: "dispatch-1",
      publishedAt: "2026-10-01",
    });
    expect(p).toMatchObject({
      sourceId: "dispatch-1",
      announcedAt: "2026-10-01T00:00:00.000Z",
      systemIds: ["akash", "akash-ng"],
      systemNames: ["Akash", "Akash-NG"],
    });
    expect(p?.dedupeKey).toBe(procurementDedupeKey(p!));
  });

  it("does not duplicate a contract when the same post is analysed again", () => {
    const financial = splitFinancialSpecs(base).financial;
    const first = procurementsFrom(financial, base, "src", "https://x", {
      sourceId: "dispatch-1",
    });
    const second = procurementsFrom(financial, base, "src", "https://x", {
      sourceId: "dispatch-1",
    });
    expect(first[0]!.id).not.toBe(second[0]!.id);
    expect(first[0]!.dedupeKey).toBe(second[0]!.dedupeKey);
  });

  it("fills only missing procurement metadata from the model", () => {
    const [p] = procurementsFrom(splitFinancialSpecs(base).financial, base, "src");
    const enriched = enrichProcurement(p!, {
      id: "model-id",
      company: "Model Co",
      country: "in",
      amount: "$1 billion",
      currency: "EUR",
      customer: "Indian MoD",
      program: "Emergency Procurement",
      product: "Akash missiles",
      announcedAt: "2026-09-20",
      notes: "Model note",
      source: "model",
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    expect(enriched).toMatchObject({
      company: "Model Co",
      country: "IN",
      amount: "$2 billion",
      currency: "USD",
      customer: "Indian MoD",
      program: "Emergency Procurement",
      product: "Akash",
      announcedAt: "2026-09-20T00:00:00.000Z",
    });
    expect(enriched.id).toBe(p!.id);
    expect(enriched.notes).not.toBe("Model note");
  });
});
