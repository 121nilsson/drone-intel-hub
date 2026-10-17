import { describe, expect, it } from "vitest";

import {
  fromSearchParams,
  parseCatalogSearchParams,
  toCatalogSearch,
} from "@/features/catalog/catalog-state";

/**
 * The codec is the only thing standing between a shared catalog URL and a silently different
 * filter set on the receiving side, so the round trip has to be exact — including droppable,
 * hostile, and out-of-vocabulary input.
 */
describe("catalog search codec", () => {
  it("round-trips a fully specified view", () => {
    const state = fromSearchParams({
      q: "shahed",
      sort: "updated",
      dom: "Air,Land",
      org: "RU,IR",
      band: "900 MHz",
      fiber: "1",
    });

    expect(state.sort).toBe("updated");
    expect(state.facets.domains).toEqual(["Air", "Land"]);
    expect(state.facets.fiberOnly).toBe(true);

    const params = toCatalogSearch(state);
    expect(parseCatalogSearchParams(params)).toEqual({
      q: "shahed",
      sort: "updated",
      dom: "Air,Land",
      org: "RU,IR",
      band: "900 MHz",
      fiber: "1",
    });
  });

  it("encodes nothing for the default view", () => {
    const state = fromSearchParams({});
    expect(toCatalogSearch(state)).toEqual({});
  });

  it("drops non-CSV garbage, empty lists and unknown params", () => {
    expect(parseCatalogSearchParams({ dom: ",,," })).toEqual({});
    expect(parseCatalogSearchParams({ q: "", sort: "recent" })).toEqual({});
    expect(parseCatalogSearchParams({ fiber: "yes" })).toEqual({});
  });

  it("keeps empty query strings out of the URL entirely", () => {
    const state = fromSearchParams({ q: "shahed" });
    state.q = "";
    expect(toCatalogSearch(state)).toEqual({});
  });
});
