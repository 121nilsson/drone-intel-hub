import { describe, expect, it } from "vitest";
import { collectSource, processPending } from "@/features/sources/auto-ingest";
import { LocalDispatchRepository } from "@/shared/infra/local-repository";
import { ACTIVE_SEED_SOURCES, RETIRED_SOURCE_IDS, SEED_SOURCES } from "@/entities/source/seed";
import type { MonitoredSource } from "@/entities/source/types";
import type { Candidate, Drone, Extraction } from "@/entities/drone/types";
import type { FetchedPost } from "@/shared/infra/fetch-posts";
import type { PipelineDeps } from "@/features/intake/pipeline";

/**
 * Regression: two feeds on one host carry the same article under the same GUID and the same link
 * (measured: 9 of 10 items in bellingcat.com/news/feed/ are also in bellingcat.com/feed/).
 *
 * The dispatch key is `${sourceId}|${externalId}`, so those copies get different keys, and the
 * SimHash text dedupe is a near-match that is not guaranteed to fire. The result was one article
 * analysed twice - two candidates, two claim sources on the same spec, which is exactly what the
 * dedupe exists to prevent.
 */

const ARTICLE =
  "Ukrainian air defences downed twelve of the sixteen loitering munitions launched overnight at the Odesa region, causing rolling blackouts across three districts as transformer equipment was damaged.";

const ARTICLE_URL = "https://www.bellingcat.com/news/2026/09/16/drone-strike-civilians-killed/";

const src = (id: string, name: string): MonitoredSource => ({
  id,
  name,
  platform: "RSS",
  handle: `https://www.bellingcat.com/${id}/feed/`,
  domain: "Multi",
  notes: "",
});

const post = (over: Partial<FetchedPost> = {}): FetchedPost => ({
  id: `rss:${ARTICLE_URL}`,
  text: ARTICLE,
  url: ARTICLE_URL,
  ...over,
});

const repo = () => new LocalDispatchRepository();

function drone(): Drone {
  return {
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
  };
}

function deps(items: Drone[], cands: Candidate[]): PipelineDeps {
  const extraction: Extraction = {
    aliases: [],
    operators: [],
    specs: [{ key: "range", label: "Range", value: 2000, unit: "km" }],
    rfBands: [],
    matchId: "geran-2",
    confidence: 0.95,
    rationale: "test",
  };
  const tier1 = { tier: 1 as const, label: "scripted", extract: () => Promise.resolve(extraction) };
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

/**
 * The same article as each feed renders it.
 *
 * A site-wide feed and its category feed carry byte-identical copy today, which SimHash catches on
 * text. That is the lucky case. When one feed serves a teaser and the other the full body - which
 * `rssPosts` produces routinely, since it follows teasers up to a per-source budget - the two
 * copies differ enough in length that the near-match tolerance is a coin flip. URL identity does
 * not depend on how much text arrived, so these are the copies worth a deterministic check.
 */
const TEASER =
  "Ukrainian air defences downed twelve of the sixteen loitering munitions launched overnight. Full report available at the original source.";

describe("overlapping feeds on one host", () => {
  it("extracts one article once when two feeds carry the same link", async () => {
    const dispatches = repo();

    // Site-wide feed, full body.
    await collectSource(
      src("site", "Bellingcat"),
      async () => ({ ok: true, posts: [post()] }),
      dispatches,
    );
    // Category feed, same host, same GUID, same link, teaser body.
    const rep = await collectSource(
      src("news", "Bellingcat News"),
      async () => ({ ok: true, posts: [post({ text: TEASER })] }),
      dispatches,
    );

    expect(rep.duplicates).toBe(1);
    expect(dispatches.pending(10)).toHaveLength(1);

    const items = [drone()];
    const cands: Candidate[] = [];
    const processed = await processPending(dispatches, deps(items, cands), 20);

    expect(processed.processed).toBe(1);
    expect(cands).toHaveLength(1);
    // One claim from the article plus the seed's, not three.
    expect(items[0]!.specs[0]!.claims).toHaveLength(2);
  });

  it("does not merge the two copies into one dispatch id", async () => {
    // The archive must still record that both feeds carried the story: the duplicate stub is
    // provenance, not a deletion.
    const dispatches = repo();
    await collectSource(
      src("site", "Bellingcat"),
      async () => ({ ok: true, posts: [post()] }),
      dispatches,
    );
    await collectSource(
      src("news", "Bellingcat News"),
      async () => ({ ok: true, posts: [post()] }),
      dispatches,
    );

    expect(dispatches.list()).toHaveLength(2);
    const stub = dispatches.list().find((d) => d.status === "duplicate");
    expect(stub).toBeDefined();
    expect(stub!.sourceId).toBe("news");
    expect(stub!.text).toBe("");
  });

  it("still stores genuinely different articles from the same host", async () => {
    const dispatches = repo();
    const other =
      "Turkish authorities confirmed a second delivery of Bayraktar TB2 airframes under an export contract signed last autumn, according to a statement released by the manufacturer on Thursday afternoon.";

    await collectSource(
      src("site", "Bellingcat"),
      async () => ({
        ok: true,
        posts: [
          post(),
          post({
            id: `rss:${other}`.slice(0, 5),
            url: "https://www.bellingcat.com/news/other-story/",
            text: other,
          }),
        ],
      }),
      dispatches,
    );

    expect(dispatches.pending(10)).toHaveLength(2);
    expect(dispatches.list().every((d) => d.status === "pending")).toBe(true);
  });
});

describe("seeded feeds do not overlap", () => {
  /** Every seed source that is a URL, grouped by host, minus the per-channel Telegram ones. */
  const byHost = () => {
    const groups = new Map<string, MonitoredSource[]>();
    for (const s of SEED_SOURCES) {
      if (s.platform === "Telegram" || s.platform === "X") continue;
      let host: string;
      try {
        host = new URL(s.handle).hostname.toLowerCase().replace(/^www\./, "");
      } catch {
        continue;
      }
      // GitHub and Reddit hosts are a platform, not a publisher: each path is a distinct project
      // or subreddit with no shared articles.
      if (host === "github.com" || host === "reddit.com") continue;
      groups.set(host, [...(groups.get(host) ?? []), s]);
    }
    return groups;
  };

  it("has no two seeded RSS/Web feeds on one host that republish the same articles", () => {
    // Bellingcat's /news/ feed was a strict subset of its site-wide feed and has been removed.
    // The remaining host-mates are legitimate and must stay: Militarnyi's Web source is the
    // English index while its RSS feed is the Ukrainian one (measured: 0 shared article links),
    // and Ukrinform's main feed is disabled and, at the URL in the seed, no longer resolves.
    const overlapping = [...byHost().entries()].filter(([, sources]) => sources.length > 1);
    expect(overlapping.map(([host]) => host)).toEqual(["mil.in.ua", "ukrinform.net"]);
  });

  it("keeps the retired Bellingcat category feed out of the active seed", () => {
    // So an install that runs addMissingDefaults does not resurrect it.
    expect(RETIRED_SOURCE_IDS).toContain("bellingcat-news");
    expect(ACTIVE_SEED_SOURCES.map((s) => s.id)).not.toContain("bellingcat-news");
    expect(ACTIVE_SEED_SOURCES.map((s) => s.id)).toContain("bellingcat");
  });
});
