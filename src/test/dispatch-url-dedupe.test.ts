import { beforeEach, describe, expect, it } from "vitest";
import type { RawDispatch } from "@/entities/dispatch/types";
import type { MonitoredSource } from "@/entities/source/types";
import { collectSource, type Fetcher } from "@/shared/infra/ingest/collect";
import { LocalDispatchRepository } from "@/shared/infra/storage/local-repository";
import { LocalStorageStore } from "@/shared/infra/storage/local-store";

/**
 * The URL index used to hold only what the current run had added. A tick builds a new repository,
 * so an article stored by an earlier tick was never found: the same story reaching a second feed
 * the next time round was analysed again and counted as a second source in consensus.
 */
const STORED: RawDispatch = {
  id: "first-feed|a1",
  sourceId: "first-feed",
  sourceName: "First feed",
  externalId: "a1",
  url: "https://news.example.com/story?utm_source=rss",
  text: "A long enough report about a drone programme for the archive to keep it for later.",
  createdAt: "2026-10-01T00:00:00.000Z",
  status: "processed",
};

const feed =
  (url: string): Fetcher =>
  async () => ({
    ok: true,
    posts: [
      { id: "b9", url, text: "A different teaser of the same article, long enough to be kept." },
    ],
  });

const second = { id: "second-feed", name: "Second feed" } as MonitoredSource;

beforeEach(() => localStorage.clear());

async function repoWithStoredPost(...docs: RawDispatch[]) {
  const store = new LocalStorageStore();
  await store.seed("dispatches", docs);
  // A new repository, as every tick builds: nothing in memory but what attach() read.
  const repo = new LocalDispatchRepository();
  await repo.attach(store);
  return repo;
}

describe("URL dedupe across runs", () => {
  it("finds the article an earlier run stored, whatever the tracking parameters", async () => {
    const repo = await repoWithStoredPost(STORED);

    const report = await collectSource(
      second,
      feed("https://www.news.example.com/story/?utm_medium=feed"),
      repo,
    );

    expect(report.stored).toBe(0);
    expect(report.duplicates).toBe(1);
    const stub = repo.list().find((d) => d.id === "second-feed|b9");
    expect(stub?.status).toBe("duplicate");
    expect(stub?.duplicateOf).toBe(STORED.id);
    expect(stub?.text).toBe("");
  });

  it("does not suppress a different article", async () => {
    const repo = await repoWithStoredPost(STORED);

    const report = await collectSource(second, feed("https://news.example.com/other"), repo);

    expect(report.stored).toBe(1);
    expect(report.duplicates).toBe(0);
  });

  it("does not let a stored post with its text stripped suppress the copy that has the report", async () => {
    // The teaser was judged irrelevant and its text removed; the full copy must still be analysed.
    const repo = await repoWithStoredPost({ ...STORED, status: "irrelevant", text: "" });

    const report = await collectSource(second, feed("https://news.example.com/story"), repo);

    expect(report.stored).toBe(1);
    expect(report.duplicates).toBe(0);
  });

  it("points a later copy at the oldest stored one", async () => {
    const older = { ...STORED, id: "older|1", createdAt: "2026-09-01T00:00:00.000Z" };
    const repo = await repoWithStoredPost(STORED, older);

    await collectSource(second, feed("https://news.example.com/story"), repo);

    expect(repo.list().find((d) => d.id === "second-feed|b9")?.duplicateOf).toBe("older|1");
  });
});
