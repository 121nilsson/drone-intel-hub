import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MIN_REFRESH_GAP_MS,
  REFRESH_INTERVAL_MS,
  refreshRepos,
  useStoreRefresh,
  type Refreshable,
} from "@/shared/infra/use-store-refresh";

/**
 * A tab left open kept the catalogue it read at startup. It is now re-read on focus and on a timer,
 * but never over an edit that has not reached the store.
 */
function repo(over: Partial<Refreshable> & { reload?: Refreshable["reload"] } = {}) {
  const reload = vi.fn(over.reload ?? (async () => {}));
  return Object.assign({ busy: false, reload }, over, { reload });
}

describe("refreshRepos", () => {
  it("re-reads every repository", async () => {
    const a = repo();
    const b = repo();
    expect(await refreshRepos([a, b])).toBe(2);
    expect(a.reload).toHaveBeenCalledTimes(1);
    expect(b.reload).toHaveBeenCalledTimes(1);
  });

  it("skips a repository with a write on its way", async () => {
    const waiting = repo({ busy: true });
    const idle = repo();
    expect(await refreshRepos([waiting, idle])).toBe(1);
    expect(waiting.reload).not.toHaveBeenCalled();
  });

  it("drops a snapshot read while a write was queued", async () => {
    const r = repo();
    await refreshRepos([r]);
    const apply = r.reload.mock.calls[0]![0]!;
    expect(apply()).toBe(true);
    (r as { busy: boolean }).busy = true;
    expect(apply()).toBe(false);
  });

  it("reports a failed reload and still refreshes the others", async () => {
    const broken = repo({
      reload: async () => {
        throw new Error("offline");
      },
    });
    const fine = repo();
    const errors: unknown[] = [];

    expect(await refreshRepos([broken, fine], (e) => errors.push(e))).toBe(1);

    expect(errors).toHaveLength(1);
    expect(fine.reload).toHaveBeenCalledTimes(1);
  });
});

describe("useStoreRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("refreshes on focus once the gap has passed, not twice in a burst", async () => {
    const r = repo();
    renderHook(() => useStoreRefresh([r], true));

    window.dispatchEvent(new Event("focus")); // too soon after startup
    await vi.advanceTimersByTimeAsync(0);
    expect(r.reload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(MIN_REFRESH_GAP_MS + 1);
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(r.reload).toHaveBeenCalledTimes(1);
  });

  it("refreshes on a timer while the tab is visible", async () => {
    const r = repo();
    renderHook(() => useStoreRefresh([r], true));

    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS + 1);

    expect(r.reload).toHaveBeenCalledTimes(1);
  });

  it("does nothing while the tab is hidden", async () => {
    const r = repo();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    renderHook(() => useStoreRefresh([r], true));

    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS + 1);

    expect(r.reload).not.toHaveBeenCalled();
  });

  it("does nothing when disabled (browser storage), and stops on unmount", async () => {
    const off = repo();
    renderHook(() => useStoreRefresh([off], false));
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 2);
    expect(off.reload).not.toHaveBeenCalled();

    const on = repo();
    const { unmount } = renderHook(() => useStoreRefresh([on], true));
    unmount();
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 2);
    expect(on.reload).not.toHaveBeenCalled();
  });
});
