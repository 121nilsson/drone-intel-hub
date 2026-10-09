import { describe, expect, it } from "vitest";
import { ieeeBandsFor, ieeeLabel, natoBandsFor, natoLabel, IEEE_BANDS, NATO_BANDS } from "@/entities/normalization/bands";

describe("IEEE bands", () => {
  it("returns the correct band for single frequencies", () => {
    expect(ieeeBandsFor([300, 300])).toEqual(["UHF"]);
    expect(ieeeBandsFor([1000, 1000])).toEqual(["L"]);
    expect(ieeeBandsFor([2000, 2000])).toEqual(["S"]);
    expect(ieeeBandsFor([4000, 4000])).toEqual(["C"]);
    expect(ieeeBandsFor([8000, 8000])).toEqual(["X"]);
    expect(ieeeBandsFor([12_000, 12_000])).toEqual(["Ku"]);
    expect(ieeeBandsFor([18_000, 18_000])).toEqual(["K"]);
    expect(ieeeBandsFor([27_000, 27_000])).toEqual(["Ka"]);
  });

  it("returns intersecting bands for ranges that span multiple bands", () => {
    expect(ieeeBandsFor([950, 1100])).toEqual(["UHF", "L"]);
    expect(ieeeBandsFor([2000, 3000])).toEqual(["S"]);
    expect(ieeeBandsFor([3000, 5000])).toEqual(["S", "C"]);
    expect(ieeeBandsFor([7000, 9000])).toEqual(["C", "X"]);
    expect(ieeeBandsFor([10_000, 15_000])).toEqual(["X", "Ku"]);
  });

  it("handles boundary frequencies correctly - a boundary lands in exactly one band", () => {
    expect(ieeeBandsFor([300, 300])).toEqual(["UHF"]);
    expect(ieeeBandsFor([1000, 1000])).toEqual(["L"]);
    expect(ieeeBandsFor([2000, 2000])).toEqual(["S"]);
    expect(ieeeBandsFor([4000, 4000])).toEqual(["C"]);
    expect(ieeeBandsFor([8000, 8000])).toEqual(["X"]);
    expect(ieeeBandsFor([12_000, 12_000])).toEqual(["Ku"]);
    expect(ieeeBandsFor([18_000, 18_000])).toEqual(["K"]);
    expect(ieeeBandsFor([27_000, 27_000])).toEqual(["Ka"]);
    expect(ieeeBandsFor([40_000, 40_000])).toEqual(["Ka"]);
  });

  it("returns the correct label for IEEE band ids", () => {
    expect(ieeeLabel("VHF")).toBe("IEEE VHF");
    expect(ieeeLabel("UHF")).toBe("IEEE UHF");
    expect(ieeeLabel("L")).toBe("IEEE L");
    expect(ieeeLabel("S")).toBe("IEEE S");
    expect(ieeeLabel("C")).toBe("IEEE C");
    expect(ieeeLabel("X")).toBe("IEEE X");
    expect(ieeeLabel("Ku")).toBe("IEEE Ku");
    expect(ieeeLabel("K")).toBe("IEEE K");
    expect(ieeeLabel("Ka")).toBe("IEEE Ka");
    expect(ieeeLabel("UNKNOWN")).toBe("IEEE UNKNOWN");
  });
});

describe("NATO bands", () => {
  it("returns the correct band for single frequencies", () => {
    expect(natoBandsFor([0, 0])).toEqual(["A"]);
    expect(natoBandsFor([250, 250])).toEqual(["B"]);
    expect(natoBandsFor([500, 500])).toEqual(["C"]);
    expect(natoBandsFor([1000, 1000])).toEqual(["D"]);
    expect(natoBandsFor([2000, 2000])).toEqual(["E"]);
    expect(natoBandsFor([3000, 3000])).toEqual(["F"]);
    expect(natoBandsFor([4000, 4000])).toEqual(["G"]);
    expect(natoBandsFor([6000, 6000])).toEqual(["H"]);
    expect(natoBandsFor([8000, 8000])).toEqual(["I"]);
    expect(natoBandsFor([10_000, 10_000])).toEqual(["J"]);
    expect(natoBandsFor([20_000, 20_000])).toEqual(["K"]);
    expect(natoBandsFor([40_000, 40_000])).toEqual(["L"]);
    expect(natoBandsFor([60_000, 60_000])).toEqual(["M"]);
  });

  it("returns intersecting bands for ranges that span multiple bands", () => {
    expect(natoBandsFor([200, 300])).toEqual(["A", "B"]);
    expect(natoBandsFor([500, 1500])).toEqual(["C", "D"]);
    expect(natoBandsFor([2000, 4000])).toEqual(["E", "F", "G"]);
    expect(natoBandsFor([5000, 7000])).toEqual(["G", "H"]);
    expect(natoBandsFor([15_000, 25_000])).toEqual(["J", "K"]);
  });

  it("handles boundary frequencies correctly", () => {
    expect(natoBandsFor([250, 250])).toEqual(["B"]);
    expect(natoBandsFor([500, 500])).toEqual(["C"]);
    expect(natoBandsFor([1000, 1000])).toEqual(["D"]);
    expect(natoBandsFor([2000, 2000])).toEqual(["E"]);
    expect(natoBandsFor([10_000, 10_000])).toEqual(["J"]);
    expect(natoBandsFor([20_000, 20_000])).toEqual(["K"]);
    expect(natoBandsFor([40_000, 40_000])).toEqual(["L"]);
    expect(natoBandsFor([60_000, 60_000])).toEqual(["M"]);
    expect(natoBandsFor([100_000, 100_000])).toEqual(["M"]);
  });

  it("returns the correct label for NATO band ids", () => {
    expect(natoLabel("A")).toBe("NATO A");
    expect(natoLabel("B")).toBe("NATO B");
    expect(natoLabel("C")).toBe("NATO C");
    expect(natoLabel("D")).toBe("NATO D");
    expect(natoLabel("E")).toBe("NATO E");
    expect(natoLabel("F")).toBe("NATO F");
    expect(natoLabel("G")).toBe("NATO G");
    expect(natoLabel("H")).toBe("NATO H");
    expect(natoLabel("I")).toBe("NATO I");
    expect(natoLabel("J")).toBe("NATO J");
    expect(natoLabel("K")).toBe("NATO K");
    expect(natoLabel("L")).toBe("NATO L");
    expect(natoLabel("M")).toBe("NATO M");
    expect(natoLabel("UNKNOWN")).toBe("NATO UNKNOWN");
  });
});

describe("band definitions", () => {
  it("IEEE_BANDS has the correct structure and order", () => {
    expect(IEEE_BANDS.length).toBe(9);
    expect(IEEE_BANDS[0].id).toBe("VHF");
    expect(IEEE_BANDS[0].minMHz).toBe(30);
    expect(IEEE_BANDS[0].maxMHz).toBe(300);
    expect(IEEE_BANDS[8].id).toBe("Ka");
    expect(IEEE_BANDS[8].minMHz).toBe(27_000);
    expect(IEEE_BANDS[8].maxMHz).toBe(40_000);
  });

  it("NATO_BANDS has the correct structure and order", () => {
    expect(NATO_BANDS.length).toBe(13);
    expect(NATO_BANDS[0].id).toBe("A");
    expect(NATO_BANDS[0].minMHz).toBe(0);
    expect(NATO_BANDS[0].maxMHz).toBe(250);
    expect(NATO_BANDS[12].id).toBe("M");
    expect(NATO_BANDS[12].minMHz).toBe(60_000);
    expect(NATO_BANDS[12].maxMHz).toBe(100_000);
  });
});
