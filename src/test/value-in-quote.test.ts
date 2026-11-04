import { describe, expect, it } from "vitest";
import { readsAsSentence, valueInQuote } from "@/entities/drone/value-in-quote";
import { extractUnitPrice } from "@/shared/infra/heuristics/pricing";
import { verifyClaim } from "@/entities/drone/verification";
import type { Drone, SpecAttribute, SpecClaim } from "@/entities/drone/types";

const stated = (value: string, quote: string) => {
  const v = valueInQuote(value, quote);
  return v.applicable ? v.stated : undefined;
};

describe("valueInQuote", () => {
  it("finds a figure written with thousands grouping", () => {
    expect(stated("1200", "claimed range of 1,200 kilometers")).toBe(true);
    expect(stated("3000 м", "flight altitude up to 3 000 meters")).toBe(true);
  });

  it("finds a figure written as a number word", () => {
    expect(stated("up to 7 hours", "can remain airborne for up to seven hours")).toBe(true);
    expect(stated("four", "a four-hour endurance")).toBe(true);
  });

  it("reads a magnitude word on either side", () => {
    expect(stated("100000000", "орієнтовна вартість «Небо-У» – $100 млн.")).toBe(true);
    expect(stated("$2 billion", "a contract worth 2,000,000,000 dollars")).toBe(true);
  });

  it("does not take a figure the quote does not state", () => {
    // The Iskander-M case: the quote is about the other system's margin, not this range.
    expect(stated("500", "That is 200 km further than the Iskander-M.")).toBe(false);
    expect(stated("до 20", "AD-2 имеет аналогичные дальность и высоту поражения")).toBe(false);
  });

  it("does not read a grouped figure as its first group", () => {
    expect(stated("2", "a range of 2,000 km")).toBe(false);
  });

  it("needs every figure of a range in the quote", () => {
    expect(stated("10–20 km", "between 10 and 20 km")).toBe(true);
    expect(stated("10–25 km", "between 10 and 20 km")).toBe(false);
  });

  it("takes a text value whose words the quote carries", () => {
    expect(
      stated(
        "Modular, scalable counter-UAS mission orchestration system",
        "a modular, scalable counter-UAS mission orchestration system that connects sensors",
      ),
    ).toBe(true);
  });

  it("does not take a text value quoted from another sentence", () => {
    expect(
      stated(
        "Modular, scalable counter-UAS mission orchestration system connecting distributed sensors",
        "Halo_Shield is focused on the tactical level of combat and supports the transmission of critical battlefield information",
      ),
    ).toBe(false);
  });

  it("has nothing to say without a quote or a value", () => {
    expect(valueInQuote("500", "").applicable).toBe(false);
    expect(valueInQuote("", "range of 500 km").applicable).toBe(false);
  });
});

describe("verifyClaim with a quote that does not state the value", () => {
  const description = (evidence: string): SpecClaim => ({
    id: "c1",
    value: "Modular, scalable counter-UAS mission orchestration system",
    source: "Defense News",
    date: "2026-10-01T00:00:00.000Z",
    evidence,
    sourceId: "p1",
  });
  const spec = (claim: SpecClaim): SpecAttribute => ({
    key: "description",
    label: "Description",
    discoveredBy: "ai",
    claims: [claim],
  });
  const drone = (s: SpecAttribute) =>
    ({
      id: "halo",
      name: "Halo_Shield",
      aliases: [],
      domain: "Multi",
      origin: "US",
      operators: [],
      propulsion: "Unknown",
      summary: "",
      specs: [s],
      rf: [],
      createdAt: "",
      updatedAt: "",
    }) as unknown as Drone;

  const post =
    "Halo_Shield is a modular, scalable counter-UAS mission orchestration system. " +
    "Halo_Shield is focused on the tactical level of combat and supports legacy C2 systems.";

  it("is uncertain, never rejected, when the quote is a true sentence about something else", () => {
    const claim = description("Halo_Shield is focused on the tactical level of combat");
    const s = spec(claim);
    const v = verifyClaim({ drone: drone(s), spec: s, claim, text: post })!;
    expect(v.checks.find((c) => c.kind === "value_in_quote")).toMatchObject({
      verdict: "uncertain",
      applicable: true,
    });
    expect(v.state).toBe("uncertain");
  });

  it("verifies the same claim when its quote states it", () => {
    const claim = description(
      "Halo_Shield is a modular, scalable counter-UAS mission orchestration system",
    );
    const s = spec(claim);
    const v = verifyClaim({ drone: drone(s), spec: s, claim, text: post })!;
    expect(v.checks.find((c) => c.kind === "value_in_quote")?.verdict).toBe("pass");
    expect(v.state).toBe("verified");
  });
});

describe("a figure whose reading is a sentence", () => {
  const anthem =
    "Specifically in this case Anthem from Covenant has declared cost of less than $1 million per unit, engagement range up to 1,500 kilometers, and warhead up to 200 kilograms.";

  it("is recognised, so the quote check cannot pass it on a sentence containing itself", () => {
    expect(readsAsSentence(1_000_000, anthem)).toBe(true);
  });

  it("leaves a long attribute phrase and a text value alone", () => {
    expect(readsAsSentence(50, "line of sight (LOS) transmission range of up to 50 km")).toBe(
      false,
    );
    expect(readsAsSentence("Reconnaissance and signal relay", anthem)).toBe(false);
  });

  it("makes the claim uncertain, not verified", () => {
    const claim: SpecClaim = {
      id: "c2",
      value: 1_000_000,
      raw: anthem,
      evidence: anthem,
      source: "Militarnyi",
      date: "2026-10-01T00:00:00.000Z",
      sourceId: "p2",
    };
    const spec: SpecAttribute = {
      key: "unit_cost",
      label: "Unit Cost / Price",
      unit: "USD",
      discoveredBy: "ai",
      claims: [claim],
    };
    const anthemDrone = {
      id: "anthem",
      name: "Anthem",
      aliases: [],
      specs: [spec],
    } as unknown as Drone;
    const v = verifyClaim({ drone: anthemDrone, spec, claim, text: anthem })!;
    expect(v.checks.find((c) => c.kind === "value_in_quote")?.verdict).toBe("uncertain");
    expect(v.state).not.toBe("verified");
  });
});

describe("the heuristic's unit price", () => {
  it("reads as the price and its bound, with the sentence kept as evidence", () => {
    const sentence = "Anthem has declared cost of less than $1 million per unit.";
    expect(extractUnitPrice(sentence)).toMatchObject({
      phrase: "less than $1 million",
      evidence: sentence,
    });
    expect(extractUnitPrice("Вартість одного дрона — до 5 тисяч доларів.")?.phrase).toMatch(
      /^до 5 тисяч/,
    );
    expect(extractUnitPrice("Each drone costs $20,000.")?.phrase).toBe("$20,000");
  });
});
