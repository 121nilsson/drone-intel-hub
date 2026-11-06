import { describe, expect, it } from "vitest";
import type { RawDispatch } from "@/entities/dispatch/types";
import type { MonitoredSource } from "@/entities/source/types";
import { collectSource, dispatchId, type Fetcher } from "@/shared/infra/ingest/collect";
import {
  DocumentConflictError,
  type Collection,
  type CollectionMap,
  type DocumentStore,
  type VersionedDoc,
} from "@/shared/contracts/store";
import { LocalDispatchRepository } from "@/shared/infra/storage/local-repository";

/**
 * The server's dispatch cache is a window onto the newest posts (the stores cap `load`), while the
 * table keeps everything. Two things used to break at the window's edge:
 *
 *  - a feed re-serving an old post looked new to `has`, was inserted, and storage rejected it as a
 *    conflict - logged as a lost edit thousands of times a day;
 *  - a post older than the window that was still `pending` was leased, then not found in the
 *    cache, and so was never analysed.
 *
 * The store below is the Postgres behaviour that matters: a capped `load`, `loadByIds`, an
 * insert-only `put` that conflicts on an existing id, and an oldest-first `claim`.
 */
const WINDOW = 2;

class WindowedStore implements DocumentStore {
  readonly docs = new Map<string, RawDispatch>();
  conflicts = 0;
  releasedAfterClaim: string[] = [];

  seedAll(items: RawDispatch[]) {
    for (const d of items) this.docs.set(d.id, d);
  }
  async load<C extends Collection>(_c?: C): Promise<VersionedDoc<CollectionMap[C]>[] | null> {
    const newest = [...this.docs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, WINDOW);
    return newest.map((doc) => ({ doc, rev: 1 })) as unknown as VersionedDoc<CollectionMap[C]>[];
  }
  async loadByIds<C extends Collection>(_c: C, ids: string[]) {
    return ids
      .map((id) => this.docs.get(id))
      .filter((d): d is RawDispatch => !!d)
      .map((doc) => ({ doc, rev: 1 })) as unknown as VersionedDoc<CollectionMap[C]>[];
  }
  async seed() {}
  async put<C extends Collection>(c: C, doc: CollectionMap[C], expectedRev: number | null) {
    const d = doc as unknown as RawDispatch;
    if (expectedRev === null && this.docs.has(d.id)) {
      this.conflicts++;
      throw new DocumentConflictError(c, d.id);
    }
    this.docs.set(d.id, d);
    return (expectedRev ?? 0) + 1;
  }
  async remove() {}
  async claim() {
    return [...this.docs.values()]
      .filter((d) => d.status === "pending")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((d) => d.id);
  }
}

const post = (n: number, over: Partial<RawDispatch> = {}): RawDispatch => ({
  id: `src|${n}`,
  sourceId: "src",
  sourceName: "Source",
  externalId: String(n),
  url: `https://example.com/${n}`,
  text: `A long enough report number ${n} about a drone programme for the archive to keep it.`,
  createdAt: `2026-10-0${n}T00:00:00.000Z`,
  status: "processed",
  ...over,
});

/** Posts 1-2 sit outside the window (the newest are 3-4), as an old feed item does. */
function setup() {
  const store = new WindowedStore();
  store.seedAll([post(1, { status: "pending" }), post(2), post(3), post(4)]);
  const repo = new LocalDispatchRepository();
  return { store, repo };
}

const source = { id: "src", name: "Source" } as MonitoredSource;
const fetcherOf =
  (...ns: number[]): Fetcher =>
  async () => ({
    ok: true,
    posts: ns.map((n) => ({ id: String(n), url: `https://example.com/${n}`, text: post(n).text })),
  });

describe("the dispatch cache is a window onto the newest posts", () => {
  it("does not know an old stored post until it is preloaded", async () => {
    const { store, repo } = setup();
    await repo.attach(store);
    expect(repo.has(dispatchId("src", "2"))).toBe(false);

    await repo.preload([dispatchId("src", "2")]);

    expect(repo.has(dispatchId("src", "2"))).toBe(true);
  });

  it("re-collecting a post older than the window stores nothing and causes no conflict", async () => {
    const { store, repo } = setup();
    await repo.attach(store);

    const report = await collectSource(source, fetcherOf(1, 2, 3), repo);
    await repo.flush();

    expect(report.stored).toBe(0);
    expect(report.duplicates).toBe(0);
    expect(store.conflicts).toBe(0);
  });

  it("still stores a post that is genuinely new", async () => {
    const { store, repo } = setup();
    await repo.attach(store);

    const report = await collectSource(source, fetcherOf(2, 9), repo);
    await repo.flush();

    expect(report.stored).toBe(1);
    expect(store.docs.has(dispatchId("src", "9"))).toBe(true);
    expect(store.conflicts).toBe(0);
  });

  it("hands back a leased post that is older than the window", async () => {
    const { store, repo } = setup();
    await repo.attach(store);

    const ids = await repo.claim(10, 60_000, "worker");

    expect(ids).toEqual(["src|1"]);
    // The caller looks the leased id up in the cache; before, this was undefined and the post was
    // skipped on every tick.
    expect(repo.list().find((d) => d.id === "src|1")?.status).toBe("pending");
    expect(repo.pending(10).map((d) => d.id)).toEqual(["src|1"]);
  });

  it("does nothing, and does not fail, on a store without loadByIds", async () => {
    const { store, repo } = setup();
    const bare: DocumentStore = {
      load: (c) => store.load(c),
      seed: async () => {},
      put: (c, d, r) => store.put(c, d, r),
      remove: async () => {},
    };
    await repo.attach(bare);

    await repo.preload([dispatchId("src", "2")]);

    expect(repo.has(dispatchId("src", "2"))).toBe(false);
  });
});
