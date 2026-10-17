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

describe("parseMoney reads magnitudes and currencies from the shared lexicons", () => {
  it("parses Swedish amounts", () => {
    expect(parseMoney("50 miljoner kronor")).toMatchObject({ amount: 50e6, currency: "SEK" });
    expect(parseMoney("2 miljarder SEK")).toMatchObject({ amount: 2e9, currency: "SEK" });
    expect(parseMoney("50 mkr")).toMatchObject({ amount: 50e6, currency: "SEK" });
    expect(parseMoney("$2 miljarder")).toMatchObject({ amount: 2e9, currency: "USD" });
  });

  it("parses Ukrainian and Russian amounts", () => {
    expect(parseMoney("45,6 млн грн")).toMatchObject({ amount: 45.6e6, currency: "UAH" });
    expect(parseMoney("8,5 мільйонів гривень")).toMatchObject({ amount: 8.5e6, currency: "UAH" });
    expect(parseMoney("3 миллиона рублей")).toMatchObject({ amount: 3e6, currency: "RUB" });
    expect(parseMoney("15 тыс. долларов")).toMatchObject({ amount: 15e3, currency: "USD" });
    expect(parseMoney("$1,04 мільярда")).toMatchObject({ amount: 1.04e9, currency: "USD" });
  });

  it("keeps English shorthand", () => {
    expect(parseMoney("$2 billion")).toMatchObject({ amount: 2e9, currency: "USD" });
    expect(parseMoney("$2.5m")).toMatchObject({ amount: 2.5e6, currency: "USD" });
    expect(parseMoney("10 million euros")).toMatchObject({ amount: 10e6, currency: "EUR" });
  });
});
