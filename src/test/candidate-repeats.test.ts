import { describe, expect, it } from "vitest";
import { repeatedCandidates } from "@/entities/drone/candidate-repeats";
import type { Candidate } from "@/entities/drone/types";
import { pruneRepeatedCandidates } from "@/shared/infra/ingest/prune-candidates";

/** One post re-read three times, each run writing a candidate per system it names. */
const cand = (id: string, name: string, createdAt: string, over: Partial<Candidate> = {}) =>
  ({
    id,
    raw: "Geran-2 and Patriot reported near Kharkiv.",
    source: "Militarnyi · https://m.example/1",
    createdAt,
    tier: 1,
    extraction: {
      name,
      aliases: [],
      operators: [],
      specs: [],
      rfBands: [],
      confidence: 0.9,
      rationale: "",
    },
    status: "merged",
    resolvedBy: "auto",
    ...over,
  }) as Candidate;

describe("repeated candidates", () => {
  it("keeps the latest reading of each system in a post", () => {
    const all = [
      cand("g1", "Geran-2", "2026-10-01"),
      cand("p1", "Patriot", "2026-10-01"),
      cand("g2", "Geran-2", "2026-10-05"),
      cand("p2", "Patriot", "2026-10-05"),
      cand("g3", "Geran-2", "2026-10-09"),
    ];
    // Patriot's latest is p2 - a later run that no longer names it does not remove it.
    expect(repeatedCandidates(all).map((c) => c.id)).toEqual(["g1", "p1", "g2"]);
  });

  it("never removes an analyst's decision, a promotion, or a post's current reading", () => {
    const all = [
      cand("analyst", "Geran-2", "2026-10-01", { resolvedBy: "analyst" }),
      cand("promoted", "Geran-2", "2026-10-02", { status: "promoted" }),
      cand("current", "Geran-2", "2026-10-03"),
      cand("latest", "Geran-2", "2026-10-04"),
    ];
    expect(repeatedCandidates(all, new Set(["current"]))).toEqual([]);
  });

  it("counts the same text from two outlets as two posts", () => {
    const a = cand("a", "Geran-2", "2026-10-01");
    const b = cand("b", "Geran-2", "2026-10-02", { source: "Kyiv Post · https://k.example/9" });
    expect(repeatedCandidates([a, b])).toEqual([]);
  });

  it("prunes only when asked to apply", () => {
    let stored = [cand("g1", "Geran-2", "2026-10-01"), cand("g2", "Geran-2", "2026-10-05")];
    const repo = {
      list: () => stored,
      add: () => {},
      update: () => {},
      remove: (id: string) => {
        stored = stored.filter((c) => c.id !== id);
      },
    };
    const dispatches = { list: () => [] };
    expect(pruneRepeatedCandidates(repo, dispatches, { apply: false })).toEqual({ removed: 1 });
    expect(stored).toHaveLength(2);
    pruneRepeatedCandidates(repo, dispatches);
    expect(stored.map((c) => c.id)).toEqual(["g2"]);
    expect(pruneRepeatedCandidates(repo, dispatches)).toEqual({ removed: 0 });
  });
});
