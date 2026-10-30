import { describe, expect, it } from "vitest";
import {
  FAILURES_BEFORE_PAUSE,
  PAUSE_MS,
  SILENT_RUNS,
  healthAfterFetch,
  isCollectable,
  platformDrift,
  reenable,
  silenceNotice,
} from "@/entities/source/health";
import { AGE_OUT_MS, autoTriage } from "@/shared/infra/ingest/auto-triage";
import { MAX_WEIGHT, MIN_WEIGHT } from "@/entities/source/outlet-record";
import { phoneticKey } from "@/entities/drone/name-key";
import { buildBriefing } from "@/features/briefing/briefing-data";
import { ProviderOutageError, type Adjudicator } from "@/shared/contracts/ai";
import type { MonitoredSource } from "@/entities/source/types";
import type { RawDispatch } from "@/entities/dispatch/types";
import type { Candidate, Drone, Extraction } from "@/entities/drone/types";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("source health", () => {
  const source = (over: Partial<MonitoredSource> = {}): MonitoredSource => ({
    id: "s",
    name: "Site",
    platform: "Web",
    handle: "https://example.com",
    domain: "Air",
    notes: "",
    ...over,
  });
  /** Apply a run of fetch results the way collection does. */
  const run = (s: MonitoredSource, results: (string | undefined)[], start = NOW) =>
    results.reduce(
      (cur, err, i) => ({ ...cur, ...healthAfterFetch(cur, err, start + i * 600_000) }),
      s,
    );

  it("pauses after three failures in a row, for seven days", () => {
    const s = run(source(), ["HTTP 403", "HTTP 403", "HTTP 403"]);
    expect(s.pausedUntil).toBe(iso(NOW + 2 * 600_000 + PAUSE_MS));
    expect(s.pausedOnce).toBe(true);
    expect(isCollectable(s, NOW + DAY)).toBe(false);
    // The pause ends on its own.
    expect(isCollectable(s, NOW + PAUSE_MS + DAY)).toBe(true);
  });

  it("does not pause on failures separated by a success", () => {
    const s = run(source(), ["HTTP 500", "HTTP 500", undefined, "HTTP 500", "HTTP 500"]);
    expect(s.pausedUntil).toBeUndefined();
    expect(s.failStreak).toBe(2);
  });

  it("turns a source off when it keeps failing after its pause", () => {
    const paused = run(source(), Array(FAILURES_BEFORE_PAUSE).fill("HTTP 403"));
    const after = run(paused, Array(FAILURES_BEFORE_PAUSE).fill("HTTP 403"), NOW + PAUSE_MS + DAY);
    expect(after.autoSync).toBe(false);
    expect(after.disabledReason).toContain("still failing after a 7-day pause (HTTP 403)");
    expect(isCollectable(after, NOW + 30 * DAY)).toBe(false);
  });

  it("clears the record when a paused source recovers, so a later failure starts over", () => {
    const paused = run(source(), Array(FAILURES_BEFORE_PAUSE).fill("timeout"));
    const recovered = run(paused, [undefined], NOW + PAUSE_MS + DAY);
    expect(recovered).toMatchObject({ failStreak: 0, pausedOnce: false });
    expect(recovered.pausedUntil).toBeUndefined();
  });

  it("starts a re-enabled source clean", () => {
    expect(reenable()).toMatchObject({ autoSync: true, failStreak: 0, pausedOnce: false });
  });

  /** Apply runs the way collection does, with the post count each fetch returned. */
  const runFetched = (
    s: MonitoredSource,
    results: (string | undefined)[],
    fetched: number[],
    start = NOW,
  ) =>
    results.reduce(
      (cur, err, i) => ({
        ...cur,
        ...healthAfterFetch(cur, err, start + i * 600_000, fetched[i] ?? 0),
      }),
      s,
    );

  it("counts a 200-with-no-posts fetch as silence, never as a failure", () => {
    // A feed that publishes once a week is legally empty on 97% of the cron's ticks, so
    // silence must not feed the pause machinery - a wrong pause costs a week of intel.
    const s = runFetched(source(), Array(SILENT_RUNS + 4).fill(undefined), Array(40).fill(0));
    expect(s.emptyStreak).toBe(SILENT_RUNS + 4);
    expect(s.failStreak).toBe(0);
    expect(s.pausedUntil).toBeUndefined();
    expect(s.autoSync).not.toBe(false);
    expect(silenceNotice(s)).toContain(`${SILENT_RUNS + 4} fetches`);
  });

  it("clears the streak and stamps the parser proof on a run that returns posts", () => {
    const s = runFetched(source(), [undefined, undefined, undefined], [0, 0, 7], NOW);
    expect(s.emptyStreak).toBe(0);
    expect(s.lastPostAt).toBe(iso(NOW + 2 * 600_000));
    expect(silenceNotice(s)).toBeNull();
  });

  it("leaves the silence streak alone when the fetch errored", () => {
    // An erroring host is the fail streak's business; the silence streak measures the parser,
    // and an errored fetch says nothing about it.
    const s = runFetched(source(), [undefined, undefined, "HTTP 403"], [0, 0, 0]);
    expect(s.emptyStreak).toBe(2);
    expect(s.failStreak).toBe(1);
  });

  it("says nothing about a source inside the silence bounds", () => {
    const s = runFetched(source(), Array(SILENT_RUNS - 1).fill(undefined), Array(40).fill(0));
    expect(silenceNotice(s)).toBeNull();
  });
});

