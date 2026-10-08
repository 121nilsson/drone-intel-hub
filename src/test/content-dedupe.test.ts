import { describe, expect, it, vi } from "vitest";
import { collectSource, processPending } from "@/features/sources/auto-ingest";
import { LocalDispatchRepository } from "@/shared/infra/local-repository";
import { MAX_ATTEMPTS, type RawDispatch } from "@/entities/dispatch/types";
import { MIN_CHARS_FOR_DEDUPE } from "@/entities/dispatch/simhash";
import type { MonitoredSource } from "@/entities/source/types";
import type { Candidate, Drone, Extraction } from "@/entities/drone/types";
import type { DispatchRepository } from "@/shared/contracts/repository";
import type { PipelineDeps } from "@/features/intake/pipeline";
import type { FetchedPost } from "@/shared/infra/fetch-posts";

const REPORT_A = `A Geran-2 struck an energy substation in the Odesa region overnight. Ukrainian air defences downed twelve of the sixteen loitering munitions launched, and the remainder damaged transformer equipment causing rolling blackouts.`;
const REPORT_A_REPRINTED = `${REPORT_A}\n\nvia @citeam`;
const REPORT_A_REORDERED = `Ukrainian air defences downed twelve of the sixteen loitering munitions launched, and the remainder damaged transformer equipment causing rolling blackouts. A Geran-2 struck an energy substation in the Odesa region overnight.`;
const REPORT_B = `Baykar delivered the first batch of Bayraktar TB2 airframes to an overseas customer under an export contract signed last year, according to a statement from the manufacturer released on Thursday.`;

const source = (id: string, name: string): MonitoredSource => ({
  id,
  name,
  platform: "Telegram",
  handle: `@${id}`,
  domain: "Air",
  notes: "",
});

function fetcherFor(postsBySource: Record<string, FetchedPost[]>) {
  return (s: MonitoredSource) =>
    Promise.resolve({
      ok: true as const,
      posts: postsBySource[s.id] ?? [],
    });
}

const post = (id: string, text: string): FetchedPost => ({ id, text, url: `https://t.test/${id}` });

/** The real repository, left unattached: writes go nowhere, so no store double is needed. */
const repo = () => new LocalDispatchRepository();

/** A repository with no dedupe support, to prove the optional call path stays optional. */
function bareRepo(seed: RawDispatch[] = []): DispatchRepository {
  let items = [...seed];
  return {
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
    pending: (limit) => items.filter((d) => d.status === "pending").slice(0, limit),
  };
}

