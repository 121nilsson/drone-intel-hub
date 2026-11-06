import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Collapsible } from "@/shared/ui/collapsible";
import { ExpandableText } from "@/shared/ui/expandable-text";
import { Prose } from "@/shared/ui/prose";
import { buttonClass } from "@/shared/ui/button-class";

afterEach(cleanup);

/** jsdom does no layout: say how tall the content is and how tall the cut-off box is. */
function layout(content: number, box: number) {
  const proto = HTMLElement.prototype;
  const had = {
    scroll: Object.getOwnPropertyDescriptor(proto, "scrollHeight"),
    client: Object.getOwnPropertyDescriptor(proto, "clientHeight"),
  };
  Object.defineProperty(proto, "scrollHeight", { configurable: true, get: () => content });
  Object.defineProperty(proto, "clientHeight", { configurable: true, get: () => box });
  return () => {
    for (const [k, d] of [
      ["scrollHeight", had.scroll],
      ["clientHeight", had.client],
    ] as const)
      if (d) Object.defineProperty(proto, k, d);
      else delete (proto as unknown as Record<string, unknown>)[k];
  };
}

describe("Collapsible", () => {
  it("offers nothing when the content fits", () => {
    const restore = layout(100, 100);
    render(<Collapsible lines={3}>short</Collapsible>);
    expect(screen.queryByRole("button")).toBeNull();
    restore();
  });

  it("cuts long content at the configured number of lines and expands on request", () => {
    const restore = layout(400, 60);
    render(
      <Collapsible lines={4}>
        <p>a long briefing</p>
      </Collapsible>,
    );
    const box = screen.getByText("a long briefing").parentElement!;
    expect(box.style.maxHeight).toBe("4lh");

    const more = screen.getByRole("button", { name: "Show more" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);

    expect(box.style.maxHeight).toBe("");
    const less = screen.getByRole("button", { name: "Show less" });
    expect(less).toHaveAttribute("aria-expanded", "true");
    expect(less).toHaveAttribute("aria-controls", box.id);
    fireEvent.click(less);
    expect(box.style.maxHeight).toBe("4lh");
    restore();
  });

  it("takes its own button labels", () => {
    const restore = layout(400, 60);
    render(<Collapsible moreLabel="Read all">x</Collapsible>);
    expect(screen.getByRole("button", { name: "Read all" })).toBeInTheDocument();
    restore();
  });
});

describe("ExpandableText", () => {
  it("is Collapsible around one paragraph, counted in its own clamp", () => {
    const restore = layout(400, 60);
    render(<ExpandableText text="A long post" clamp={5} className="text-sm" />);
    expect(screen.getByText("A long post").parentElement!.style.maxHeight).toBe("5lh");
    expect(screen.getByRole("button", { name: "Show more" })).toBeInTheDocument();
    restore();
  });
});

describe("what keeps a page from outgrowing the screen", () => {
  it("lets outside text wrap anywhere, so a long URL cannot widen the page", () => {
    render(<Prose>https://example.com/a-very-long-address</Prose>);
    expect(screen.getByText(/example\.com/).className).toContain("[overflow-wrap:anywhere]");
  });

  it("limits a button to its container and lets its label wrap", () => {
    const cls = buttonClass();
    expect(cls).toContain("max-w-full");
    expect(cls).toContain("[overflow-wrap:anywhere]");
  });
});