describe("platformDrift", () => {
  const input = (platform: string, fetched: number, hoursAgo = 0) => ({
    platform,
    fetched,
    lastPostAt: iso(NOW - hoursAgo * 3_600_000),
  });

  it("reports a platform whose proven sources all came back empty", () => {
    // The signal a per-source check cannot see: one silent source reads as a quiet day, four
    // on one platform in the same run is a parser change.
    const msgs = platformDrift(
      [input("Telegram", 0), input("Telegram", 0), input("Telegram", 0), input("Telegram", 0)],
      NOW,
    );
    expect(msgs).toEqual(["4 of 4 Telegram sources returned no posts"]);
  });

  it("stays quiet when most of the platform still parses", () => {
    const msgs = platformDrift([
      input("Telegram", 0),
      input("Telegram", 0),
      input("Telegram", 5),
      input("Telegram", 3),
    ]);
    expect(msgs).toEqual([]);
  });

  it("ignores sources without a recent yield to drift from", () => {
    const stale = platformDrift(Array(4).fill(input("Telegram", 0, 8 * 24)));
    expect(stale).toEqual([]);
    const never = platformDrift([
      { platform: "RSS", fetched: 0 },
      { platform: "RSS", fetched: 0 },
      { platform: "RSS", fetched: 0 },
      { platform: "RSS", fetched: 0 },
    ]);
    expect(never).toEqual([]);
  });

  it("needs a quorum before calling a platform broken", () => {
    const msgs = platformDrift([input("RSS", 0), input("RSS", 0), input("RSS", 0)]);
    expect(msgs).toEqual([]);
  });
});

const drone = (id: string, over: Partial<Drone> = {}): Drone => ({
  id,
  name: id,
  aliases: [],
  domain: "Air",
  origin: "UA",
  operators: [],
  propulsion: "Unknown",
  summary: "",
  specs: [],
  rf: [],
  components: [],
  evolution: [],
  counterpartIds: [],
  createdAt: iso(NOW - 30 * DAY),
  updatedAt: iso(NOW - 30 * DAY),
  ...over,
});

const extraction = (over: Partial<Extraction> = {}): Extraction => ({
  aliases: [],
  operators: [],
  specs: [],
  rfBands: [],
  confidence: 0.6,
  rationale: "",
  metadata: { schemaVersion: 2, engine: "combined", analyzedAt: "" },
  ...over,
});

const candidate = (id: string, source: string, over: Partial<Candidate> = {}): Candidate => ({
  id,
  raw: "report",
  source: `${source} · https://example.com/${id}`,
  createdAt: iso(NOW - DAY),
  tier: 2,
  extraction: extraction({ name: "Vampire" }),
  status: "pending",
  ...over,
});

