import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DataTable } from "@/shared/ui/data-table";
import { MobileDrawer } from "@/shared/ui/mobile-drawer";

afterEach(cleanup);

describe("DataTable without a card of its own", () => {
  const columns = [
    { id: "name", header: "Provider", cell: (r: { name: string; model: string }) => r.name },
    { id: "model", header: "Model", cell: (r: { name: string; model: string }) => r.model },
  ];
  const rows = [{ name: "groq", model: "gpt-oss-120b" }];

  it("turns each row into a card: the first column as title, the rest as label and value", () => {
    render(
      <DataTable
        label="Providers"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.name}
        cardTestId="cards"
      />,
    );
    const cards = within(screen.getByTestId("cards"));
    expect(cards.getByText("groq")).toBeInTheDocument();
    expect(cards.getByText("Model")).toBeInTheDocument();
    expect(cards.getByText("gpt-oss-120b")).toBeInTheDocument();
  });

  it("keeps only the table when cards are switched off", () => {
    render(
      <DataTable
        label="Providers"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.name}
        cards={false}
        cardTestId="cards"
      />,
    );
    expect(screen.queryByTestId("cards")).toBeNull();
    expect(screen.getByRole("table", { name: "Providers" })).toBeInTheDocument();
  });
});

describe("MobileDrawer", () => {
  it("is a dialog with the given title, and closes on Escape", () => {
    const onOpenChange = vi.fn();
    render(
      <MobileDrawer open onOpenChange={onOpenChange} title="Menu">
        <a href="/x">A page</a>
      </MobileDrawer>,
    );
    const dialog = screen.getByRole("dialog", { name: "Menu" });
    expect(within(dialog).getByText("A page")).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders nothing while closed", () => {
    render(
      <MobileDrawer open={false} onOpenChange={() => {}} title="Menu">
        <a href="/x">A page</a>
      </MobileDrawer>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes itself when the screen grows to a desktop width", () => {
    const listeners = new Set<() => void>();
    const media = { matches: false } as MediaQueryList;
    window.matchMedia = vi.fn(
      () =>
        Object.assign(media, {
          addEventListener: (_: string, l: () => void) => listeners.add(l),
          removeEventListener: (_: string, l: () => void) => listeners.delete(l),
        }) as unknown as MediaQueryList,
    );
    const onOpenChange = vi.fn();
    render(
      <MobileDrawer open onOpenChange={onOpenChange} title="Menu">
        x
      </MobileDrawer>,
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    (media as { matches: boolean }).matches = true;
    for (const l of listeners) l();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
