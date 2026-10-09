import { describe, expect, it } from "vitest";
import { processPending } from "@/features/sources/auto-ingest";
import type { PipelineDeps } from "@/features/intake/pipeline";
import type { DispatchRepository } from "@/shared/contracts/repository";
import type { RawDispatch } from "@/entities/dispatch/types";
import type { IntelExtractor } from "@/shared/contracts/ai";
import type { Candidate, Drone, Extraction } from "@/entities/drone/types";

const row = (id: string, text: string): RawDispatch => ({
  id,
  sourceId: "s1",
  sourceName: "Source",
  externalId: id,
  url: `https://example.com/${id}`,
  text,
  createdAt: new Date().toISOString(),
  status: "pending",
});

const makeDispatches = (rows: RawDispatch[]) =>
  ({
    list: () => rows,
    pending: (n: number) => rows.filter((r) => r.status === "pending").slice(0, n),
    update: (id: string, patch: Partial<RawDispatch>) => {
      const r = rows.find((x) => x.id === id);
      if (r) Object.assign(r, patch);
    },
    add: () => true,
  }) as unknown as DispatchRepository;

const okExtraction = (name: string): Extraction =>
  ({
    name,
    aliases: [],
    operators: [],
    specs: [],
    rfBands: [],
    systems: [],
    confidence: 0.9,
    rationale: "test",
  }) as Extraction;

/** Throws for posts containing `failMarker`, extracts a normal system for everything else. */
const extractor = (failMarker: string, msg: string): IntelExtractor => ({
  tier: 1,
  label: "mixed",
  extract: async (raw: string) => {
    if (raw.includes(failMarker)) throw new Error(msg);
    return okExtraction("Geran-2");
  },
});

const deps = (tier1: IntelExtractor): PipelineDeps =>
  ({
    drones: {
      list: () => [] as Drone[],
      get: () => undefined,
      upsert: () => {},
      remove: () => {},
      search: () => [] as Drone[],
    },
    candidates: { list: () => [] as Candidate[], add: () => {}, update: () => {} },
    tier1,
    tier2: tier1,
    escalationThreshold: 0.6,
    autoMergeThreshold: 0.85,
  }) as PipelineDeps;

describe("processPending error handling", () => {
  it("continues the batch after a document-specific failure", async () => {
    // A parse bug or unexpected extraction shape says nothing about the next document:
    // only that post is retried, the rest of the queue is not starved.
    const rows = [
      row("a", "Alpha drone post about a Lancet strike"),
      row("b", "Bravo drone post about a Geran strike"),
    ];
    const dispatches = makeDispatches(rows);
    const rep = await processPending(
      dispatches,
      deps(extractor("Alpha", "Extraction produced an unexpected shape")),
      10,
    );
    expect(rep.processed).toBe(1);
    expect(rep.failed).toBe(1);
    // The batch did not stop, so there is no stopReason for the cooldown logic to key off.
    expect(rep.stopReason).toBeUndefined();
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.attempts).toBe(1);
    expect(rows[1]!.status).toBe("processed");
  });

  it.each(["Provider rate limit (429)", "Provider credits (402)", "Provider auth (401)"])(
    "stops the batch on a provider outage: %s",
    async (msg) => {
      const rows = [
        row("a", "Alpha drone post about a Lancet strike"),
        row("b", "Bravo drone post about a Geran strike"),
      ];
      const dispatches = makeDispatches(rows);
      const rep = await processPending(dispatches, deps(extractor("Alpha", msg)), 10);
      expect(rep.processed).toBe(0);
      expect(rep.failed).toBe(1);
      expect(rep.stopReason).toBeTruthy();
      // The outage also applies to the rest of the batch: it was never started.
      expect(rows[1]!.status).toBe("pending");
    },
  );

  it("does not stop the batch on a document-level timeout or network error", async () => {
    const rows = [
      row("a", "Alpha drone post, oversized and slow"),
      row("b", "Bravo drone post about a Geran strike"),
    ];
    const dispatches = makeDispatches(rows);
    const rep = await processPending(
      dispatches,
      deps(extractor("Alpha", "Provider timeout")),
      10,
    );
    expect(rep.processed).toBe(1);
    expect(rep.failed).toBe(1);
    expect(rows[1]!.status).toBe("processed");
  });
});