function deps(drones: Drone[], candidates: Candidate[]) {
  const ds = [...drones];
  const cs = [...candidates];
  return {
    drones: {
      list: () => ds,
      get: (id: string) => ds.find((d) => d.id === id),
      search: () => ds,
      remove: () => {},
      upsert: (d: Drone) => {
        const i = ds.findIndex((x) => x.id === d.id);
        if (i >= 0) ds[i] = d;
        else ds.push(d);
      },
    },
    candidates: {
      list: () => cs,
      add: (c: Candidate) => void cs.push(c),
      update: (id: string, patch: Partial<Candidate>) => {
        const i = cs.findIndex((c) => c.id === id);
        if (i >= 0) cs[i] = { ...cs[i]!, ...patch };
      },
      remove: () => {},
    },
  };
}

describe("autoTriage: corroboration", () => {
  it("promotes a name reported by two independent outlets and merges the rest into it", async () => {
    const d = deps(
      [],
      [
        candidate("a", "Militarnyi", {
          extraction: extraction({ name: "Vampire", confidence: 0.7 }),
        }),
        candidate("b", "Defense Express", {
          extraction: extraction({ name: "Вампир", confidence: 0.6 }),
        }),
      ],
    );
    const rep = await autoTriage(d, { now: NOW });
    expect(rep.corroborated).toBe(1);
    expect(d.drones.list().map((x) => x.name)).toEqual(["Vampire"]);
    expect(d.candidates.list().map((c) => [c.status, c.resolvedBy])).toEqual([
      ["promoted", "auto"],
      ["merged", "auto"],
    ]);
  });

  it("merges into the catalog entry when one exists by then", async () => {
    const d = deps(
      [drone("vampire", { name: "Vampire" })],
      [candidate("a", "Militarnyi"), candidate("b", "Defense Express")],
    );
    await autoTriage(d, { now: NOW });
    expect(d.drones.list()).toHaveLength(1);
    expect(d.candidates.list().every((c) => c.status === "merged")).toBe(true);
  });

  it("does not promote on two outlets whose reporting never pays off", async () => {
    // Both feeds store plenty and produce nothing drone-related. The archive says both are
    // noise, so their agreement is one name repeated twice, not corroboration.
    const weights = new Map([
      [phoneticKey("Copypasta"), MIN_WEIGHT],
      [phoneticKey("Repost Central"), MIN_WEIGHT],
    ]);
    const d = deps(
      [],
      [
        candidate("a", "Copypasta", {
          extraction: extraction({ name: "Vampire", confidence: 0.7 }),
        }),
        candidate("b", "Repost Central", {
          extraction: extraction({ name: "Vampire", confidence: 0.6 }),
        }),
      ],
    );
    const rep = await autoTriage(d, { now: NOW, outletWeights: weights });
    expect(rep.corroborated).toBe(0);
    expect(d.drones.list()).toEqual([]);
    // Not resolved either: the candidates stay in the queue for the analyst.
    expect(d.candidates.list().every((c) => c.status === "pending")).toBe(true);
  });

  it("promotes on a proven outlet plus one with no record yet", async () => {
    const weights = new Map([[phoneticKey("Militarnyi"), MAX_WEIGHT]]);
    const d = deps(
      [],
      [
        candidate("a", "Militarnyi", {
          extraction: extraction({ name: "Vampire", confidence: 0.7 }),
        }),
        candidate("b", "Defense Express", {
          extraction: extraction({ name: "Vampire", confidence: 0.6 }),
        }),
      ],
    );
    const rep = await autoTriage(d, { now: NOW, outletWeights: weights });
    expect(rep.corroborated).toBe(1);
    expect(d.drones.list().map((x) => x.name)).toEqual(["Vampire"]);
  });

  it("does not promote a name the pipeline discarded from three outlets", async () => {
    // The same wrong name extracted from three different feeds is a false-positive pattern
    // repeating, so it is learned as a negative instead of being queued again next run.
    const thrash = (id: string, source: string) =>
      candidate(id, source, {
        status: "discarded",
        resolvedBy: "auto",
        extraction: extraction({ name: "Vampire", confidence: 0.3 }),
      });
    const d = deps(
      [],
      [
        candidate("a", "Militarnyi", {
          extraction: extraction({ name: "Vampire", confidence: 0.7 }),
        }),
        candidate("b", "Defense Express", {
          extraction: extraction({ name: "Vampire", confidence: 0.6 }),
        }),
        thrash("c", "Copypasta"),
        thrash("d", "Repost Central"),
        thrash("e", "Aggregator"),
      ],
    );
    const rep = await autoTriage(d, { now: NOW });
    expect(rep.corroborated).toBe(0);
    expect(d.drones.list()).toEqual([]);
  });

  it("does not learn a negative from the same outlet discarding twice", async () => {
    // Two runs of one noisy feed is one mistake, not a pattern.
    const twice = (id: string) =>
      candidate(id, "Copypasta", {
        status: "discarded",
        resolvedBy: "auto",
        extraction: extraction({ name: "Vampire", confidence: 0.3 }),
      });
    const d = deps(
      [],
      [
        candidate("a", "Militarnyi", {
          extraction: extraction({ name: "Vampire", confidence: 0.7 }),
        }),
        candidate("b", "Defense Express", {
          extraction: extraction({ name: "Vampire", confidence: 0.6 }),
        }),
        twice("c"),
        twice("d"),
      ],
    );
    const rep = await autoTriage(d, { now: NOW });
    expect(rep.corroborated).toBe(1);
  });

  it.each([
    ["one outlet twice", [candidate("a", "Militarnyi"), candidate("b", "Militarnyi (RSS)")]],
    [
      "a heuristic-only report",
      [
        candidate("a", "Militarnyi"),
        candidate("b", "Defense Express", {
          extraction: extraction({
            name: "Vampire",
            metadata: { schemaVersion: 2, engine: "heuristic", analyzedAt: "" },
          }),
        }),
      ],
    ],
    [
      "an organisation name",
      [
        candidate("a", "Militarnyi", { extraction: extraction({ name: "Azov Brigade" }) }),
        candidate("b", "Defense Express", { extraction: extraction({ name: "Azov Brigade" }) }),
      ],
    ],
  ])("does not promote on %s", async (_label, cands) => {
    const d = deps([], cands);
    await autoTriage(d, { now: NOW });
    expect(d.drones.list()).toEqual([]);
  });

  it("respects an analyst's earlier rejection of the name", async () => {
    const d = deps(
      [],
      [
        candidate("old", "X", { status: "discarded", resolvedBy: "analyst" }),
        candidate("a", "Militarnyi"),
        candidate("b", "Defense Express"),
      ],
    );
    await autoTriage(d, { now: NOW });
    expect(d.drones.list()).toEqual([]);
  });
});

