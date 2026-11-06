import { describe, expect, it } from "vitest";

import { intakePageParams, parseIntakePage, withIntakePage } from "@/features/intake/intake-search";

describe("intake queue page codec", () => {
  it("reads a positive integer as the page", () => {
    expect(parseIntakePage("2")).toBe(2);
    expect(parseIntakePage("17")).toBe(17);
  });

  it("falls back to page 1 for anything that is not a positive integer", () => {
    for (const raw of [undefined, null, "", "0", "-3", "2.5", "abc", "2abc", " 2", "1e3", "007"]) {
      expect(parseIntakePage(raw), String(raw)).toBe(1);
    }
    expect(parseIntakePage(["2"])).toBe(1);
    expect(parseIntakePage(2)).toBe(1);
  });

  it("falls back to page 1 for a number too large to be a safe integer", () => {
    expect(parseIntakePage("99999999999999999999999")).toBe(1);
  });

  it("writes no param for page 1 and a string for later pages", () => {
    expect(intakePageParams(undefined)).toEqual({});
    expect(intakePageParams("1")).toEqual({});
    expect(intakePageParams("bogus")).toEqual({});
    expect(intakePageParams("3")).toEqual({ page: "3" });
  });

  it("sets, keeps and removes the page without touching draft or source", () => {
    const base = { draft: "abc", source: "tg" };
    expect(withIntakePage(base, 3)).toEqual({ draft: "abc", source: "tg", page: "3" });
    expect(withIntakePage({ ...base, page: "3" }, 4)).toEqual({
      draft: "abc",
      source: "tg",
      page: "4",
    });
    expect(withIntakePage({ ...base, page: "3" }, 1)).toEqual(base);
    expect(withIntakePage({}, 1)).toEqual({});
  });
});