describe("collectSource cross-source dedupe", () => {
  it("stores a copy of an already-stored story as a duplicate stub", async () => {
    const dispatches = repo();
    await collectSource(
      source("a", "Source A"),
      fetcherFor({ a: [post("1", REPORT_A)] }),
      dispatches,
    );
    // The same story from another source, worded differently at the edges.
    const rep = await collectSource(
      source("b", "Source B"),
      fetcherFor({ b: [post("1", REPORT_A_REPRINTED)] }),
      dispatches,
    );

    expect(rep.fetched).toBe(1);
    expect(rep.stored).toBe(0);
    expect(rep.duplicates).toBe(1);

    // Newest first, so the duplicate is at the head of the list.
    const [duplicate, canonical] = dispatches.list();
    expect(duplicate!.status).toBe("duplicate");
    // Text stripped: the stub must never be analysed.
    expect(duplicate!.text).toBe("");
    // Provenance kept: which source carried it, and what it copied.
    expect(duplicate!.sourceId).toBe("b");
    expect(canonical!.status).toBe("pending");
    expect(duplicate!.duplicateOf).toBe(canonical!.id);
    expect(duplicate!.url).toBe("https://t.test/1");
  });

  it("catches a reprint with new framing and appended attribution", async () => {
    const dispatches = repo();
    await collectSource(source("a", "A"), fetcherFor({ a: [post("1", REPORT_A)] }), dispatches);
    const rep = await collectSource(
      source("b", "B"),
      fetcherFor({ b: [post("1", REPORT_A_REPRINTED)] }),
      dispatches,
    );
    expect(rep.duplicates).toBe(1);
  });

  it("catches a copy with paragraphs reordered", async () => {
    const dispatches = repo();
    await collectSource(source("a", "A"), fetcherFor({ a: [post("1", REPORT_A)] }), dispatches);
    const rep = await collectSource(
      source("b", "B"),
      fetcherFor({ b: [post("1", REPORT_A_REORDERED)] }),
      dispatches,
    );
    expect(rep.duplicates).toBe(1);
  });

  it("stores genuinely different stories from different sources", async () => {
    const dispatches = repo();
    await collectSource(source("a", "A"), fetcherFor({ a: [post("1", REPORT_A)] }), dispatches);
    const rep = await collectSource(
      source("b", "B"),
      fetcherFor({ b: [post("1", REPORT_B)] }),
      dispatches,
    );

    expect(rep.duplicates).toBe(0);
    expect(rep.stored).toBe(1);
    expect(dispatches.list().every((d) => d.status === "pending")).toBe(true);
  });

  it("catches a second copy inside the same batch", async () => {
    // Same source, two external ids, same story: the second must register as a duplicate, which is
    // the case add()'s fingerprint registration exists for.
    const dispatches = repo();
    const rep = await collectSource(
      source("a", "A"),
      fetcherFor({ a: [post("1", REPORT_A), post("2", REPORT_A_REPRINTED)] }),
      dispatches,
    );

    expect(rep.stored).toBe(1);
    expect(rep.duplicates).toBe(1);
  });

  it("points every duplicate at the canonical post, never at another duplicate", async () => {
    const dispatches = repo();
    await collectSource(source("a", "A"), fetcherFor({ a: [post("1", REPORT_A)] }), dispatches);
    await collectSource(source("b", "B"), fetcherFor({ b: [post("1", REPORT_A)] }), dispatches);
    await collectSource(source("c", "C"), fetcherFor({ c: [post("1", REPORT_A)] }), dispatches);

    const dispatches_ = dispatches.list();
    expect(dispatches_).toHaveLength(3);
    const canonical = dispatches_.find((d) => d.status !== "duplicate")!;
    for (const d of dispatches_.filter((x) => x.status === "duplicate")) {
      expect(d.duplicateOf).toBe(canonical.id);
      // A chain of stubs would leave these links dangling.
      expect(canonical.text).not.toBe("");
    }
  });

  it("never dedupes a post below the length floor", async () => {
    const dispatches = repo();
    const short = "Geran-2 sighted over Odesa last night, air defences engaged";
    await collectSource(source("a", "A"), fetcherFor({ a: [post("1", short)] }), dispatches);
    await collectSource(source("b", "B"), fetcherFor({ b: [post("1", short)] }), dispatches);

    expect(short.length).toBeLessThan(MIN_CHARS_FOR_DEDUPE);
    expect(dispatches.list().filter((d) => d.status === "pending")).toHaveLength(2);
  });

  it("still collects when the repository has no dedupe support", async () => {
    const dispatches = bareRepo();
    const rep = await collectSource(
      source("a", "A"),
      fetcherFor({ a: [post("1", REPORT_A)] }),
      dispatches,
    );
    await collectSource(source("b", "B"), fetcherFor({ b: [post("1", REPORT_A)] }), dispatches);
    expect(rep.stored).toBe(1);
    expect(dispatches.list()).toHaveLength(2);
  });

  it("does not re-collect a duplicate stub it already holds", async () => {
    const dispatches = repo();
    await collectSource(source("a", "A"), fetcherFor({ a: [post("1", REPORT_A)] }), dispatches);
    await collectSource(source("b", "B"), fetcherFor({ b: [post("1", REPORT_A)] }), dispatches);
    const before = dispatches.list().length;

    const rep = await collectSource(
      source("b", "B"),
      fetcherFor({ b: [post("1", REPORT_A)] }),
      dispatches,
    );

    expect(rep.stored).toBe(0);
    expect(rep.duplicates).toBe(0);
    expect(dispatches.list()).toHaveLength(before);
  });

  it("drops the fingerprint when a dispatch's text is stripped", async () => {
    // Marks a post irrelevant, which empties its text. The same story fetched again must be stored
    // as pending: a stale fingerprint would suppress it as a duplicate of a document that no
    // longer has any text to match.
    const dispatches = repo();
    await collectSource(source("a", "A"), fetcherFor({ a: [post("1", REPORT_A)] }), dispatches);
    const [stored] = dispatches.list();
    dispatches.update(stored!.id, { status: "irrelevant", text: "" });

    await collectSource(source("b", "B"), fetcherFor({ b: [post("1", REPORT_A)] }), dispatches);

    const again = dispatches.list().find((d) => d.sourceId === "b");
    expect(again!.status).toBe("pending");
    expect(again!.text).toBe(REPORT_A);
  });

  it("reports timing and counts on a failed fetch", async () => {
    const dispatches = repo();
    const rep = await collectSource(
      source("a", "A"),
      () => Promise.resolve({ ok: false as const, error: "Fetch timeout" }),
      dispatches,
    );
    expect(rep).toMatchObject({ fetched: 0, stored: 0, duplicates: 0, error: "Fetch timeout" });
    expect(rep.durationMs).toBeGreaterThanOrEqual(0);
    expect(dispatches.list()).toHaveLength(0);
  });
});

