import { describe, expect, it } from "vitest";
import { detectLanguagePreD0 } from "@/entities/normalization/language-legacy";
import { PRE_D0_GOLDEN } from "./fixtures/language-pre-d0-golden";

describe("the pre-D0 language rule matches its frozen facit (W1)", () => {
  it("covers every development text and the edge cases", () => {
    expect(PRE_D0_GOLDEN.length).toBe(170);
    const by = (l: string) => PRE_D0_GOLDEN.filter((r) => r.expected === l).length;
    expect([by("ru"), by("uk"), by("en"), by("unknown")]).toEqual([121, 27, 6, 16]);
  });

  it("gives exactly the 7aea9a6 answer for every facit text", () => {
    const wrong = PRE_D0_GOLDEN.filter((r) => detectLanguagePreD0(r.text) !== r.expected);
    expect(wrong).toEqual([]);
  });
});
