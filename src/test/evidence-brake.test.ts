import { describe, expect, it, vi } from "vitest";
import { runTwoTier, type PipelineDeps } from "@/shared/infra/ingest/pipeline";
import { processPending } from "@/shared/infra/ingest/auto-ingest";
import { OpenAICompatibleExtractor } from "@/shared/infra/openai-compatible-ai";
import type { ChatInput, ChatResult } from "@/shared/infra/ai-proxy.server";
import type { Candidate, ExtractedSpec, Extraction } from "@/entities/drone/types";
import type { RawDispatch } from "@/entities/dispatch/types";
import type {
  AIProviderSettings,
  IntelExtractor,
  RequoteItem,
  RequoteReply,
} from "@/shared/contracts/ai";
import type { DispatchRepository } from "@/shared/contracts/repository";

const POST =
  "Zala-421 drone loitering munition over Odesa. Its range is 40 kilometres on a single charge.";
const NO_FIGURE_POST =
  "Zala-421 drone loitering munition over Odesa. Its range is long on a single charge.";
const SAID = "Its range is 40 kilometres on a single charge.";

const spec = (over: Partial<ExtractedSpec> = {}): ExtractedSpec => ({
  key: "range",
  label: "Range",
  value: 40,
  unit: "km",
  evidence: "range of forty kilometres",
  provenance: "ai",
  ...over,
});

/** A figure with no provenance at all, as a candidate stored before provenance existed has. */
const withoutProvenance = (): ExtractedSpec => {
  const s = spec();
  delete s.provenance;
  return s;
};

const extraction = (
  specs: ExtractedSpec[],
  engine: "ai" | "heuristic" | "combined" = "ai",
): Extraction => ({
  name: "Zala-421",
  aliases: [],
  operators: [],
  specs,
  rfBands: [],
  systems: [{ name: "Zala-421" }],
  confidence: 0.95,
  rationale: "test",
  metadata: { schemaVersion: 1, engine, analyzedAt: "2026-11-11T00:00:00.000Z" },
});

/** An extractor that returns a fresh copy of `ex` each call, so the brake's edits never leak. */
const aiTier = (ex: Extraction, requote?: IntelExtractor["requote"]): IntelExtractor => ({
  tier: 1,
  label: "ai",
  extract: async () => structuredClone(ex),
  ...(requote ? { requote } : {}),
});

function deps(tier: IntelExtractor): PipelineDeps {
  const cands: Candidate[] = [];
  return {
    drones: {
      list: () => [],
      get: () => undefined,
      upsert: () => {},
      remove: () => {},
      search: () => [],
    } as unknown as PipelineDeps["drones"],
    candidates: {
      list: () => cands,
      add: (c: Candidate) => cands.push(c),
      update: () => {},
      remove: () => {},
    },
    tier1: tier,
    tier2: tier,
    escalationThreshold: 0.6,
    autoMergeThreshold: 0.85,
  } as PipelineDeps;
}

describe("evidence brake: quote matching", () => {
  it("keeps a figure whose quote differs from the post only by NFKC form", async () => {
    // Fullwidth digits in the post: the verifier's fold (NFKC) finds "40"; the old local fold did not.
    const fullwidth = POST.replace("40", "４０");
    const res = await runTwoTier(
      fullwidth,
      "src",
      deps(aiTier(extraction([spec({ evidence: SAID })]))),
    );
    expect(res.candidate.extraction.specs).toHaveLength(1);
    expect(res.trace?.droppedForEvidence).toBeUndefined();
  });
});

