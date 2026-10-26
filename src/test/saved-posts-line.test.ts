import { describe, expect, it } from "vitest";
import { savedPostsLine } from "@/features/dispatches/saved-posts-line";

describe("saved posts header line", () => {
  it("says how much the archive truly holds when the page loads a capped window", () => {
    expect(savedPostsLine(3000, { total: 5902, pending: 291 }, 114)).toBe(
      "3,000 of 5,902 saved posts · 291 waiting for analysis",
    );
  });
  it("keeps the plain line when the archive fits the loaded window", () => {
    expect(savedPostsLine(526, { total: 526, pending: 3 }, 3)).toBe(
      "526 saved posts · 3 waiting for analysis",
    );
  });
  it("falls back to loaded-window numbers when no server backend answered", () => {
    expect(savedPostsLine(3000, null, 114)).toBe("3,000 saved posts · 114 waiting for analysis");
  });
  it("renders zero waiting posts plainly", () => {
    expect(savedPostsLine(40, { total: 40, pending: 0 }, 0)).toBe(
      "40 saved posts · 0 waiting for analysis",
    );
  });
});