describe("autoTriage: adjudication", () => {
  const borderline = () =>
    deps(
      [drone("lancet-3", { name: "Lancet-3" })],
      [
        candidate("a", "Rybar", {
          extraction: extraction({ name: "Lancet", matchId: "lancet-3" }),
        }),
      ],
    );
  const verdict =
    (same: boolean, confidence: number): Adjudicator =>
    async () => ({ same, confidence });

  it("merges on a confident yes", async () => {
    const d = borderline();
    const rep = await autoTriage(d, { now: NOW, adjudicate: verdict(true, 0.9) });
    expect(rep.adjudicatedMerged).toBe(1);
    expect(d.candidates.list()[0]).toMatchObject({ status: "merged", resolvedBy: "auto" });
  });

  it("releases the match on a confident no, and records why", async () => {
    const d = borderline();
    await autoTriage(d, { now: NOW, adjudicate: verdict(false, 0.95) });
    const c = d.candidates.list()[0]!;
    expect(c.status).toBe("pending");
    expect(c.extraction.matchId).toBeUndefined();
    expect(c.extraction.rationale).toContain("not Lancet-3");
  });

  it("leaves an unsure verdict for the analyst, and asks only once", async () => {
    const d = borderline();
    let calls = 0;
    const unsure: Adjudicator = async () => (calls++, { same: true, confidence: 0.5 });
    await autoTriage(d, { now: NOW, adjudicate: unsure });
    await autoTriage(d, { now: NOW, adjudicate: unsure });
    expect(calls).toBe(1);
    expect(d.candidates.list()[0]!.status).toBe("pending");
  });

  it("stops at a provider outage without marking the candidate asked", async () => {
    const d = borderline();
    const rep = await autoTriage(d, {
      now: NOW,
      adjudicate: async () => {
        throw new ProviderOutageError("All providers unavailable.");
      },
    });
    expect(rep.stopReason).toContain("unavailable");
    expect(d.candidates.list()[0]!.adjudicatedAt).toBeUndefined();
  });
});