describe("evidence brake: counting", () => {
  it("counts a dropped figure and processPending writes the count to the dispatch analysis", async () => {
    const rows: RawDispatch[] = [
      {
        id: "a",
        sourceId: "s1",
        sourceName: "Source",
        externalId: "a",
        url: "https://example.com/a",
        text: POST,
        createdAt: new Date().toISOString(),
        status: "pending",
      },
    ];
    const dispatches = {
      list: () => rows,
      pending: () => rows.filter((r) => r.status === "pending"),
      update: (id: string, patch: Partial<RawDispatch>) => {
        const r = rows.find((x) => x.id === id);
        if (r) Object.assign(r, patch);
      },
      add: () => true,
    } as unknown as DispatchRepository;
    // The quote is not in the post and there is no repair engine, so the one figure is dropped.
    await processPending(dispatches, deps(aiTier(extraction([spec()]))), 10);
    expect(rows[0]!.analysis).toMatchObject({ engine: "ai", droppedForEvidence: 1 });
    expect(rows[0]!.analysis).not.toHaveProperty("requoted");
  });

  it("writes no count when every figure holds", async () => {
    const rows: RawDispatch[] = [
      {
        id: "b",
        sourceId: "s1",
        sourceName: "Source",
        externalId: "b",
        url: "https://example.com/b",
        text: POST,
        createdAt: new Date().toISOString(),
        status: "pending",
      },
    ];
    const dispatches = {
      list: () => rows,
      pending: () => rows.filter((r) => r.status === "pending"),
      update: (id: string, patch: Partial<RawDispatch>) => {
        const r = rows.find((x) => x.id === id);
        if (r) Object.assign(r, patch);
      },
      add: () => true,
    } as unknown as DispatchRepository;
    await processPending(dispatches, deps(aiTier(extraction([spec({ evidence: SAID })]))), 10);
    expect(rows[0]!.analysis).not.toHaveProperty("droppedForEvidence");
    expect(rows[0]!.analysis).not.toHaveProperty("requoted");
  });
});

