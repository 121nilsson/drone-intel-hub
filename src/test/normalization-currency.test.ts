import { describe, expect, it } from "vitest";
import { parseMoney, toUSD } from "@/entities/normalization/currency";

describe("parseMoney", () => {
  it("keeps the currency that was written", () => {
    expect(parseMoney("$25,000")).toMatchObject({ amount: 25_000, currency: "USD" });
    expect(parseMoney("€25k")).toMatchObject({ amount: 25_000, currency: "EUR" });
    expect(parseMoney("$2.5M")).toMatchObject({ amount: 2_500_000, currency: "USD" });
    expect(parseMoney("£10000")).toMatchObject({ amount: 10_000, currency: "GBP" });
    expect(parseMoney("₽500000")).toMatchObject({ amount: 500_000, currency: "RUB" });
    expect(parseMoney("₴250000")).toMatchObject({ amount: 250_000, currency: "UAH" });
  });

  it("does not collapse a price range or invent a USD estimate", () => {
    expect(parseMoney("$15,000 - $20,000")).toBeUndefined();
    const eur = parseMoney("€25k");
    expect(eur?.usd).toBeUndefined();
    expect(eur && toUSD(eur, 1.08, "2026-10-08", "snapshot").usd).toEqual({
      value: 27_000,
      rate: 1.08,
      rateAsOf: "2026-10-08",
      rateSource: "snapshot",
    });
    expect(eur?.currency).toBe("EUR");
    expect(eur?.amount).toBe(25_000);
  });

  it("maps a bare dollar to USD unless CAD or AUD is named", () => {
    expect(parseMoney("$10 CAD")?.currency).toBe("CAD");
    expect(parseMoney("A$10")?.currency).toBe("AUD");
  });
});
