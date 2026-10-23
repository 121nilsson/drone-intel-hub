import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider, useServices } from "@/shared/infra/services";

const { getStoreStatus, storeLoadPage, storeSeed } = vi.hoisted(() => ({
  getStoreStatus: vi.fn(),
  storeLoadPage: vi.fn(),
  storeSeed: vi.fn(),
}));

// The provider imports RemoteStore at module scope, so every server-function export it knows
// must exist even when this test never selects the server backend.
vi.mock("@/shared/infra/storage/store.functions", () => ({
  getStoreStatus,
  storeLoadPage,
  storeSeed,
  storePut: vi.fn(),
  storeRemove: vi.fn(),
  storeClaim: vi.fn(),
  storeRelease: vi.fn(),
}));

function Probe() {
  const svc = useServices();
  return (
    <div>
      <span data-testid="state">{svc.attached ? "attached" : "blocked"}</span>
      <span data-testid="error">{svc.storageError ?? ""}</span>
      <span data-testid="warning">{svc.storageWarning ?? ""}</span>
      <button onClick={() => void svc.continueInBrowser()}>Use browser</button>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  getStoreStatus.mockReset();
  storeLoadPage.mockReset();
  storeSeed.mockReset();
});

/**
 * The status call decides whether the catalog lives on the server. When it fails, the old
 * provider silently attached localStorage - giving the analyst a second, unsynced catalog while
 * the server's copy was still there. These tests pin the fail-loud behaviour and the explicit
 * escape hatch.
 */
describe("storage selection", () => {
  it("does not open browser storage when the server status is unreachable", async () => {
    getStoreStatus.mockRejectedValue(new Error("server offline"));
    render(
      <ServicesProvider>
        <Probe />
      </ServicesProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("blocked"));
    expect(screen.getByTestId("error").textContent).toMatch(/could not be reached/);
    expect(localStorage.getItem("dti.drones.v1")).toBeNull();
  });

  it("opens browser storage only after the analyst explicitly asks for it", async () => {
    getStoreStatus.mockRejectedValue(new Error("server offline"));
    render(
      <ServicesProvider>
        <Probe />
      </ServicesProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("blocked"));

    fireEvent.click(screen.getByRole("button", { name: "Use browser" }));

    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("attached"));
    await waitFor(() => expect(screen.getByTestId("warning").textContent).toMatch(/not synced/));
    expect(localStorage.getItem("dti.drones.v1")).not.toBeNull();
  });

  it("does not fall back to local data when only part of the server catalog opens", async () => {
    getStoreStatus.mockResolvedValue({ postgres: true, provider: null, providerError: null });
    storeSeed.mockResolvedValue({ ok: true });
    storeLoadPage.mockImplementation(({ data }: { data: { c: string } }) =>
      data.c === "sources"
        ? Promise.reject(new Error("sources table unavailable"))
        : Promise.resolve(JSON.stringify({ initialized: false, items: [], hasMore: false })),
    );

    render(
      <ServicesProvider>
        <Probe />
      </ServicesProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("blocked"));
    expect(screen.getByTestId("error").textContent).toMatch(
      /server catalog could not be opened.*sources table unavailable/,
    );
    expect(localStorage.getItem("dti.drones.v1")).toBeNull();

    // The explicit fallback is still available, and it switches every repository, not just the
    // ones that failed to open on the server.
    fireEvent.click(screen.getByRole("button", { name: "Use browser" }));
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("attached"));
    expect(localStorage.getItem("dti.drones.v1")).not.toBeNull();
  });
});
