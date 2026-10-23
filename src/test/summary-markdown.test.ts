import { describe, expect, it } from "vitest";
import { parseSummary } from "@/shared/ui/summary-markdown";

describe("parseSummary", () => {
  it("reads headed sections with bullets and bold", () => {
    const blocks = parseSummary(
      "## Trends\n- **Geran-2** at $50K\n- Turkish SHORAD\n\nClosing line",
    );
    expect(blocks).toEqual([
      { type: "heading", inline: [{ text: "Trends", bold: false }] },
      {
        type: "list",
        items: [
          [
            { text: "Geran-2", bold: true },
            { text: " at $50K", bold: false },
          ],
          [{ text: "Turkish SHORAD", bold: false }],
        ],
      },
      { type: "paragraph", inline: [{ text: "Closing line", bold: false }] },
    ]);
  });

  it("keeps an unformatted summary as paragraphs and joins wrapped lines", () => {
    const blocks = parseSummary("First para\nstill first.\n\nSecond.");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      type: "paragraph",
      inline: [{ text: "First para still first." }],
    });
  });

  it("does not treat markup as anything but text", () => {
    const [b] = parseSummary("<img src=x onerror=alert(1)> **bold**");
    expect(b).toMatchObject({
      type: "paragraph",
      inline: [{ text: "<img src=x onerror=alert(1)> " }, { text: "bold", bold: true }],
    });
  });
});