describe("evidence brake: one repair attempt", () => {
  it("keeps a paraphrased AI figure when the repair returns an exact passage with the figure", async () => {
    const requote = vi.fn(async (_raw: string, items: RequoteItem[]) =>
      items.map((i) => ({ ref: i.ref, quote: SAID })),
    );
    const res = await runTwoTier(POST, "src", deps(aiTier(extraction([spec()]), requote)));
    expect(requote).toHaveBeenCalledTimes(1);
    expect(res.candidate.extraction.specs).toHaveLength(1);
    expect(res.candidate.extraction.specs[0]!.evidence).toBe(SAID);
    expect(res.trace?.requoted).toBe(1);
    expect(res.trace?.droppedForEvidence).toBeUndefined();
  });

  it("drops the figure when the repair quote is not in the post", async () => {
    const requote = vi.fn(async (_raw: string, items: RequoteItem[]) =>
      items.map((i) => ({ ref: i.ref, quote: "Range is 40 km per charge, per the maker." })),
    );
    const res = await runTwoTier(POST, "src", deps(aiTier(extraction([spec()]), requote)));
    expect(requote).toHaveBeenCalledTimes(1);
    expect(res.candidate.extraction.specs).toHaveLength(0);
    expect(res.trace?.droppedForEvidence).toBe(1);
    expect(res.trace?.requoted).toBeUndefined();
  });

  it("drops the figure when the repair quote is in the post but lacks the figure", async () => {
    const requote = vi.fn(async (_raw: string, items: RequoteItem[]) =>
      items.map((i) => ({ ref: i.ref, quote: "Its range is long on a single charge." })),
    );
    const res = await runTwoTier(
      NO_FIGURE_POST,
      "src",
      deps(aiTier(extraction([spec()]), requote)),
    );
    expect(res.candidate.extraction.specs).toHaveLength(0);
    expect(res.trace?.droppedForEvidence).toBe(1);
  });

  it("drops the figure when the repair answers null", async () => {
    const requote = vi.fn(async (_raw: string, items: RequoteItem[]) =>
      items.map((i) => ({ ref: i.ref, quote: null })),
    );
    const res = await runTwoTier(POST, "src", deps(aiTier(extraction([spec()]), requote)));
    expect(res.candidate.extraction.specs).toHaveLength(0);
    expect(res.trace?.droppedForEvidence).toBe(1);
  });

  it("drops only the failing figure when the repair throws, and the pipeline result is otherwise unchanged", async () => {
    const good = spec({
      key: "speed",
      label: "Speed",
      value: 120,
      unit: "km/h",
      evidence: "max speed 120 km/h",
    });
    const ok = spec({ evidence: "Zala-421 drone loitering munition" });
    const requote = vi.fn(async () => {
      throw new Error("provider down");
    });
    const res = await runTwoTier(POST, "src", deps(aiTier(extraction([ok, good]), requote)));
    expect(requote).toHaveBeenCalledTimes(1);
    expect(res.kind).toBe("queued");
    expect(res.candidate.extraction.specs.map((s) => s.label)).toEqual(["Range"]);
    expect(res.trace?.droppedForEvidence).toBe(1);
  });

  it("does not call the repair for a heuristic-only figure", async () => {
    const requote = vi.fn(async () => []);
    const res = await runTwoTier(
      POST,
      "src",
      deps(aiTier(extraction([spec({ provenance: "heuristic" })]), requote)),
    );
    expect(requote).not.toHaveBeenCalled();
    expect(res.trace?.droppedForEvidence).toBe(1);
  });

  it("does not call the repair when the extraction came from the heuristic engine", async () => {
    const requote = vi.fn(async () => []);
    const res = await runTwoTier(
      POST,
      "src",
      deps(aiTier(extraction([withoutProvenance()], "heuristic"), requote)),
    );
    expect(requote).not.toHaveBeenCalled();
    expect(res.trace?.droppedForEvidence).toBe(1);
  });

  it("makes at most one repair call per post, with at most 12 items", async () => {
    const specs = Array.from({ length: 14 }, (_, i) =>
      spec({ key: `r${i}`, label: `Range ${i}`, value: i + 1, evidence: `paraphrase ${i}` }),
    );
    const requote = vi.fn(async (_raw: string, _items: RequoteItem[]) => [] as RequoteReply[]);
    const res = await runTwoTier(POST, "src", deps(aiTier(extraction(specs), requote)));
    expect(requote).toHaveBeenCalledTimes(1);
    const items = requote.mock.calls[0]![1];
    expect(items).toHaveLength(12);
    expect(res.trace?.droppedForEvidence).toBe(14);
  });
});

describe("OpenAICompatibleExtractor.requote", () => {
  const cfg = {
    baseUrl: "https://example.test",
    apiKey: "test",
    tier1Model: "m1",
    tier2Model: "m2",
  } as AIProviderSettings;

  it("sends the numbered items and reads back the quotes by ref", async () => {
    const chat = vi.fn(async (_i: ChatInput): Promise<ChatResult> => ({
      ok: true,
      content: JSON.stringify({
        quotes: [
          { ref: "1", quote: SAID },
          { ref: 2, quote: null },
        ],
      }),
    }));
    const ex = new OpenAICompatibleExtractor(1, cfg, chat);
    const out = await ex.requote(POST, [
      { ref: "1", label: "Range", value: "40 km", quote: "range of forty kilometres" },
      { ref: "2", label: "Speed", value: "120 km/h", quote: "fast" },
    ]);
    expect(out).toEqual([
      { ref: "1", quote: SAID },
      { ref: "2", quote: null },
    ]);
    expect(chat.mock.calls[0]![0].prompt).toContain("[1] Range: 40 km");
    expect(chat.mock.calls[0]![0].json).toBe(true);
  });

  it("throws on a reply with no quotes array, which the brake treats as no repair", async () => {
    const chat = async (): Promise<ChatResult> => ({ ok: true, content: '{"answer":1}' });
    const ex = new OpenAICompatibleExtractor(1, cfg, chat);
    await expect(
      ex.requote(POST, [{ ref: "1", label: "R", value: "1", quote: "q" }]),
    ).rejects.toThrow("Invalid requote JSON");
  });
});
