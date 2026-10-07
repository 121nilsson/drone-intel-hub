import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  collectSource,
  COOLDOWN_MAX_MS,
  formatProviderError,
  nextCooldown,
  processPending,
  type WorkItemEvent,
} from "@/features/sources/auto-ingest";
import { MAX_ATTEMPTS, type RawDispatch } from "@/entities/dispatch/types";
import type { MonitoredSource } from "@/entities/source/types";
import type { DispatchRepository } from "@/shared/contracts/repository";
import type { PipelineDeps } from "@/features/intake/pipeline";
import type { FetchedPost } from "@/shared/infra/fetch-posts";
import type { Candidate, Drone, Extraction } from "@/entities/drone/types";
import type { IntelExtractor } from "@/shared/contracts/ai";

const SOURCE: MonitoredSource = {
  id: "src-1",
  name: "Test Feed",
  platform: "RSS",
  handle: "https://example.test/feed",
  domain: "Air",
  notes: "",
};

const post = (id: string, text: string): FetchedPost => ({
  id,
  text,
  url: `https://example.test/${id}`,
});

const drone = (id: string): Drone => ({
  id,
  name: id,
  aliases: [],
  domain: "Air",
  origin: "IR",
  operators: [],
  propulsion: "Unknown",
  summary: "",
  specs: [],
  rf: [],
  components: [],
  evolution: [],
  counterpartIds: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const extraction = (over: Partial<Extraction> = {}): Extraction => ({
  aliases: [],
  operators: [],
  specs: [],
  rfBands: [],
  confidence: 0.95,
  rationale: "test",
  ...over,
});

/** In-memory DispatchRepository mirroring LocalDispatchRepository's ordering and dedupe. */
function dispatchRepo(seed: RawDispatch[] = []) {
  let items = [...seed];
  const repo: DispatchRepository = {
    list: () => items,
    has: (id) => items.some((d) => d.id === id),
    add: (d) => {
      if (items.some((x) => x.id === d.id)) return false;
      items = [d, ...items];
      return true;
    },
    update: (id, patch) => {
      items = items.map((x) => (x.id === id ? { ...x, ...patch } : x));
    },
    pending: (limit) =>
      items
        .filter((d) => d.status === "pending")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, limit),
  };
  // list() already returns a snapshot array, so tests read through it directly.
  return repo;
}

const makeDispatch = (over: Partial<RawDispatch> = {}): RawDispatch => ({
  id: `src-1|${over.externalId ?? "p1"}`,
  sourceId: "src-1",
  sourceName: "Test Feed",
  externalId: "p1",
  url: "https://example.test/p1",
  text: "A drone report",
  createdAt: "2026-01-01T00:00:00.000Z",
  status: "pending",
  ...over,
});

/** Extractor scripted by post text: map a text to a result or a thrown error. */
function scripted(script: Record<string, Extraction | Error>) {
  const calls: string[] = [];
  const tier1: IntelExtractor = {
    tier: 1,
    label: "scripted",
    extract: async (raw: string) => {
      calls.push(raw);
      const r = script[raw];
      if (r instanceof Error) throw r;
      if (!r) throw new Error(`unexpected text: ${raw}`);
      return r;
    },
  };
  return { tier1, calls };
}

function deps(tier1: IntelExtractor): PipelineDeps {
  const items: Drone[] = [drone("shahed-136")];
  const cands: Candidate[] = [];
  return {
    // Same extractor both tiers: these tests cover queue behaviour, not escalation, and a
    // confident match never reaches tier 2 anyway.
    tier1,
    tier2: tier1,
    drones: {
      list: () => items,
      get: (id) => items.find((d) => d.id === id),
      upsert: (d) => {
        const i = items.findIndex((x) => x.id === d.id);
        if (i >= 0) items[i] = d;
        else items.push(d);
      },
      remove: (id) => {
        const i = items.findIndex((x) => x.id === id);
        if (i >= 0) items.splice(i, 1);
      },
      search: () => items,
    },
    candidates: { list: () => cands, add: (c) => cands.push(c), update: () => {} },
    escalationThreshold: 0.6,
    autoMergeThreshold: 0.85,
  };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("provider error labels", () => {
  it("names the failure the operator can act on", () => {
    expect(formatProviderError("Provider request failed (TimeoutError)")).toBe("Provider timeout");
    expect(formatProviderError("Provider rate limit (429)")).toBe("Provider rate limit (429)");
    expect(formatProviderError("Provider 503: unavailable")).toBe("Provider unavailable (503)");
    expect(formatProviderError("Unexpected token } in JSON at position 12")).toBe(
      "Provider invalid response",
    );
    expect(formatProviderError("No API key: set NVIDIA_API_KEY")).toBe("Provider auth");
  });
});

describe("processPending per-dispatch isolation", () => {
  it("keeps a rate-limited dispatch pending so a later tick retries it", async () => {
    const { tier1 } = scripted({ "A drone report": new Error("Provider 429: rate limited") });
    const repo = dispatchRepo([makeDispatch()]);

    const rep = await processPending(repo, deps(tier1));

    expect(rep.failed).toBe(1);
    expect(rep.stopReason).toBe("Provider rate limit (429)");
    expect(repo.list()[0]!.status).toBe("pending");
    expect(repo.list()[0]!.attempts).toBe(1);
    // The error is retained for the operator rather than swallowed.
    expect(repo.list()[0]!.error).toContain("429");
  });

  it("marks a dispatch failed only after the attempt budget is spent", async () => {
    const { tier1 } = scripted({ "A drone report": new Error("Provider 429: rate limited") });
    const repo = dispatchRepo([makeDispatch()]);

    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      const rep = await processPending(repo, deps(tier1));
      expect(rep.failed).toBe(1);
      expect(repo.list()[0]!.status).toBe(i >= MAX_ATTEMPTS ? "failed" : "pending");
    }
    // A failed dispatch leaves the queue instead of retrying forever.
    expect(repo.pending(10)).toHaveLength(0);
    expect(repo.list()[0]!.attempts).toBe(MAX_ATTEMPTS);
  });

  it("processes a healthy dispatch and records provenance", async () => {
    const { tier1 } = scripted({ "A drone report": extraction({ matchId: "shahed-136" }) });
    const repo = dispatchRepo([makeDispatch()]);

    const rep = await processPending(repo, deps(tier1));

    expect(rep.merged).toBe(1);
    expect(rep.failed).toBe(0);
    const d = repo.list()[0]!;
    expect(d.status).toBe("processed");
    expect(d.outcome).toBe("auto-merged");
    expect(d.droneIds).toEqual(["shahed-136"]);
    expect(d.candidateIds).toHaveLength(1);
    expect(d.processedAt).toBeTruthy();
    expect(d.error).toBeUndefined();
  });

  it("does not burn a successful dispatch's attempt budget on failure", async () => {
    const good = scripted({ "drone good": extraction({ matchId: "shahed-136" }) });
    const repo = dispatchRepo([
      makeDispatch({ externalId: "a", text: "drone good", createdAt: "2026-01-01T00:00:00.000Z" }),
    ]);
    await processPending(repo, deps(good.tier1));
    expect(repo.list()[0]!.status).toBe("processed");

    // A later failure on a different dispatch must not affect the processed one.
    const bad = scripted({ "drone bad": new Error("nope") });
    await processPending(repo, deps(bad.tier1), 20);
    expect(repo.list()[0]!.status).toBe("processed");
  });

  it("stops the batch on error so a rate limit cannot cascade", async () => {
    const { tier1, calls } = scripted({
      "drone bad": new Error("Provider 429: rate limited"),
      "drone good": extraction({ matchId: "shahed-136" }),
    });
    const repo = dispatchRepo([
      makeDispatch({ externalId: "1", text: "drone bad", createdAt: "2026-01-01T00:00:00.000Z" }),
      makeDispatch({ externalId: "2", text: "drone good", createdAt: "2026-01-01T00:00:01.000Z" }),
    ]);

    const rep = await processPending(repo, deps(tier1));

    expect(calls).toEqual(["drone bad"]);
    expect(rep.failed).toBe(1);
    expect(rep.stopReason).toBe("Provider rate limit (429)");
    expect(rep.remaining).toBe(2);
  });

  it("honours the batch limit", async () => {
    const { tier1, calls } = scripted({ "A drone report": extraction({ matchId: "shahed-136" }) });
    const repo = dispatchRepo([
      makeDispatch({ externalId: "1", createdAt: "2026-01-01T00:00:00.000Z" }),
      makeDispatch({ externalId: "2", createdAt: "2026-01-01T00:00:01.000Z" }),
      makeDispatch({ externalId: "3", createdAt: "2026-01-01T00:00:02.000Z" }),
    ]);

    const rep = await processPending(repo, deps(tier1), 2);

    expect(calls).toHaveLength(2);
    expect(rep.processed).toBe(2);
    expect(rep.remaining).toBe(1);
  });

  it("reports each post before marking it, in order", async () => {
    const repo = dispatchRepo([
      makeDispatch({
        externalId: "1",
        text: "A drone report",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
      makeDispatch({
        externalId: "2",
        text: "A post about gardening",
        createdAt: "2026-01-01T00:00:01.000Z",
      }),
    ]);
    const events: WorkItemEvent[] = [];
    const { tier1 } = scripted({ "A drone report": extraction({ matchId: "shahed-136" }) });

    await processPending(repo, deps(tier1), 20, {
      onItem: (event) => {
        const row = repo.list().find((d) => d.id === event.id);
        expect(row?.status).toBe("pending");
        events.push(event);
      },
    });

    expect(
      events.map((event) => `${event.index}/${event.total}:${event.id}:${event.excerpt}`),
    ).toEqual(["1/2:src-1|1:A drone report", "2/2:src-1|2:A post about gardening"]);
    expect(events[0]!.processed).toBe(0);
    expect(events[0]!.remaining).toBe(2);
    expect(events[1]!.processed).toBe(1);
    expect(events[1]!.remaining).toBe(1);
  });

  it("still processes the batch when onItem throws", async () => {
    const repo = dispatchRepo([
      makeDispatch({
        externalId: "1",
        text: "A drone report",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
      makeDispatch({
        externalId: "2",
        text: "A drone report",
        createdAt: "2026-01-01T00:00:01.000Z",
      }),
    ]);
    const { tier1 } = scripted({ "A drone report": extraction({ matchId: "shahed-136" }) });
    let calls = 0;

    const rep = await processPending(repo, deps(tier1), 20, {
      onItem: () => {
        calls++;
        if (calls === 1) throw new Error("progress failed");
        return Promise.reject(new Error("progress failed"));
      },
    });

    expect(calls).toBe(2);
    expect(rep.processed).toBe(2);
    expect(repo.list().every((d) => d.status === "processed")).toBe(true);
  });

  it("strips the text of irrelevant posts but keeps them for dedupe", async () => {
    const { tier1, calls } = scripted({});
    const repo = dispatchRepo([makeDispatch({ text: "A post about gardening" })]);

    const rep = await processPending(repo, deps(tier1));

    expect(rep.irrelevant).toBe(1);
    expect(calls).toHaveLength(0);
    const d = repo.list()[0]!;
    expect(d.status).toBe("irrelevant");
    expect(d.text).toBe("");
    // Still in the archive, so the same external id is not re-collected.
    expect(d.id).toBe("src-1|p1");
  });
});

describe("nextCooldown", () => {
  const NOW = Date.parse("2026-10-07T12:00:00.000Z");
  const minutes = (c: { until: string }) => (Date.parse(c.until) - NOW) / 60_000;

  it("starts at five minutes after the first rate-limited run", () => {
    const c = nextCooldown(null, NOW);
    expect(c.level).toBe(1);
    expect(minutes(c)).toBe(5);
  });

  it("doubles for each consecutive rate-limited run", () => {
    const first = nextCooldown(null, NOW);
    const second = nextCooldown(first, NOW);
    const third = nextCooldown(second, NOW);
    expect([minutes(second), minutes(third)]).toEqual([10, 20]);
  });

  it("is capped at an hour", () => {
    expect(Date.parse(nextCooldown({ level: 20, until: "" }, NOW).until) - NOW).toBe(
      COOLDOWN_MAX_MS,
    );
  });
});

describe("processPending auto-triage counts", () => {
  it("counts auto-promoted and auto-discarded posts separately from the queue", async () => {
    const { tier1 } = scripted({
      "drone new": extraction({ name: "Brand New UAV", confidence: 0.95 }),
      "drone noise": extraction({ confidence: 0.1 }),
    });
    const repo = dispatchRepo([
      makeDispatch({ externalId: "p1", text: "drone new" }),
      makeDispatch({ externalId: "p2", text: "drone noise" }),
    ]);

    const rep = await processPending(repo, {
      ...deps(tier1),
      autoPromoteThreshold: 0.9,
      autoDiscardThreshold: 0.25,
    });

    expect(rep.promoted).toBe(1);
    expect(rep.discarded).toBe(1);
    expect(rep.queued).toBe(0);
    const outcomes = repo
      .list()
      .map((d) => d.outcome)
      .sort();
    expect(outcomes).toEqual(["auto-discarded", "auto-promoted"]);
  });
});

describe("collectSource dedupe", () => {
  it("stores posts as pending dispatches without calling the model", async () => {
    const repo = dispatchRepo();
    const { tier1, calls } = scripted({});

    const rep = await collectSource(
      SOURCE,
      async () => ({
        ok: true,
        posts: [post("p1", "A drone report"), post("p2", "another drone")],
      }),
      repo,
    );

    expect(rep.fetched).toBe(2);
    expect(rep.stored).toBe(2);
    expect(calls).toHaveLength(0);
    expect(repo.pending(10)).toHaveLength(2);
  });

  it("does not re-store a post it already has", async () => {
    const repo = dispatchRepo([makeDispatch({ externalId: "p1" })]);

    const rep = await collectSource(
      SOURCE,
      async () => ({ ok: true, posts: [post("p1", "A drone report")] }),
      repo,
    );

    expect(rep.fetched).toBe(1);
    expect(rep.stored).toBe(0);
    expect(repo.list()).toHaveLength(1);
  });

  it("re-collects a post whose earlier processing failed", async () => {
    // A failed dispatch left the pending queue but is still on record, so the external post
    // is not fetched-and-restored indefinitely. Dedupe is by external id, full stop.
    const repo = dispatchRepo([makeDispatch({ externalId: "p1", status: "failed" })]);

    const rep = await collectSource(
      SOURCE,
      async () => ({ ok: true, posts: [post("p1", "A drone report")] }),
      repo,
    );

    expect(rep.stored).toBe(0);
  });

  it("reports a fetch failure without throwing", async () => {
    const repo = dispatchRepo();

    const rep = await collectSource(
      SOURCE,
      async () => ({ ok: false, error: "Source unreachable" }),
      repo,
    );

    expect(rep.error).toBe("Source unreachable");
    expect(rep.stored).toBe(0);
    expect(repo.list()).toHaveLength(0);
  });
});
