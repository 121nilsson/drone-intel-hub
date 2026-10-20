import { describe, expect, it } from "vitest";
import {
  PIPELINE_VERSION,
  isStale,
  processPending,
  requeueFailed,
  requeueStale,
} from "@/shared/infra/ingest/auto-ingest";
import type { PipelineDeps } from "@/shared/infra/ingest/pipeline";
import type { DispatchRepository } from "@/shared/contracts/repository";
import type { RawDispatch } from "@/entities/dispatch/types";
import type { IntelExtractor } from "@/shared/contracts/ai";
import type { Candidate, Drone, Extraction } from "@/entities/drone/types";

const SOURCE = "Rybar · https://t.me/rybar/1";

const post = (over: Partial<RawDispatch> = {}): RawDispatch => ({
  id: "rybar|1",
  sourceId: "rybar",
  sourceName: "Rybar",
  externalId: "1",
  url: "https://t.me/rybar/1",
  text: "Lancet-3 strike: range 40 km, 3 kg warhead.",
  createdAt: "2026-10-09T10:00:00Z",
  status: "processed",
  candidateIds: ["old-pending", "old-merged"],
  droneIds: ["lancet-3"],
  ...over,
});

/** Lancet-3 carrying one claim from this post (earlier run) and one from another source. */
const lancet = (): Drone => ({
  id: "lancet-3",
  name: "Lancet-3",
  aliases: [],
  domain: "Air",
  origin: "RU",
  operators: [],
  propulsion: "Electric",
  summary: "",
  specs: [
    {
      key: "range",
      label: "Range",
      semantic: "range.max",
      discoveredBy: "ai",
      claims: [
        { value: "40 km", source: SOURCE, sourceId: "rybar|1", date: "2026-10-09" },
        { value: "40 km", source: "Militarnyi · https://m.example", date: "2026-10-08" },
      ],
    },
  ],
  rf: [],
  components: [],
  evolution: [],
  counterpartIds: [],
  createdAt: "",
  updatedAt: "",
});

function setup(rows: RawDispatch[], extractor: IntelExtractor) {
  const drones = [lancet()];
  const candidates: Candidate[] = [
    {
      id: "old-pending",
      raw: "x",
      source: SOURCE,
      createdAt: "",
      tier: 1,
      extraction: {
        aliases: [],
        operators: [],
        specs: [],
        rfBands: [],
        confidence: 0.4,
        rationale: "",
      },
      status: "pending",
    },
    {
      id: "old-merged",
      raw: "x",
      source: SOURCE,
      createdAt: "",
      tier: 1,
      extraction: {
        aliases: [],
        operators: [],
        specs: [],
        rfBands: [],
        confidence: 0.9,
        rationale: "",
      },
      status: "merged",
      resolvedInto: "lancet-3",
    },
  ];
  const dispatches = {
    list: () => rows,
    pending: (n: number) => rows.filter((r) => r.status === "pending").slice(0, n),
    update: (id: string, patch: Partial<RawDispatch>) => {
      const r = rows.find((x) => x.id === id);
      if (r) Object.assign(r, patch);
    },
    add: () => true,
  } as unknown as DispatchRepository;
  const deps = {
    drones: {
      list: () => drones,
      get: (id: string) => drones.find((d) => d.id === id),
      search: () => drones,
      remove: () => {},
      upsert: (d: Drone) => {
        const i = drones.findIndex((x) => x.id === d.id);
        if (i >= 0) drones[i] = d;
        else drones.push(d);
      },
    },
    candidates: {
      list: () => candidates,
      add: (c: Candidate) => void candidates.push(c),
      update: (id: string, patch: Partial<Candidate>) => {
        const i = candidates.findIndex((c) => c.id === id);
        if (i >= 0) candidates[i] = { ...candidates[i]!, ...patch };
      },
    },
    tier1: extractor,
    tier2: extractor,
    escalationThreshold: 0.6,
    autoMergeThreshold: 0.85,
  } as PipelineDeps;
  return { dispatches, deps, drones, candidates };
}