describe("what deduplication saves", () => {
  function deps(items: Drone[], cands: Candidate[], extraction: Extraction): PipelineDeps {
    const tier1 = {
      tier: 1 as const,
      label: "scripted",
      extract: () => Promise.resolve(extraction),
    };
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

  const drone = (): Drone => ({
    id: "geran-2",
    name: "Geran-2",
    aliases: [],
    domain: "Air",
    origin: "IR",
    operators: [],
    propulsion: "Unknown",
    summary: "",
    specs: [
      {
        key: "range",
        label: "Range",
        unit: "km",
        claims: [{ value: 970, source: "seed", date: "2026-01-01T00:00:00.000Z" }],
        discoveredBy: "seed",
      },
    ],
    rf: [],
    components: [],
    evolution: [],
    counterpartIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  const extraction = (): Extraction => ({
    aliases: [],
    operators: [],
    specs: [{ key: "range", label: "Range", value: 2000, unit: "km" }],
    rfBands: [],
    matchId: "geran-2",
    confidence: 0.95,
    rationale: "test",
  });

  it("extracts one story once, however many sources carried it", async () => {
    const dispatches = repo();
    await collectSource(source("a", "A"), fetcherFor({ a: [post("1", REPORT_A)] }), dispatches);
    await collectSource(source("b", "B"), fetcherFor({ b: [post("1", REPORT_A)] }), dispatches);
    await collectSource(source("c", "C"), fetcherFor({ c: [post("1", REPORT_A)] }), dispatches);

    const items: Drone[] = [drone()];
    const cands: Candidate[] = [];
    const rep = await processPending(dispatches, deps(items, cands, extraction()), 20);

    // One extraction, one candidate, one extra claim on the dossier.
    expect(rep.processed).toBe(1);
    expect(rep.merged).toBe(1);
    expect(cands).toHaveLength(1);
    expect(items[0]!.specs[0]!.claims).toHaveLength(2);

    // Without dedupe the same three posts would have produced three candidates and three claims,
    // and consensus() would have counted the same fact three times over.
    const withoutDedupe = bareRepo();
    for (const s of ["a", "b", "c"]) {
      await collectSource(
        source(s, s.toUpperCase()),
        fetcherFor({ [s]: [post("1", REPORT_A)] }),
        withoutDedupe,
      );
    }
    const items2: Drone[] = [drone()];
    const cands2: Candidate[] = [];
    await processPending(withoutDedupe, deps(items2, cands2, extraction()), 20);

    expect(cands2).toHaveLength(3);
    expect(items2[0]!.specs[0]!.claims).toHaveLength(4);
    expect(withoutDedupe.list().every((d) => d.status !== "duplicate")).toBe(true);
  });

  it("keeps a duplicate out of the processing queue", async () => {
    const dispatches = repo();
    await collectSource(source("a", "A"), fetcherFor({ a: [post("1", REPORT_A)] }), dispatches);
    await collectSource(source("b", "B"), fetcherFor({ b: [post("1", REPORT_A)] }), dispatches);

    expect(dispatches.pending(10)).toHaveLength(1);
    expect(dispatches.list().filter((d) => d.status === "duplicate")).toHaveLength(1);
  });

  it("leaves MAX_ATTEMPTS untouched for duplicates", async () => {
    // A duplicate is never attempted, so it must never consume a post's retry budget.
    const dispatches = repo();
    await collectSource(source("a", "A"), fetcherFor({ a: [post("1", REPORT_A)] }), dispatches);
    await collectSource(source("b", "B"), fetcherFor({ b: [post("1", REPORT_A)] }), dispatches);

    expect(MAX_ATTEMPTS).toBeGreaterThan(0);
    for (const d of dispatches.list()) expect(d.attempts).toBeUndefined();
  });
});

describe("fingerprint bookkeeping", () => {
  it("rebuilds the index after a reload rather than trusting the old one", async () => {
    const dispatches = repo();
    await collectSource(source("a", "A"), fetcherFor({ a: [post("1", REPORT_A)] }), dispatches);

    // attach() with no store leaves the working set alone but must drop the index, so the next
    // duplicateOf() fingerprints the loaded documents instead of stale entries. If the index were
    // kept, this would still pass - the assertion is that clearing it does not break the match,
    // i.e. the lazy path really does rebuild from the documents.
    await dispatches.attach({
      load: () => Promise.resolve(dispatches.list()),
      seed: () => Promise.resolve(),
      put: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    } as never);
    await collectSource(source("b", "B"), fetcherFor({ b: [post("1", REPORT_A)] }), dispatches);

    const stored = dispatches.list().find((d) => d.sourceId === "b");
    expect(stored!.status).toBe("duplicate");
  });

  it("fingerprints documents that predate the column", async () => {
    const dispatches = repo();
    dispatches.add({
      id: "legacy|1",
      sourceId: "legacy",
      sourceName: "Legacy",
      externalId: "1",
      url: "https://t.test/legacy",
      text: REPORT_A,
      createdAt: "2026-01-01T00:00:00.000Z",
      status: "pending",
      // no contentHash, as a document written before migrations/006 would be
    });

    const rep = await collectSource(
      source("a", "A"),
      fetcherFor({ a: [post("1", REPORT_A)] }),
      dispatches,
    );

    expect(rep.duplicates).toBe(1);
    expect(dispatches.list().find((d) => d.id === "legacy|1")!.status).toBe("pending");
  });
});

// processPending's console noise is expected in the failure path only.
vi.spyOn(console, "error").mockImplementation(() => {});
