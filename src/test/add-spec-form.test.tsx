import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Drone, SpecAttribute } from "@/entities/drone/types";
import { AddSpecForm } from "@/features/dossier/add-spec-form";

const state = vi.hoisted(() => ({
  drone: undefined as unknown as Drone,
  upsert: vi.fn(),
}));

vi.mock("@/shared/infra/use-services", () => ({
  useServices: () => ({ drones: { get: () => state.drone, upsert: state.upsert } }),
}));

// The sheet is a portal in the app; keep the form in the document so the test can fill it.
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

afterEach(cleanup);

/** The key and label say nothing about load factor; only the stored semantic does. */
const loadFactor: SpecAttribute = {
  key: "structural_ceiling",
  label: "Structural ceiling",
  semantic: "maneuver.load_factor_max",
  canonicalUnit: "g_load",
  claims: [],
  discoveredBy: "ai",
};

describe("manual specification entry", () => {
  it("normalises with the selected attribute's stored semantic", async () => {
    state.drone = { id: "d1", name: "Test drone", specs: [loadFactor] } as Drone;
    state.upsert.mockReset();

    render(<AddSpecForm droneId="d1" droneName="Test drone" specs={[loadFactor]} />);
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "9 g" } });
    fireEvent.submit(screen.getByRole("button", { name: "Add claim" }).closest("form")!);

    await waitFor(() => expect(state.upsert).toHaveBeenCalled());
    const saved = state.upsert.mock.calls[0]![0] as Drone;
    const claim = saved.specs[0]!.claims[0]!;
    // Without the stored semantic this would be 9 grams, not 9 g of load.
    expect(claim.normalized).toMatchObject({
      unit: "g_load",
      canonicalUnit: "g_load",
      canonicalValue: 9,
    });
    expect(claim.value).toBe(9);
    expect(saved.specs[0]!.semantic).toBe("maneuver.load_factor_max");
  });
});
