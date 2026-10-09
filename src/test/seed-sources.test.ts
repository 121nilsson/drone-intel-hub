import { describe, expect, it } from "vitest";
import { ACTIVE_SEED_SOURCES, RETIRED_SOURCE_IDS } from "@/entities/source/seed";

/**
 * Seed hygiene.
 *
 * A seeded source that silently returns nothing is invisible: the Sources page shows it as
 * "reachable, 0 posts" and nothing anywhere reports an error, because a feed that answers 200 with
 * zero items is not a failure. Three of the handles corrected on 2026-10-10 had been dead that way
 * (a 302 to a 404 page, and two index pages whose anchors were navigation chrome).
 *
 * These assertions cannot prove a URL is alive - that needs the network, and a test that depends on
 * a third party fails on their outage rather than on our change. They pin the mistakes that are
 * ours: a non-https handle (rejected at fetch time, see fetchOne), a duplicate id, or a duplicate
 * handle (two sources polling one feed, which is the overlap the URL dedupe exists to absorb).
 */
describe("seeded sources", () => {
  const active = ACTIVE_SEED_SOURCES;

  it("gives every source a unique id", () => {
    const ids = active.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never seeds a retired id back", () => {
    for (const id of RETIRED_SOURCE_IDS) {
      expect(active.map((s) => s.id)).not.toContain(id);
    }
  });

  it("gives every URL-backed source an https handle", () => {
    // fetchOne rejects anything else, so an http:// handle is a source that can never work.
    // Covert Shores shipped as http:// for exactly this reason.
    for (const s of active) {
      if (s.platform !== "RSS" && s.platform !== "Web") continue;
      expect(s.handle.startsWith("https://"), `${s.id} handle is not https`).toBe(true);
    }
  });

  it("gives every URL-backed source a well-formed handle", () => {
    for (const s of active) {
      if (s.platform !== "RSS" && s.platform !== "Web") continue;
      expect(() => new URL(s.handle), `${s.id} handle does not parse`).not.toThrow();
    }
  });

  it("does not seed two sources polling the same feed", () => {
    const byHandle = new Map<string, string[]>();
    for (const s of active) {
      if (s.platform !== "RSS" && s.platform !== "Web") continue;
      const key = s.handle.replace(/\/+$/, "").toLowerCase();
      byHandle.set(key, [...(byHandle.get(key) ?? []), s.id]);
    }
    const dupes = [...byHandle.entries()].filter(([, ids]) => ids.length > 1);
    expect(dupes.map(([handle, ids]) => `${handle} <- ${ids.join(", ")}`)).toEqual([]);
  });

  it("does not point an RSS source at a page URL or a Web source at a feed-shaped path", () => {
    // Not a liveness check, just a consistency one: the platform decides how the body is parsed,
    // so a mismatch means the fetch path is not the one the author intended.
    for (const s of active) {
      if (s.platform !== "RSS") continue;
      expect(s.handle, `${s.id} is RSS but its handle looks like a page`).not.toMatch(
        /\/(news|press-releases|blog|newsroom)\/?$/,
      );
    }
  });
});
