import { describe, expect, it } from "vitest";
import { clusterEvents } from "@/entities/dispatch/events";
import { stampEvents } from "@/shared/infra/ingest/auto-ingest";
import type { RawDispatch } from "@/entities/dispatch/types";
import type { DispatchRepository } from "@/shared/contracts/repository";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

const dispatch = (over: Partial<RawDispatch> = {}): RawDispatch => ({
  id: "src|1",
  sourceId: "src",
  sourceName: "Source",
  externalId: "1",
  url: "",
  text: "A long enough report about the drone strike for the archive to keep it around at all.",
  createdAt: iso(NOW),
  status: "processed",
  ...over,
});

/** One permalink carried by three outlets, at different ages. */
const oneStory = (): RawDispatch[] => [
  dispatch({ id: "a|1", sourceId: "a", sourceName: "Militarnyi", url: "https://mil.in.ua/story" }),
  dispatch({
    id: "b|1",
    sourceId: "b",
    sourceName: "TWZ",
    url: "https://mil.in.ua/story?utm_source=rss&utm_medium=feed",
    createdAt: iso(NOW + 60_000),
  }),
  dispatch({
    id: "c|1",
    sourceId: "c",
    sourceName: "Defense One",
    url: "https://mil.in.ua/story/",
    createdAt: iso(NOW - 7 * 86_400_000),
  }),
];

describe("clusterEvents", () => {
  it("links the same article carried by several outlets into one event", () => {
    const clusters = clusterEvents(oneStory());
    expect(clusters.get("a|1")).toBe("evt:c|1");
    expect(clusters.get("b|1")).toBe("evt:c|1");
    expect(clusters.get("c|1")).toBe("evt:c|1");
  });

  it("does not let a query string split one article", () => {
    // canonicalUrl drops the tracking parameters a feed adds to a permalink.
    const clusters = clusterEvents(oneStory());
    expect(new Set(clusters.values()).size).toBe(1);
  });

  it("keeps different articles apart, however similar their addresses", () => {
    const clusters = clusterEvents([
      dispatch({ id: "a|1", url: "https://mil.in.ua/story" }),
      dispatch({ id: "a|2", url: "https://mil.in.ua/story-2" }),
      dispatch({ id: "b|1", url: "https://twz.com/story" }),
    ]);
    expect(clusters.size).toBe(0);
  });

  it("gives a singleton no event, even with the same URL as a pending post", () => {
    const clusters = clusterEvents([
      dispatch({ id: "a|1", url: "https://mil.in.ua/story" }),
      dispatch({ id: "a|2", url: "https://mil.in.ua/story", status: "pending" }),
      dispatch({ id: "a|3", url: "https://mil.in.ua/story", status: "duplicate" }),
    ]);
    expect(clusters.size).toBe(0);
  });

  it("ignores posts without a URL that can be canonicalised", () => {
    const clusters = clusterEvents([
      dispatch({ id: "a|1", url: "" }),
      dispatch({ id: "b|1", url: "not a url" }),
    ]);
    expect(clusters.size).toBe(0);
  });
});

/** A minimal write-through repository over an array, the way stampEvents uses it. */
function repo(items: RawDispatch[]) {
  return {
    list: () => items,
    update: (id: string, patch: Partial<RawDispatch>) => {
      const d = items.find((x) => x.id === id);
      if (!d) return;
      Object.assign(d, patch);
    },
  } as unknown as DispatchRepository & { list: () => RawDispatch[] };
}

describe("stampEvents", () => {
  it("writes the event id onto every member of a cluster", () => {
    const items = oneStory();
    const stamps = stampEvents(repo(items));
    expect(stamps).toBe(3);
    expect(items.map((d) => d.eventId)).toEqual(["evt:c|1", "evt:c|1", "evt:c|1"]);
  });

  it("is idempotent: a second run over the same archive changes nothing", () => {
    const items = oneStory();
    const r = repo(items);
    expect(stampEvents(r)).toBe(3);
    expect(stampEvents(r)).toBe(0);
  });

  it("clears a stale stamp when a post stops being part of a cluster", () => {
    const items = oneStory();
    const r = repo(items);
    stampEvents(r);
    // The survivors no longer share a permalink, so no cluster remains and no stamp may survive.
    items.splice(0, 1);
    items[0]!.url = "https://mil.in.ua/story-2";
    expect(stampEvents(r)).toBe(2);
    expect(items.every((d) => !d.eventId)).toBe(true);
  });
});
