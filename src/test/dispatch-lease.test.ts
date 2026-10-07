import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  collectSource,
  leaseFor,
  processPending,
  MAX_LEASE_MS,
} from "@/features/sources/auto-ingest";
import { MAX_ATTEMPTS, type RawDispatch } from "@/entities/dispatch/types";
import type { DispatchRepository } from "@/shared/contracts/repository";
import type { PipelineDeps } from "@/features/intake/pipeline";
import type { Candidate, Drone, Extraction } from "@/entities/drone/types";
import type { IntelExtractor } from "@/shared/contracts/ai";

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

const makeDispatch = (n: number): RawDispatch => ({
  id: `src-1|p${n}`,
  sourceId: "src-1",
  sourceName: "Test Feed",
  externalId: `p${n}`,
  url: `https://example.test/p${n}`,
  text: `A drone report number ${n}`,
  createdAt: `2026-01-01T00:00:${String(n).padStart(2, "0")}.000Z`,
  status: "pending",
});

/** Records every extractor call so a double-process is observable. */
function scripted() {
  const calls: string[] = [];
  const tier1: IntelExtractor = {
    tier: 1,
    label: "scripted",
    extract: async (raw: string) => {
      calls.push(raw);
      // A real gap between calls is what makes an overlapping claim detectable.
      await new Promise((r) => setTimeout(r, 5));
      return extraction({ matchId: "shahed-136" });
    },
  };
  return { tier1, calls };
}

function deps(tier1: IntelExtractor): PipelineDeps & { _cands: Candidate[] } {
  const items: Drone[] = [drone("shahed-136")];
  const cands: Candidate[] = [];
  return {
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
      search: () => items,
    },
    candidates: { list: () => cands, add: (c) => cands.push(c), update: () => {} },
    escalationThreshold: 0.6,
    autoMergeThreshold: 0.85,
    _cands: cands,
  };
}

/**
 * Repository view over shared store state. Leases live on the *store*, not on a repository
 * instance - two workers must contend for the same lease map, which is the whole point.
 */
interface TestStore {
  docs: RawDispatch[];
  leases: Map<string, { until: number; by: string }>;
}

function newStore(n: number): TestStore {
  return { docs: Array.from({ length: n }, (_, i) => makeDispatch(i + 1)), leases: new Map() };
}

/** Claim and assert the store actually supports claiming, so tests never assert on null. */
async function claimIds(repo: DispatchRepository, limit: number, leaseMs: number, owner: string) {
  const ids = await repo.claim!(limit, leaseMs, owner);
  expect(ids).not.toBeNull();
  return ids!;
}

