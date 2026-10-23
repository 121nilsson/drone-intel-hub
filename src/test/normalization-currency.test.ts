import { describe, expect, it } from "vitest";
import { parseMoney, toUSD } from "@/entities/normalization/currency";
import { extractPrice, extractPriceNumeric } from "@/shared/infra/heuristics/pricing";

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

  it("parses a currency symbol written as a suffix", () => {
    expect(parseMoney("1 900 000 ₽")).toMatchObject({ amount: 1_900_000, currency: "RUB" });
    expect(parseMoney("50 $")).toMatchObject({ amount: 50, currency: "USD" });
    expect(parseMoney("250000 ₴")).toMatchObject({ amount: 250_000, currency: "UAH" });
    expect(parseMoney("1.5 mn $")).toMatchObject({ amount: 1.5e6, currency: "USD" });
    // The full clause the user reported: suffix currency inside surrounding text.
    expect(parseMoney("Matrice 4Т -4шт- 1 900 000 ₽")).toMatchObject({
      amount: 1_900_000,
      currency: "RUB",
    });
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

describe("currency symbol after the amount", () => {
  it("parses suffix symbols with magnitudes and abbreviations", () => {
    expect(parseMoney("1 900 000 ₽")).toMatchObject({ amount: 1_900_000, currency: "RUB" });
    expect(parseMoney("1,5 млн ₽")).toMatchObject({ amount: 1.5e6, currency: "RUB" });
    expect(parseMoney("45 тыс. ₽")).toMatchObject({ amount: 45e3, currency: "RUB" });
    expect(parseMoney("500 ¥")).toMatchObject({ amount: 500, currency: "JPY" });
    expect(parseMoney("1 900 000 ₽")).toMatchObject({ amount: 1_900_000 });
  });

  it("does not pair the symbol with a number that follows it", () => {
    expect(parseMoney("1 900 000 ₽ 2 шт")).toMatchObject({ amount: 1_900_000, currency: "RUB" });
    expect(parseMoney("Matrice 4 1 900 000 ₽")).toMatchObject({ amount: 1_900_000 });
    expect(parseMoney("Matrice 4 $2000")).toMatchObject({ amount: 2000, currency: "USD" });
  });

  it("does not collapse a suffix-symbol range", () => {
    expect(parseMoney("1 500 000 ₽ – 2 000 000 ₽")).toBeUndefined();
    expect(parseMoney("1,5 млн – 2 млн ₽")).toBeUndefined();
  });

  it("extractPrice keeps magnitude, range and non-breaking spaces", () => {
    expect(extractPrice("цена 1,5 млн ₽")).toBe("1,5 млн ₽");
    expect(extractPriceNumeric("цена 1,5 млн ₽")).toMatchObject({ amount: 1.5e6, currency: "RUB" });
    expect(extractPrice("50-60 $")).toBe("50 $ - 60 $");
    expect(extractPriceNumeric("1 500 000 – 2 000 000 ₽")).toMatchObject({
      min: 1_500_000,
      max: 2_000_000,
      currency: "RUB",
    });
    expect(extractPrice("1 900 000 ₽")).toBe("1 900 000 ₽");
    expect(extractPrice("500 ¥")).toBe("500 ¥");
    expect(extractPrice("1 900 000 ₽ 2 шт")).toBe("1 900 000 ₽");
  });
});
