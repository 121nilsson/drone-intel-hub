import { describe, expect, it } from "vitest";
import type { RawDispatch } from "@/entities/dispatch/types";
import {
  DocumentConflictError,
  PermanentStoreError,
  type Collection,
  type CollectionMap,
  type DocumentStore,
  type VersionedDoc,
} from "@/shared/contracts/store";
import { LocalDispatchRepository } from "@/shared/infra/storage/local-repository";

/**
 * A write that fails for a reason other than a conflict (a dropped connection, a server restart) is
 * retried a few times before it is reported. Before, the edit was lost until the analyst made it
 * again, and the cache was reloaded over it.
 */
const post = (over: Partial<RawDispatch> = {}): RawDispatch => ({
  id: "src|1",
  sourceId: "src",
  sourceName: "Source",
  externalId: "1",
  url: "https://example.com/1",
  text: "A long enough report about a drone programme for the archive to keep it for later.",
  createdAt: "2026-10-01T00:00:00.000Z",
  status: "pending",
  ...over,
});

/** A store whose writes fail on demand and that keeps what it is given. */
class FlakyStore implements DocumentStore {
  docs = new Map<string, { doc: RawDispatch; rev: number }>();
  puts = 0;
  removes = 0;
  /** How many calls fail before one succeeds. */
  failPuts = 0;
  failRemoves = 0;
  /** Fail the way a lost reply does: the write lands, then the call rejects. */
  landThenFail = false;
  error: unknown = new Error("Failed to fetch");

  async load<C extends Collection>(): Promise<VersionedDoc<CollectionMap[C]>[] | null> {
    return [...this.docs.values()] as unknown as VersionedDoc<CollectionMap[C]>[];
  }
  async seed() {}
  async put<C extends Collection>(_c: C, doc: CollectionMap[C], expectedRev: number | null) {
    this.puts++;
    const d = doc as unknown as RawDispatch;
    const stored = this.docs.get(d.id);
    if (this.failPuts > 0) {
      this.failPuts--;
      if (this.landThenFail) this.docs.set(d.id, { doc: d, rev: (stored?.rev ?? 0) + 1 });
      throw this.error;
    }
    if ((stored?.rev ?? null) !== expectedRev) throw new DocumentConflictError(_c, d.id);
    const rev = (stored?.rev ?? 0) + 1;
    this.docs.set(d.id, { doc: d, rev });
    return rev;
  }
  async remove(_c: Collection, id: string) {
    this.removes++;
    if (this.failRemoves > 0) {
      this.failRemoves--;
      throw this.error;
    }
    this.docs.delete(id);
  }
}

async function setup(store: FlakyStore, delays: readonly number[] = [0, 0, 0]) {
  store.docs.set("src|1", { doc: post(), rev: 1 });
  const repo = new LocalDispatchRepository();
  (repo as unknown as { retryDelaysMs: readonly number[] }).retryDelaysMs = delays;
  await repo.attach(store);
  const warnings: string[] = [];
  repo.onStorageError((m) => warnings.push(m));
  return { repo, warnings };
}

describe("a failed write is retried before it is reported", () => {
  it("saves the edit when the store recovers within the retries, and reports nothing", async () => {
    const store = new FlakyStore();
    const { repo, warnings } = await setup(store);
    store.failPuts = 2;

    repo.update("src|1", { status: "processed" });
    await repo.flush();

    expect(store.puts).toBe(3);
    expect(store.docs.get("src|1")?.doc.status).toBe("processed");
    expect(repo.list()[0]?.status).toBe("processed");
    expect(warnings).toEqual([]);
  });

  it("reports the failure and restores the stored copy once the retries are used up", async () => {
    const store = new FlakyStore();
    const { repo, warnings } = await setup(store);
    store.failPuts = 99;

    repo.update("src|1", { status: "processed" });
    await repo.flush();

    expect(store.puts).toBe(4); // the first try and three retries
    expect(warnings[0]).toMatch(/could not save dispatches\/src\|1/);
    expect(repo.list()[0]?.status).toBe("pending");
  });

  it("does not report a retry that finds its own write already stored", async () => {
    // The first call landed but its reply was lost; the retry then conflicts with itself.
    const store = new FlakyStore();
    const { repo, warnings } = await setup(store);
    store.failPuts = 1;
    store.landThenFail = true;

    repo.update("src|1", { status: "processed" });
    await repo.flush();

    expect(store.docs.get("src|1")?.doc.status).toBe("processed");
    expect(repo.list()[0]?.status).toBe("processed");
    expect(warnings).toEqual([]);
  });

  it("does not retry a full browser store", async () => {
    const store = new FlakyStore();
    const { repo, warnings } = await setup(store);
    store.failPuts = 99;
    store.error = new PermanentStoreError("browser storage could not save dispatches");

    repo.update("src|1", { status: "processed" });
    await repo.flush();

    expect(store.puts).toBe(1);
    expect(warnings[0]).toMatch(/could not save/);
  });

  it("retries a delete too", async () => {
    const store = new FlakyStore();
    const { repo } = await setup(store);
    store.failRemoves = 2;

    (repo as unknown as { drop(id: string): void }).drop("src|1");
    await repo.flush();

    expect(store.removes).toBe(3);
    expect(store.docs.has("src|1")).toBe(false);
  });

  it("waits between tries by the configured delays", async () => {
    const store = new FlakyStore();
    const { repo } = await setup(store, [30, 30]);
    store.failPuts = 2;
    const started = Date.now();

    repo.update("src|1", { status: "processed" });
    await repo.flush();

    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
    expect(store.docs.get("src|1")?.doc.status).toBe("processed");
  });
});