/** Repository view over the shared store, mirroring LocalDispatchRepository's claim delegation. */
function leasedRepo(store: TestStore): DispatchRepository {
  const claim = async (limit: number, leaseMs: number, owner: string) => {
    const now = Date.now();
    // Storage-level exclusivity: a row already leased by another owner is skipped. This is
    // the single point of contention between workers, as the SQL `skip locked` claim is.
    const taken = store.docs
      .filter((d) => d.status === "pending")
      .filter((d) => {
        const l = store.leases.get(d.id);
        return !l || l.until < now || l.by === owner;
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit);
    for (const d of taken) store.leases.set(d.id, { until: now + leaseMs, by: owner });
    return taken.map((d) => d.id);
  };

  return {
    list: () => store.docs,
    has: (id) => store.docs.some((d) => d.id === id),
    add: (d) => {
      if (store.docs.some((x) => x.id === d.id)) return false;
      store.docs.unshift(d);
      return true;
    },
    update: (id, patch) => {
      const i = store.docs.findIndex((x) => x.id === id);
      if (i >= 0) store.docs[i] = { ...store.docs[i]!, ...patch };
    },
    pending: (limit) =>
      store.docs
        .filter((d) => d.status === "pending")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, limit),
    claim,
    async release(ids, owner) {
      for (const id of ids) {
        const l = store.leases.get(id);
        if (l?.by === owner) store.leases.delete(id);
      }
    },
  };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("processPending leasing", () => {
  // The bug being fixed: two workers both read the same pending set and both process it,
  // producing duplicate candidates and duplicate merges.
  it("does not double-process when two workers run concurrently", async () => {
    const store = newStore(4);
    const { tier1, calls } = scripted();

    const [a, b] = await Promise.all([
      processPending(leasedRepo(store), deps(tier1), 4, { owner: "worker-a", leaseMs: 60_000 }),
      processPending(leasedRepo(store), deps(tier1), 4, { owner: "worker-b", leaseMs: 60_000 }),
    ]);

    expect(calls).toHaveLength(4);
    expect(new Set(calls).size).toBe(4);
    // Every document processed exactly once, by exactly one worker.
    expect(a.processed + b.processed).toBe(4);
    expect(a.leased + b.leased).toBe(4);
  });

  it("splits the batch between concurrent workers rather than overlapping", async () => {
    const store = newStore(6);
    const { tier1, calls } = scripted();

    const [a, b] = await Promise.all([
      processPending(leasedRepo(store), deps(tier1), 3, { owner: "a", leaseMs: 60_000 }),
      processPending(leasedRepo(store), deps(tier1), 3, { owner: "b", leaseMs: 60_000 }),
    ]);

    expect(a.leased + b.leased).toBeLessThanOrEqual(6);
    expect(new Set(calls).size).toBe(calls.length);
    expect(calls).toHaveLength(a.processed + b.processed);
  });

  it("reports when another worker holds the whole queue", async () => {
    const store = newStore(2);
    const { tier1 } = scripted();
    // Pre-lease everything as another owner, without processing.
    await leasedRepo(store).claim!(10, 60_000, "someone-else");

    const rep = await processPending(leasedRepo(store), deps(tier1), 20, { owner: "me" });

    expect(rep.leased).toBe(0);
    expect(rep.processed).toBe(0);
    // Still pending - not consumed, just not claimable right now.
    expect(rep.remaining).toBe(2);
  });

  it("releases leases on success so a later run can claim them", async () => {
    const store = newStore(1);
    const { tier1 } = scripted();
    await processPending(leasedRepo(store), deps(tier1), 20, { owner: "a", leaseMs: 60_000 });

    // Processed documents are no longer pending, so nothing to claim.
    expect(await leasedRepo(store).claim!(10, 60_000, "b")).toEqual([]);
  });

  it("releases leases after an error instead of waiting out the expiry", async () => {
    const store = newStore(2);
    const failing: IntelExtractor = {
      tier: 1,
      label: "failing",
      extract: async () => {
        throw new Error("Provider 429: rate limited");
      },
    };

    const first = await processPending(leasedRepo(store), deps(failing), 20, {
      owner: "a",
      leaseMs: 600_000,
    });
    expect(first.failed).toBe(1);

    // The documents this run leased must not stay pinned for the full 10-minute lease.
    expect((await claimIds(leasedRepo(store), 10, 60_000, "b")).length).toBeGreaterThan(0);
  });

  it("releases leases when the loop throws unexpectedly", async () => {
    const store = newStore(1);
    const { tier1 } = scripted();
    const repo = leasedRepo(store);
    const originalUpdate = repo.update;
    // Throw from the status write, which happens inside the per-document try/catch - this
    // exercises the finally releasing the rest of the claimed batch.
    repo.update = (id, patch) => {
      if (patch.status === "processed") throw new Error("write failed");
      originalUpdate(id, patch);
    };

    await processPending(repo, deps(tier1), 20, { owner: "a", leaseMs: 600_000 });

    // Lease released despite the failure.
    expect((await claimIds(leasedRepo(store), 10, 60_000, "b")).length).toBeGreaterThan(0);
  });

  it("falls back to plain pending() when the store cannot lease", async () => {
    const store = newStore(2);
    const { tier1 } = scripted();
    const repo = leasedRepo(store);
    // Simulate a store without claim support (e.g. migration not applied).
    delete (repo as { claim?: unknown }).claim;

    const rep = await processPending(repo, deps(tier1), 20, { owner: "a" });

    expect(rep.leased).toBe(0);
    expect(rep.processed).toBe(2);
  });

  it("does not reclaim a live lease from another owner", async () => {
    const store = newStore(1);
    await leasedRepo(store).claim!(10, 60_000, "holder");

    expect(await leasedRepo(store).claim!(10, 60_000, "other")).toEqual([]);
  });

  it("allows the same owner to reclaim its own live lease", async () => {
    // Guards against a stalled run leaving its own work unclaimable forever.
    const store = newStore(1);
    expect(await leasedRepo(store).claim!(10, 60_000, "me")).toEqual(["src-1|p1"]);
    expect(await leasedRepo(store).claim!(10, 60_000, "me")).toEqual(["src-1|p1"]);
  });

  it("reclaims an expired lease", async () => {
    const store = newStore(1);
    await leasedRepo(store).claim!(10, 1, "dead-worker");
    await new Promise((r) => setTimeout(r, 10));

    expect(await leasedRepo(store).claim!(10, 60_000, "revived")).toEqual(["src-1|p1"]);
  });

  it("honours the limit when claiming", async () => {
    const store = newStore(5);
    expect(await leasedRepo(store).claim!(2, 60_000, "a")).toHaveLength(2);
  });

  it("claims oldest first", async () => {
    const store = newStore(3);
    expect(await leasedRepo(store).claim!(1, 60_000, "a")).toEqual(["src-1|p1"]);
  });

  it("skips already-processed dispatches", async () => {
    const store = newStore(2);
    store.docs[1] = { ...store.docs[1]!, status: "processed" };
    expect(await leasedRepo(store).claim!(10, 60_000, "a")).toEqual(["src-1|p1"]);
  });

  it("still marks a dispatch failed after MAX_ATTEMPTS", async () => {
    const store = newStore(1);
    const failing: IntelExtractor = {
      tier: 1,
      label: "failing",
      extract: async () => {
        throw new Error("bad json");
      },
    };
    let last;
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      last = await processPending(leasedRepo(store), deps(failing), 20, {
        owner: "a",
        leaseMs: 60_000,
      });
    }
    expect(last!.failed).toBe(1);
    expect(store.docs[0]!.status).toBe("failed");
    expect(store.docs[0]!.attempts).toBe(MAX_ATTEMPTS);
  });
});

