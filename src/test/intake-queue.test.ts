import { describe, expect, it } from "vitest";
import type { Candidate, DetectedSystem, Extraction } from "@/entities/drone/types";
import { groupUnresolvedFamilies, pageQueue, reportKey } from "@/features/intake/intake-queue";

/** Longer than the 240-character prefix the queue used to group on. */
const OPENING = "A long report that opens the same way in two unrelated dispatches. ".repeat(5);
const unresolved: DetectedSystem[] = [{ name: "System A", variantOf: "Family A" }];

function extraction(systems: DetectedSystem[]): Extraction {
  return {
    aliases: [],
    operators: [],
    specs: [],
    rfBands: [],
    systems,
    confidence: 0.5,
    rationale: "",
  };
}

function candidate(id: string, raw: string, over: Partial<Candidate> = {}): Candidate {
  return {
    id,
    raw,
    source: "Test outlet",
    createdAt: "2026-01-01T00:00:00.000Z",
    tier: 1,
    status: "pending",
    extraction: extraction(unresolved),
    ...over,
  };
}

describe("unresolved family grouping", () => {
  it("keeps different reports apart even when their first 240 characters match", () => {
    const first = candidate("a", `${OPENING}The Alpha system is described here.`);
    const second = candidate("b", `${OPENING}The unrelated Beta system is described here.`);
    expect(first.raw.slice(0, 240)).toBe(second.raw.slice(0, 240));

    expect(groupUnresolvedFamilies([first, second])).toHaveLength(2);
  });

  it("groups slices of one pasted report by its whole normalised text", () => {
    const raw = `${OPENING}Both systems appear in this one report.`;
    const first = candidate("a", raw);
    const second = candidate("b", `  ${raw.toUpperCase()}  `);

    expect(reportKey(first)).toBe(reportKey(second));
    expect(groupUnresolvedFamilies([first, second])).toEqual([[first, second]]);
  });

  it("groups slices that share an archived post even when their text differs", () => {
    const first = candidate("a", "Alpha's slice of the report", { dispatchId: "post-1" });
    const second = candidate("b", "Beta's slice of the report", { dispatchId: "post-1" });

    expect(groupUnresolvedFamilies([first, second])).toEqual([[first, second]]);
  });

  it("does not group pasted reports that have no words to fingerprint", () => {
    const first = candidate("a", "---");
    const second = candidate("b", "---");

    expect(groupUnresolvedFamilies([first, second])).toHaveLength(2);
  });

  it("leaves a resolved single-system candidate out of the family list", () => {
    const resolved = candidate("a", OPENING, {
      extraction: extraction([{ name: "System A", matchId: "d1" }]),
    });

    expect(groupUnresolvedFamilies([resolved])).toEqual([]);
  });
});

describe("queue paging", () => {
  it("reveals 20 queue items per page across both families and singles", () => {
    const families = Array.from({ length: 12 }, (_, i) => [candidate(`f${i}`, OPENING)]);
    const singles = Array.from({ length: 15 }, (_, i) => candidate(`s${i}`, OPENING));

    const first = pageQueue(families, singles, 20);
    expect(first.families).toHaveLength(12);
    expect(first.singles).toHaveLength(8);
    expect(first.shownCount).toBe(20);
    expect(first.hiddenRemaining).toBe(7);

    const second = pageQueue(families, singles, 40);
    expect(second.shownCount).toBe(27);
    expect(second.hiddenRemaining).toBe(0);
  });

  it("does not push singles past the page when families fill it", () => {
    const families = Array.from({ length: 25 }, (_, i) => [candidate(`f${i}`, OPENING)]);
    const singles = Array.from({ length: 10 }, (_, i) => candidate(`s${i}`, OPENING));

    const first = pageQueue(families, singles, 20);
    expect(first.families).toHaveLength(20);
    expect(first.singles).toHaveLength(0);
    expect(first.hiddenRemaining).toBe(15);
  });
});
