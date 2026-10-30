import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DataTable } from "@/shared/ui/data-table";
import { byFrequency } from "@/shared/ui/facets";
import { ActiveFilters, FacetGroup } from "@/shared/ui/filters";
import { Btn, Segmented } from "@/shared/ui/primitives";

/**
 * The shared controls carry behaviour every migrated page relies on: a long facet list stays
 * short until asked, selected values never hide, and a table has a card twin for phones.
 */

describe("byFrequency", () => {
  it("orders values most frequent first and alphabetically among equals, ignoring blanks", () => {
    expect(byFrequency(["SE", "UA", "RU", "UA", " ", undefined, "RU", "UA", "AT"])).toEqual([
      "UA",
      "RU",
      "AT",
      "SE",
    ]);
  });
});

describe("FacetGroup", () => {
  const options = Array.from({ length: 30 }, (_, i) => `C${String(i).padStart(2, "0")}`);

  it("shows only the first options of a long list, plus a selected one beyond them", () => {
    render(
      <FacetGroup
        label="Operator"
        options={options}
        value={["C25"]}
        onToggle={() => {}}
        limit={5}
      />,
    );
    const chips = screen.getAllByRole("button", { pressed: false });
    expect(chips.map((c) => c.textContent)).toEqual(["C00", "C01", "C02", "C03", "C04"]);
    expect(screen.getByRole("button", { pressed: true }).textContent).toBe("C25");
    expect(screen.getByRole("button", { name: "Show all 30" })).toBeInTheDocument();
  });

  it("opens to every option with a box that narrows them", () => {
    render(
      <FacetGroup label="Operator" options={options} value={[]} onToggle={() => {}} limit={5} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show all 30" }));
    expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(30);
    fireEvent.change(screen.getByRole("searchbox", { name: "Filter operator options" }), {
      target: { value: "c1" },
    });
    expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(10);
  });

  it("reports the toggled option", () => {
    const onToggle = vi.fn();
    render(<FacetGroup label="Domain" options={["Air", "Sea"]} value={[]} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: "Sea" }));
    expect(onToggle).toHaveBeenCalledWith("Sea");
  });
});

describe("ActiveFilters", () => {
  it("removes one filter by its readable name and offers clear all for several", () => {
    const clear = vi.fn();
    const clearAll = vi.fn();
    render(
      <ActiveFilters
        filters={[
          { id: "a", label: "Air", text: "Air", clear },
          { id: "b", label: "SE", text: "SE", clear: () => {} },
        ]}
        onClearAll={clearAll}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove filter: Air" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(clear).toHaveBeenCalledOnce();
    expect(clearAll).toHaveBeenCalledOnce();
  });
});

describe("DataTable", () => {
  it("renders the same rows as a table and as phone cards", () => {
    render(
      <DataTable
        label="Systems"
        columns={[
          { id: "name", header: "Name", cell: (r: { id: string }) => r.id },
          { id: "n", header: "N", width: "4rem", cell: () => "1" },
        ]}
        rows={[{ id: "Geran-2" }, { id: "Lancet-3" }]}
        rowKey={(r) => r.id}
        card={(r) => <span>card {r.id}</span>}
        testId="t"
        cardTestId="c"
      />,
    );
    const table = screen.getByTestId("t");
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(within(screen.getByTestId("c")).getByText("card Lancet-3")).toBeInTheDocument();
  });
});

describe("buttons", () => {
  it("does not submit a surrounding form unless asked to", () => {
    const submit = vi.fn((e: Event) => e.preventDefault());
    render(
      <form onSubmit={(e) => submit(e.nativeEvent)}>
        <Btn>Toggle</Btn>
        <Btn type="submit">Save</Btn>
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(submit).toHaveBeenCalledOnce();
  });

  it("marks the chosen segment as pressed", () => {
    const onChange = vi.fn();
    render(
      <Segmented
        label="View"
        value="compact"
        onChange={onChange}
        options={[
          { value: "compact", label: "Compact" },
          { value: "cards", label: "Cards" },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Compact" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Cards" }));
    expect(onChange).toHaveBeenCalledWith("cards");
  });
});