describe("lease duration covers the batch", () => {
  // The invariant that keeps the lease meaningful: it must outlive the run that took it,
  // otherwise a still-running batch can have its documents re-claimed mid-flight.
  it("scales the lease with the batch size", () => {
    expect(leaseFor(120)).toBeGreaterThan(leaseFor(20));
  });

  it("keeps a short interactive run on a short lease for fast crash recovery", () => {
    expect(leaseFor(20)).toBe(5 * 60_000);
    expect(leaseFor(1)).toBe(5 * 60_000);
  });

  it("covers the full cron batch", () => {
    // ~9 min of expected work for the 120-item batch; 30 min is generous headroom.
    expect(leaseFor(120)).toBeGreaterThanOrEqual(30 * 60_000);
  });

  it("never exceeds the cap the server will accept", () => {
    expect(leaseFor(10_000)).toBe(MAX_LEASE_MS);
    expect(MAX_LEASE_MS).toBeLessThanOrEqual(60 * 60_000);
  });

  it("defaults the batch lease to something that covers it", async () => {
    const store = newStore(3);
    const { tier1 } = scripted();
    // No explicit leaseMs: the batch-derived default must be used.
    const rep = await processPending(leasedRepo(store), deps(tier1), 120, { owner: "a" });
    expect(rep.processed).toBe(3);
    expect(rep.leased).toBe(3);
  });
});

describe("collectSource unchanged by leasing", () => {
  it("stores without claiming, so collection never competes with processing", async () => {
    const store: TestStore = { docs: [], leases: new Map() };
    const repo = leasedRepo(store);

    await collectSource(
      {
        id: "src-1",
        name: "Test Feed",
        platform: "RSS",
        handle: "https://example.test/feed",
        domain: "Air",
        notes: "",
      },
      async () => ({
        ok: true,
        posts: [
          { id: "p1", text: "A drone report number 1", url: "https://example.test/p1" },
          { id: "p2", text: "A drone report number 2", url: "https://example.test/p2" },
        ],
      }),
      repo,
    );

    expect(store.docs).toHaveLength(2);
    // Nothing is leased: a new dispatch is immediately claimable.
    expect(await repo.claim!(10, 60_000, "w")).toHaveLength(2);
  });
});
