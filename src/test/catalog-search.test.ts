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
      sort: "domain",
      dom: "Air,Land",
      org: "RU,IR",
      band: "900 MHz",
      fiber: "1",
    });

    expect(state.sort).toBe("domain");
    expect(state.facets.domains).toEqual(["Air", "Land"]);
    expect(state.facets.fiberOnly).toBe(true);

    const params = toCatalogSearch(state);
    expect(parseCatalogSearchParams(params)).toEqual({
      q: "shahed",
      sort: "domain",
      dom: "Air,Land",
      org: "RU,IR",
      band: "900 MHz",
      fiber: "1",
    });
  });

  it("encodes nothing for the default view", () => {
    const state = fromSearchParams({});
    expect(state.sort).toBe("updated");
    expect(toCatalogSearch(state)).toEqual({});
  });

  it("keeps 'recently updated' as the default and still round-trips an explicit sort", () => {
    // An analyst opening a bare /catalog must land on the freshest evidence, not a–z.
    expect(fromSearchParams({}).sort).toBe("updated");
    expect(fromSearchParams({ sort: "name" }).sort).toBe("name");
    expect(toCatalogSearch(fromSearchParams({ sort: "name" }))).toEqual({ sort: "name" });
    expect(parseCatalogSearchParams({ sort: "updated" })).toEqual({ sort: "updated" });
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
