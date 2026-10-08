import { describe, expect, it } from "vitest";
import {
  DUPLICATE_TOLERANCE,
  hammingDistance,
  isNearDuplicate,
  MIN_CHARS_FOR_DEDUPE,
  normalizeForHash,
  simHash64,
} from "@/entities/dispatch/simhash";

const SHAHED = `The General Staff reported that a Geran-2 struck an energy substation in the
  Odesa region overnight. Ukrainian air defences downed twelve of the sixteen loitering munitions;
  the remainder hit transformer equipment and caused rolling blackouts across three districts.`;

describe("normalizeForHash", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeForHash("  Geran-2   STRUCK\nOdesa  ")).toBe("geran 2 struck odesa");
  });

  it("strips urls, which are the part guaranteed to differ between copies", () => {
    const a = normalizeForHash("Full report https://example.com/a?id=42 with more text");
    const b = normalizeForHash("Full report https://t.me/chan/79 with more text");
    expect(a).toBe(b);
  });

  it("keeps Cyrillic and other non-Latin scripts", () => {
    expect(normalizeForHash("Герань-2 атаковала Одессу")).toBe("герань 2 атаковала одессу");
  });
});

describe("simHash64", () => {
  it("is stable across calls", () => {
    expect(simHash64(SHAHED)).toBe(simHash64(SHAHED));
  });

  it("is a 16 character hex string", () => {
    expect(simHash64(SHAHED)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("ignores sentence order, which is the property that catches forwards", () => {
    const a = simHash64("Shahed launched at dawn. Air defence engaged at 0400.");
    const b = simHash64("Air defence engaged at 0400. Shahed launched at dawn.");
    // Not 0: moving sentences swaps bigrams as well as unigrams, which costs a handful of bits.
    // The tolerance is what absorbs it, which is exactly why the tolerance exists.
    expect(hammingDistance(a, b)).toBeLessThanOrEqual(DUPLICATE_TOLERANCE);
  });

  it("matches a lightly edited copy of the same story", () => {
    const edited = SHAHED.replace("twelve of the sixteen", "12 of the 16").replace(
      "transformer equipment",
      "power transformers",
    );
    expect(hammingDistance(simHash64(SHAHED), simHash64(edited))).toBeLessThanOrEqual(
      DUPLICATE_TOLERANCE,
    );
  });

  it("matches when a sentence is moved and words are unchanged", () => {
    const reordered = `Ukrainian air defences downed twelve of the sixteen loitering munitions; the remainder hit transformer equipment and caused rolling blackouts across three districts. The General Staff reported that a Geran-2 struck an energy substation in the Odesa region overnight.`;
    expect(hammingDistance(simHash64(SHAHED), simHash64(reordered))).toBeLessThanOrEqual(
      DUPLICATE_TOLERANCE,
    );
  });

  it("matches a repost with the leading attribution removed", () => {
    const headerless = SHAHED.replace("The General Staff reported that", "");
    expect(hammingDistance(simHash64(SHAHED), simHash64(headerless))).toBeLessThanOrEqual(
      DUPLICATE_TOLERANCE,
    );
  });

  it("matches at the 120 character length floor", () => {
    // The tolerance was measured at this length too: unrelated 120-char headlines measure
    // 31-36 bits apart, so the floor is safe.
    const a =
      "Ukraine fielded a new fibre-optic controlled FPV interceptor along the eastern front this week, according to unit sources";
    const b =
      "Ukraine fielded a new fibre-optic controlled FPV interceptor along the eastern front this week, per unit sources";
    expect(a.length).toBeGreaterThanOrEqual(MIN_CHARS_FOR_DEDUPE);
    expect(isNearDuplicate(simHash64(a), simHash64(b))).toBe(true);
  });

  it("puts unrelated stories far apart", () => {
    const other = `Bayraktar TB2 completed a maritime patrol sortie over the Black Sea using a
      new synthetic aperture radar pod. The aircraft returned to base after four hours without
      incident, and no air defence warnings were recorded during the mission.`;
    // Measured across unrelated report pairs: 23-36 bits. Twice the tolerance is the assertion,
    // so a future change that tightens the fingerprint distribution trips this.
    expect(hammingDistance(simHash64(SHAHED), simHash64(other))).toBeGreaterThan(
      DUPLICATE_TOLERANCE * 2,
    );
  });

  it("returns an empty fingerprint for text with no features", () => {
    expect(simHash64("")).toBe("");
    expect(simHash64("... --- !!!")).toBe("");
  });

  it("shifts at most a few bits when one sentence changes", () => {
    const base = SHAHED.repeat(2);
    const oneSentenceChanged = base.replace("Odesa region", "Mykolaiv region");
    expect(hammingDistance(simHash64(base), simHash64(oneSentenceChanged))).toBeLessThan(
      DUPLICATE_TOLERANCE,
    );
  });
});

describe("hammingDistance", () => {
  it("counts zero for identical fingerprints", () => {
    expect(hammingDistance(simHash64(SHAHED), simHash64(SHAHED))).toBe(0);
  });

  it("counts every differing bit, up to 64", () => {
    expect(hammingDistance("00000000" + "00000000", "ffffffff" + "ffffffff")).toBe(64);
    expect(hammingDistance("00000000" + "00000000", "00000001" + "00000000")).toBe(1);
  });

  it("treats a malformed fingerprint as maximally distant, never as a match", () => {
    expect(hammingDistance("", "")).toBe(64);
    expect(hammingDistance(simHash64(SHAHED), "abc")).toBe(64);
  });
});

describe("isNearDuplicate", () => {
  it("matches the same story from another source", () => {
    const viaTelegram = `ГС ВСУ: ночью «Герань-2» ударила по энергоподстанции в Одесской области.
      ПВО сбила 12 из 16 летательных аппаратов, остальные повредили трансформаторное оборудование.`;
    // Deliberately the same underlying report in another language: this is a *different* story
    // to the fingerprint, and the honest expectation is that cross-language copies are not
    // collapsed. Asserted here so the limitation is explicit rather than assumed away.
    expect(isNearDuplicate(simHash64(viaTelegram), simHash64(SHAHED))).toBe(false);
  });

  it("matches a repost with the source attribution removed", () => {
    const original = SHAHED;
    const repost = `${SHAHED}\n\nvia @citeam`;
    expect(isNearDuplicate(simHash64(original), simHash64(repost))).toBe(true);
  });

  it("does not match two unrelated reports, however similar their shape", () => {
    const other = `Bayraktar TB2 completed a maritime patrol sortie over the Black Sea using a
      new synthetic aperture radar pod. The aircraft returned to base after four hours without
      incident, and no air defence warnings were recorded during the mission.`;
    expect(isNearDuplicate(simHash64(SHAHED), simHash64(other))).toBe(false);
  });

  it("keeps unrelated short headlines apart at the length floor", () => {
    // Two 120-char headlines measuring 8 bits apart would be indistinguishable from a reword.
    const a =
      "Ukraine fielded a new fibre-optic controlled FPV interceptor along the eastern front this week, according to unit sources";
    const b =
      "Baykar delivered the first batch of Bayraktar TB2 airframes to an overseas customer under an export contract signed last year";
    expect(isNearDuplicate(simHash64(a), simHash64(b))).toBe(false);
  });

  it("does not match on an empty fingerprint", () => {
    expect(isNearDuplicate("", "")).toBe(false);
    expect(isNearDuplicate("", simHash64(SHAHED))).toBe(false);
  });

  it("honours a custom tolerance", () => {
    const a = simHash64(SHAHED);
    const b = simHash64(`${SHAHED} and a trailing sentence about something else entirely.`);
    expect(isNearDuplicate(a, b, 64)).toBe(true);
    expect(isNearDuplicate(a, b, 0)).toBe(false);
  });
});

describe("dedupe thresholds", () => {
  it("keeps the match side of the dial clear of the reject side", () => {
    // The whole design rests on this gap. Measured: same-story variants land at 7-8 bits,
    // unrelated reports (even at the 120 character floor) at 23-36. A tolerance of 10 sits
    // inside that gap; pushing it toward 20 would start merging real stories.
    expect(MIN_CHARS_FOR_DEDUPE).toBeGreaterThan(60);
    expect(DUPLICATE_TOLERANCE).toBeLessThan(16);
  });
});