const matched: IntelExtractor = {
  tier: 1,
  label: "ai",
  extract: async () =>
    ({
      name: "Lancet-3",
      matchId: "lancet-3",
      aliases: [],
      operators: [],
      specs: [{ key: "range", label: "Range", value: "40 km" }],
      rfBands: [],
      systems: [{ name: "Lancet-3", matchId: "lancet-3" }],
      confidence: 0.95,
      rationale: "",
      metadata: { schemaVersion: 2, engine: "ai", promptVersion: "drone-osint-v3", analyzedAt: "" },
    }) as Extraction,
};

describe("isStale / requeueStale", () => {
  it("selects posts from an older pipeline that still hold their text", () => {
    expect(isStale(post())).toBe(true);
    expect(isStale(post({ pipelineVersion: PIPELINE_VERSION }))).toBe(false);
    expect(isStale(post({ status: "irrelevant", text: "" }))).toBe(false);
    expect(isStale(post({ status: "failed", attempts: 3 }))).toBe(true);
  });

  it("requeues newest first, up to the limit, with a fresh attempt budget", () => {
    const rows = [
      post({ id: "a", publishedAt: "2026-10-01T00:00:00Z" }),
      post({ id: "b", publishedAt: "2026-10-09T00:00:00Z", status: "failed", attempts: 3 }),
    ];
    const { dispatches } = setup(rows, matched);
    expect(requeueStale(dispatches, 1)).toBe(1);
    expect(rows[1]).toMatchObject({ status: "pending", attempts: 0, reanalyze: true });
    expect(rows[0]!.status).toBe("processed");
  });
});

describe("processPending with a re-analysis", () => {
  it("replaces the post's earlier claims and pending candidates instead of adding to them", async () => {
    const rows = [post()];
    const { dispatches, deps, drones, candidates } = setup(rows, matched);
    requeueStale(dispatches, 10);
    const rep = await processPending(dispatches, deps, 10);

    expect(rep.processed).toBe(1);
    const range = drones[0]!.specs.find((s) => s.key === "range")!;
    // One claim from this post (the new run's), one from the other source - not two from this post.
    expect(range.claims.map((c) => c.source).sort()).toEqual(
      ["Militarnyi · https://m.example", SOURCE].sort(),
    );
    expect(candidates.find((c) => c.id === "old-pending")).toMatchObject({
      status: "discarded",
      resolvedBy: "auto",
    });
    // Already-resolved history is left alone.
    expect(candidates.find((c) => c.id === "old-merged")!.status).toBe("merged");
    expect(rows[0]).toMatchObject({ pipelineVersion: PIPELINE_VERSION, reanalyze: false });
  });

  it("puts the earlier claims back when the re-run fails", async () => {
    const failing: IntelExtractor = {
      tier: 1,
      label: "ai",
      extract: async () => {
        throw new Error("Invalid extraction JSON: nope");
      },
    };
    const rows = [post()];
    const { dispatches, deps, drones, candidates } = setup(rows, failing);
    requeueStale(dispatches, 10);
    await processPending(dispatches, deps, 10);

    expect(drones[0]!.specs[0]!.claims).toHaveLength(2);
    expect(candidates.find((c) => c.id === "old-pending")!.status).toBe("pending");
    expect(rows[0]).toMatchObject({ status: "pending", attempts: 1, reanalyze: true });
  });
});

describe("requeueFailed", () => {
  it("returns failed posts with text to pending, resetting attempts and errors", () => {
    const rows = [
      post({ id: "a", status: "failed", attempts: 3, error: "timeout" }),
      post({ id: "b", status: "failed", attempts: 2, text: "" }),
      post({ id: "c", status: "processed" }),
    ];
    const { dispatches } = setup(rows as RawDispatch[], matched);
    const n = requeueFailed(dispatches);
    expect(n).toBe(1);
    expect(rows[0]).toMatchObject({ status: "pending", attempts: 0, error: undefined });
    expect(rows[1]!.status).toBe("failed");
  });

  it("only requeues the given ids when provided", () => {
    const rows = [
      post({ id: "a", status: "failed", attempts: 3 }),
      post({ id: "b", status: "failed", attempts: 3 }),
    ];
    const { dispatches } = setup(rows as RawDispatch[], matched);
    const n = requeueFailed(dispatches, ["a"]);
    expect(n).toBe(1);
    expect(rows[0]!.status).toBe("pending");
    expect(rows[1]!.status).toBe("failed");
  });
});
