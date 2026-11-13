import { describe, expect, it } from "vitest";
import { clusterObservations } from "@/entities/drone/verification-sources";
import type { SpecClaim } from "@/entities/drone/types";

// 16 hex digits, the shape of a simhash fingerprint. Equal strings are the same post; these two
// differ in every bit, so they are never near-duplicates.
const POST_A = "0123456789abcdef";
const POST_FAR = "fedcba9876543210";

const claim = (source: string, contentHash?: string, value: number | string = 1): SpecClaim => ({
  value,
  source,
  date: "2026-01-01T00:00:00.000Z",
  ...(contentHash ? { lineage: { contentHash } } : {}),
});

/** The clusters as lists of sources, so an assertion reads as the grouping it means. */
const sourcesOf = (clusters: SpecClaim[][]) => clusters.map((c) => c.map((x) => x.source));

describe("clusterObservations", () => {
  it("groups claims from one outlet, whatever figure they state", () => {
    const clusters = clusterObservations([
      claim("Ukrinform (War) · https://a", undefined, 100),
      claim("Ukrinform (Economy) · https://b", undefined, 900),
      claim("Defense Express · https://c", undefined, 100),
    ]);
    expect(sourcesOf(clusters)).toEqual([
      ["Ukrinform (War) · https://a", "Ukrinform (Economy) · https://b"],
      ["Defense Express · https://c"],
    ]);
  });

  it("groups near-duplicate post hashes from different outlets", () => {
    const clusters = clusterObservations([
      claim("Outlet One · https://one", POST_A),
      claim("Outlet Two · https://two", POST_A),
      claim("Outlet Three · https://three", POST_FAR),
    ]);
    expect(sourcesOf(clusters)).toEqual([
      ["Outlet One · https://one", "Outlet Two · https://two"],
      ["Outlet Three · https://three"],
    ]);
  });

  it("keeps unrelated claims apart", () => {
    const clusters = clusterObservations([
      claim("Alpha · https://alpha", POST_A),
      claim("Beta · https://beta", POST_FAR),
      claim("Gamma · https://gamma"),
    ]);
    expect(clusters).toHaveLength(3);
    expect(clusters.every((c) => c.length === 1)).toBe(true);
  });

  it("joins a chain of links transitively, even when its ends are unrelated", () => {
    // A and B share a post; B and C share an outlet. A and C have neither in common.
    const a = claim("Wire Agency · https://a", POST_A);
    const b = claim("Regional Paper · https://b", POST_A);
    const c = claim("Regional Paper · https://c");
    const clusters = clusterObservations([a, b, c]);
    expect(clusters).toEqual([[a, b, c]]);
  });

  it("groups claims without a hash by outlet only", () => {
    const clusters = clusterObservations([
      claim("Same Outlet · https://1"),
      claim("Other Outlet · https://2"),
      claim("Same Outlet · https://3"),
    ]);
    expect(sourcesOf(clusters)).toEqual([
      ["Same Outlet · https://1", "Same Outlet · https://3"],
      ["Other Outlet · https://2"],
    ]);
  });

  it("does not join claims that carry an empty hash", () => {
    const clusters = clusterObservations([
      claim("Outlet One · https://one", ""),
      claim("Outlet Two · https://two", ""),
    ]);
    expect(clusters).toHaveLength(2);
  });

  it("returns no clusters for no claims", () => {
    expect(clusterObservations([])).toEqual([]);
  });
});
