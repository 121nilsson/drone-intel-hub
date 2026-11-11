import { afterEach, describe, expect, it } from "vitest";
import { runTwoTier } from "@/shared/infra/ingest/pipeline";
import { HeuristicExtractor } from "@/shared/infra/heuristic-ai";
import {
  compileRuleSnapshot,
  emptySnapshot,
  setActiveRuleSnapshot,
} from "@/shared/contracts/rules";
import type { Candidate, Drone, Extraction, SystemExtraction } from "@/entities/drone/types";
import type { PipelineDeps } from "@/shared/infra/ingest/pipeline-types";
import { extractionForSystem } from "@/shared/infra/ingest/pipeline-slice";

afterEach(() => setActiveRuleSnapshot(emptySnapshot()));

const lancet = {
  id: "lancet-3",
  name: "Lancet-3",
  aliases: [],
  domain: "Air",
  origin: "RU",
  operators: [],
  propulsion: "Unknown",
  summary: "",
  specs: [],
  rf: [],
  components: [],
  evolution: [],
  counterpartIds: [],
  createdAt: "2026-10-10T00:00:00Z",
  updatedAt: "2026-10-10T00:00:00Z",
} as unknown as Drone;

/** In-memory repositories, as the other runTwoTier tests build them. */
function memoryDeps(drones: Drone[]) {
  const items = [...drones];
  const cands: Candidate[] = [];
  const deps = {
    drones: {
      list: () => items,
      get: (id: string) => items.find((d) => d.id === id),
      search: () => items,
      upsert: (d: Drone) => {
        const i = items.findIndex((x) => x.id === d.id);
        if (i >= 0) items[i] = d;
        else items.push(d);
      },
      remove: () => {},
    },
    candidates: {
      list: () => cands,
      add: (c: Candidate) => void cands.push(c),
      update: () => {},
      remove: () => {},
    },
    tier1: new HeuristicExtractor(1),
    tier2: new HeuristicExtractor(2),
    escalationThreshold: 0.6,
    // Low on purpose: the point is the lineage of a merge, not the confidence of this heuristic.
    autoMergeThreshold: 0.1,
    autoPromoteThreshold: 0.9,
  } as unknown as PipelineDeps;
  return { deps, items };
}

describe("claim lineage through runTwoTier", () => {
  it("a rule-read post that auto-merges stores its rule, versions and match on the claim", async () => {
    setActiveRuleSnapshot(
      compileRuleSnapshot(
        [{ id: "cue-reach", kind: "add_cue", payload: { target: "range", terms: ["reach of"] } }],
        3,
      ),
    );
    const { deps, items } = memoryDeps([lancet]);
    const res = await runTwoTier(
      "The Lancet-3 has a reach of 120 km.",
      "Outlet Â· https://o.example",
      deps,
      { dispatchId: "post-1", contentHash: "simhash-1" },
    );
    expect(res.kind).toBe("auto-merged");

    const merged = items.find((d) => d.id === "lancet-3")!;
    const claim = merged.specs.find((s) => s.key === "range")?.claims[0];
    expect(claim?.lineage).toMatchObject({
      ruleIds: ["cue-reach"],
      rulesVersion: 3,
      pipelineVersion: expect.any(String),
      matchedVia: "name",
      matchedName: "Lancet-3",
      contentHash: "simhash-1",
    });
    expect(claim?.lineage?.pipelineVersion).toBeTruthy();
  });
});

describe("a system sliced out of a multi-system post", () => {
  it("keeps how it matched", () => {
    const parent = {
      aliases: [],
      operators: [],
      specs: [],
      rfBands: [],
      confidence: 0.9,
      rationale: "",
    } as unknown as Extraction;
    const slice = {
      name: "Lancet-3",
      matchId: "lancet-3",
      matchedVia: "rule_alias",
      specs: [],
      rfBands: [],
      confidence: 0.9,
    } as unknown as SystemExtraction;
    expect(extractionForSystem(parent, slice).systems?.[0]).toMatchObject({
      matchedVia: "rule_alias",
    });
  });
});
