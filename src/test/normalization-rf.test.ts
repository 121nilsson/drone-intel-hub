import { describe, expect, it } from "vitest";
import { ieeeBandsFor, natoBandsFor } from "@/entities/normalization/bands";
import {
  effectiveIeeeBands,
  linkIsFiber,
  normalizeRF,
  parseFrequencies,
} from "@/entities/normalization/rf";

describe("frequencies and bands", () => {
  it("parses single frequencies and ranges into MHz", () => {
    expect(parseFrequencies("720 MHz")).toEqual([[720, 720]]);
    expect(parseFrequencies("720-750 MHz")).toEqual([[720, 750]]);
    expect(parseFrequencies("720–750 MHz")).toEqual([[720, 750]]);
    expect(parseFrequencies("720MHz")).toEqual([[720, 720]]);
    expect(parseFrequencies("0.915 GHz")).toEqual([[915, 915]]);
    expect(parseFrequencies("5.8 GHz")).toEqual([[5800, 5800]]);
  });

  it("returns every band a range intersects, and a boundary lands in one band", () => {
    expect(ieeeBandsFor([950, 1100])).toEqual(["UHF", "L"]);
    expect(ieeeBandsFor([1000, 1000])).toEqual(["L"]);
    expect(natoBandsFor([600, 600])).toEqual(["C"]);
    expect(natoBandsFor([500, 500])).toEqual(["C"]);
    expect(ieeeBandsFor([18_000, 18_000])).toEqual(["K"]);
    expect(ieeeBandsFor([27_000, 27_000])).toEqual(["Ka"]);
  });

  it("recomputes bands from frequency even when a stored letter disagrees", () => {
    expect(effectiveIeeeBands({ ieeeBands: ["L"], freqMHz: [868, 915] })).toEqual(["UHF"]);
    expect(natoBandsFor([868, 915])).toEqual(["C"]);
  });
});

describe("normalizeRF", () => {
  it("does not invent a frequency from a protocol or from fiber", () => {
    const elrs = normalizeRF("ExpressLRS");
    expect(elrs.protocols).toEqual(["expresslrs"]);
    expect(elrs.freqMHz).toBeUndefined();
    expect(normalizeRF("ELRS").protocols).toEqual(["expresslrs"]);
    expect(normalizeRF("Express LRS").freqMHz).toBeUndefined();

    const starlink = normalizeRF("Starlink");
    expect(starlink.protocols).toEqual(["starlink"]);
    expect(starlink.freqMHz).toBeUndefined();
    expect(starlink.ieeeBands).toEqual([]);

    const fiber = normalizeRF("fiber-optic control");
    expect(fiber.isFiberOptic).toBe(true);
    expect(fiber.role).toBe("tether");
    expect(fiber.freqMHz).toBeUndefined();
    expect(fiber.ieeeBands).toEqual([]);
  });

  it("classifies role and bands from an explicit frequency", () => {
    const c2 = normalizeRF("720–750 MHz control link");
    expect(c2.role).toBe("uplink");
    expect(c2.freqMHz).toEqual([720, 750]);
    expect(c2.ieeeBands).toEqual(["UHF"]);
    expect(c2.tacticalTag).toBe("Sub-GHz C2");
    expect(c2.confidence).toBe(0.9);

    const video = normalizeRF("5.8 GHz analog video");
    expect(video.role).toBe("video");
    expect(video.freqMHz).toEqual([5800, 5800]);
    expect(video.ieeeBands).toEqual(["C"]);

    expect(normalizeRF("GPS L1").role).toBe("gnss");
    expect(normalizeRF("GPS L1").freqMHz).toBeUndefined();
    expect(normalizeRF("Kometa-M 8-element CRPA").role).toBe("antijam");
    expect(normalizeRF("Ku-band satellite").ieeeBands).toEqual(["Ku"]);
    expect(normalizeRF("Ku-band satellite").freqMHz).toBeUndefined();
    expect(normalizeRF("nothing useful").role).toBe("unknown");
  });

  it("recognizes the seeded fiber band string", () => {
    expect(linkIsFiber({ role: "video", band: "Fiber (no RF)" })).toBe(true);
    expect(linkIsFiber({ role: "uplink", band: "UHF" })).toBe(false);
  });
});