describe("autoTriage: age-out", () => {
  it("discards an old low-confidence candidate and keeps a confident or recent one", async () => {
    const old = iso(NOW - AGE_OUT_MS - DAY);
    const d = deps(
      [],
      [
        candidate("weak-old", "A", {
          createdAt: old,
          extraction: extraction({ name: "Foo", confidence: 0.2 }),
        }),
        candidate("strong-old", "A", {
          createdAt: old,
          extraction: extraction({ name: "Bar", confidence: 0.7 }),
        }),
        candidate("weak-new", "A", { extraction: extraction({ name: "Baz", confidence: 0.2 }) }),
      ],
    );
    const rep = await autoTriage(d, { now: NOW });
    expect(rep.agedOut).toBe(1);
    expect(d.candidates.list().map((c) => c.status)).toEqual(["discarded", "pending", "pending"]);
    expect(d.candidates.list()[0]!.resolvedBy).toBe("auto");
  });
});

describe("buildBriefing", () => {
  const post = (id: string, outlet: string, droneIds: string[], daysAgo = 1): RawDispatch => ({
    id,
    sourceId: outlet,
    sourceName: outlet,
    externalId: id,
    url: `https://example.com/${id}`,
    text: `Report ${id} about ${droneIds.join(" and ")}.`,
    createdAt: iso(NOW - daysAgo * DAY),
    publishedAt: iso(NOW - daysAgo * DAY),
    status: "processed",
    droneIds,
  });

  const imported = drone("orion", {
    name: "Orion",
    createdAt: iso(NOW - DAY),
    evolution: [
      {
        date: iso(NOW - DAY),
        kind: "other",
        description: "Imported from Wikipedia (Orion)",
        source: "https://en.wikipedia.org/wiki/Orion",
      },
    ],
    specs: [
      {
        key: "range",
        label: "Range",
        discoveredBy: "seed",
        claims: [
          {
            value: "250 km",
            source: "https://en.wikipedia.org/wiki/Orion",
            date: iso(NOW - DAY),
            extractionEngine: "reference",
          },
        ],
      },
    ],
  });
  const promoted = drone("vampire", {
    name: "Vampire",
    createdAt: iso(NOW - 2 * DAY),
    evolution: [
      {
        date: iso(NOW - 2 * DAY),
        kind: "other",
        description: "Promoted from intake queue",
        source: "Militarnyi",
      },
    ],
    specs: [
      {
        key: "payload",
        label: "Payload",
        discoveredBy: "ai",
        claims: [
          { value: "15 kg", source: "Militarnyi · https://m.example", date: iso(NOW - 2 * DAY) },
        ],
      },
    ],
  });
  const lancet = drone("lancet-3", { name: "Lancet-3" });

  const brief = buildBriefing(
    [imported, promoted, lancet],
    [
      post("p1", "Rybar", ["lancet-3"]),
      post("p2", "Militarnyi", ["lancet-3", "vampire"]),
      post("p3", "Rybar", ["lancet-3"]),
      post("old", "Rybar", ["lancet-3"], 10),
    ],
    NOW,
  );

  it("ranks systems by outlets, then reports, within the week", () => {
    expect(brief.reported.map((r) => [r.drone.id, r.posts, r.outlets.length])).toEqual([
      ["lancet-3", 3, 2],
      ["vampire", 1, 1],
    ]);
  });

  it("leaves the reference import out of new systems, claims and history", () => {
    expect(brief.newSystems.map((d) => d.id)).toEqual(["vampire"]);
    expect(brief.newClaims.map((n) => n.drone.id)).toEqual(["vampire"]);
    expect(brief.drift.map((e) => e.drone.id)).toEqual(["vampire"]);
    expect(brief.context).not.toContain("Orion");
  });

  it("gives the summary reporting to work from", () => {
    expect(brief.context).toContain("Lancet-3 (3 reports, 2 outlets)");
    expect(brief.context).toContain("Vampire Payload: 15 kg (Militarnyi)");
    expect(brief.context).toContain("Report p2 about lancet-3 and vampire.");
  });
});
