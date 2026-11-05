import { describe, expect, it } from "vitest";
import { awaitingBrief, summaryView, type SummaryState } from "@/features/dossier/summary-view";

const base: SummaryState = {
  hasBrief: false,
  ready: true,
  aiConfigured: true,
  briefNeedsWork: true,
  briefError: null,
  translated: null,
  translating: false,
};

describe("what the dossier summary shows", () => {
  it("shows the brief once there is one, whatever else is going on", () => {
    expect(summaryView({ ...base, hasBrief: true, translated: "x", translating: true })).toBe(
      "brief",
    );
  });

  it("waits for the brief instead of showing a translation around it", () => {
    // Opening a system with no brief: the text stays put and says a brief is coming. It does not
    // go scraped text -> "translating" -> translation -> brief.
    expect(summaryView(base)).toBe("generating");
    expect(summaryView({ ...base, translating: true })).toBe("generating");
    expect(summaryView({ ...base, translated: "an earlier translation" })).toBe("generating");
  });

  it("decides nothing before the store has attached", () => {
    expect(summaryView({ ...base, ready: false })).toBe("plain");
    expect(awaitingBrief({ ...base, ready: false })).toBe(true);
  });

  it("falls back to the translation when the brief cannot be made", () => {
    const failed = { ...base, briefError: "no provider" };
    expect(awaitingBrief(failed)).toBe(false);
    expect(summaryView({ ...failed, translating: true })).toBe("translating");
    expect(summaryView({ ...failed, translated: "English text" })).toBe("translated");
    expect(summaryView(failed)).toBe("plain");
  });

  it("does not wait for a brief the server cannot make", () => {
    expect(summaryView({ ...base, aiConfigured: false })).toBe("plain");
  });

  it("does not wait for a brief that is current", () => {
    expect(summaryView({ ...base, briefNeedsWork: false })).toBe("plain");
  });
});
