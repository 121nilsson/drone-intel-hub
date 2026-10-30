import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRememberedSearch } from "@/shared/ui/remembered";

/**
 * A list page comes back the way it was left, but only when it is opened bare: a link that
 * carries its own filters is the analyst asking for that view, and must not be overridden.
 */
const KEY = "drone-intel:view:catalog";

afterEach(() => window.localStorage.clear());

describe("remembered search", () => {
  it("restores the last filters when the page is opened without any", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ op: "UA", dom: "Air" }));
    const setUrl = vi.fn();
    renderHook(() => useRememberedSearch("catalog", {}, setUrl));
    expect(setUrl).toHaveBeenCalledWith({ op: "UA", dom: "Air" });
    // The bare URL on the way in does not overwrite what it is restoring.
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual({ op: "UA", dom: "Air" });
  });

  it("leaves a link's own filters alone and remembers them instead", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ op: "UA" }));
    const setUrl = vi.fn();
    renderHook(() => useRememberedSearch("catalog", { org: "RU" }, setUrl));
    expect(setUrl).not.toHaveBeenCalled();
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual({ org: "RU" });
  });

  it("ignores a damaged entry", () => {
    window.localStorage.setItem(KEY, "{not json");
    const setUrl = vi.fn();
    expect(() => renderHook(() => useRememberedSearch("catalog", {}, setUrl))).not.toThrow();
    expect(setUrl).not.toHaveBeenCalled();
  });
});
