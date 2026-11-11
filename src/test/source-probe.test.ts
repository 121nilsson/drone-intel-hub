import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FAILURES_BEFORE_PAUSE,
  MAX_PROBES,
  PROBE_EVERY_MS,
  afterProbe,
  healthAfterFetch,
  probeDue,
  reenable,
} from "@/entities/source/health";
import {
  PROBES_PER_RUN,
  runSourceProbes,
  type ProbeDeps,
} from "@/shared/infra/sources/fetch-posts.server";
import type { MonitoredSource } from "@/entities/source/types";
import type { DispatchRepository } from "@/shared/contracts/repository";
import type { Fetcher } from "@/shared/infra/ingest/collect";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

afterEach(() => vi.unstubAllEnvs());

const source = (over: Partial<MonitoredSource> = {}): MonitoredSource => ({
  id: "s",
  name: "Site",
  platform: "Web",
  handle: "https://example.com",
  domain: "Air",
  notes: "",
  ...over,
});

/** A source the system turned off, the way healthAfterFetch leaves it after a long outage. */
const systemOff = (over: Partial<MonitoredSource> = {}): MonitoredSource =>
  source({
    autoSync: false,
    disabledReason: `Turned off 2026-10-01: still failing after a 7-day pause (HTTP 403)`,
    ...over,
  });

describe("probeDue", () => {
  it("is due for a system-disabled source that was never probed", () => {
    expect(probeDue(systemOff(), NOW)).toBe(true);
  });

  it("is not due again within seven days of the last probe", () => {
    const s = systemOff({ lastProbeAt: iso(NOW - (PROBE_EVERY_MS - DAY)) });
    expect(probeDue(s, NOW)).toBe(false);
  });

  it("is due again once seven days have passed since the last probe", () => {
    const s = systemOff({ lastProbeAt: iso(NOW - PROBE_EVERY_MS) });
    expect(probeDue(s, NOW)).toBe(true);
  });

  it("is not due once eight probes have failed; a person takes it from there", () => {
    expect(MAX_PROBES).toBe(8);
    expect(probeDue(systemOff({ probes: MAX_PROBES - 1 }), NOW)).toBe(true);
    expect(probeDue(systemOff({ probes: MAX_PROBES }), NOW)).toBe(false);
  });

  it("is not due for a source an analyst turned off, which carries no system reason", () => {
    expect(probeDue(source({ autoSync: false }), NOW)).toBe(false);
  });

  it("is not due for a source an analyst turned off after the system had turned it on and off", () => {
    // The analyst's turn-on clears the system reason (reenable), so their later turn-off is theirs.
    const reenabled = { ...systemOff(), ...reenable() };
    const analystOff = { ...reenabled, autoSync: false, pausedUntil: undefined };
    expect(probeDue(analystOff, NOW)).toBe(false);
  });

  it("is not due for an enabled source or a merely paused one", () => {
    expect(probeDue(source({ autoSync: true }), NOW)).toBe(false);
    const paused = source({ pausedUntil: iso(NOW + DAY), disabledReason: "old" });
    expect(probeDue(paused, NOW)).toBe(false);
  });

  it("is due for a system-disabled source after the real health code turned it off", () => {
    // Build the state the way collection does: a pause, then three more failures.
    let s = source();
    for (let i = 0; i < FAILURES_BEFORE_PAUSE * 2; i++)
      s = { ...s, ...healthAfterFetch(s, "HTTP 403", NOW + i * 3_600_000) };
    expect(s.autoSync).toBe(false);
    expect(probeDue(s, NOW + DAY)).toBe(true);
  });
});

describe("afterProbe", () => {
  it("on success re-enables the source as reenable() does, and clears the probe record", () => {
    const patch = afterProbe(
      systemOff({ probes: 3, lastProbeAt: iso(NOW - PROBE_EVERY_MS) }),
      true,
      NOW,
    );
    expect(patch).toMatchObject({
      autoSync: true,
      failStreak: 0,
      pausedOnce: false,
      emptyStreak: 0,
      disabledReason: undefined,
      lastProbeAt: undefined,
      probes: 0,
    });
    expect(patch).toEqual({ ...reenable(), lastProbeAt: undefined, probes: 0 });
  });

  it("on failure counts the probe and stamps when it ran, leaving the source off", () => {
    const patch = afterProbe(systemOff({ probes: 2 }), false, NOW);
    expect(patch).toEqual({ lastProbeAt: iso(NOW), probes: 3 });
    expect(patch).not.toHaveProperty("autoSync");
  });

  it("counts the first failed probe from zero", () => {
    expect(afterProbe(systemOff(), false, NOW)).toEqual({ lastProbeAt: iso(NOW), probes: 1 });
  });
});

describe("runSourceProbes", () => {
  /** A list the probe can read and update, with the rest of the store stubbed out. */
  function harness(list: MonitoredSource[]) {
    const sources = list.slice();
    const deps = {
      sources: {
        list: () => sources,
        update: (id: string, patch: Partial<MonitoredSource>) => {
          const i = sources.findIndex((s) => s.id === id);
          sources[i] = { ...sources[i]!, ...patch };
        },
      },
      dispatches: {
        list: () => [],
        has: () => false,
        add: () => true,
        update: () => {},
        pending: () => [],
      } as unknown as DispatchRepository,
      fetcher: vi.fn<Fetcher>(async () => ({
        ok: true as const,
        posts: [
          {
            id: "p1",
            text: "A drone strike report long enough to be stored as a dispatch.",
            url: "https://example.com/p1",
          },
        ],
      })),
      record: vi.fn(async () => {}),
      recordEvent: vi.fn(async () => {}),
    };
    const byId = (id: string) => sources.find((s) => s.id === id)!;
    return { deps: deps as ProbeDeps & typeof deps, sources, byId };
  }

  it("does not fetch anything when the source_probe switch is off", async () => {
    vi.stubEnv("SOURCE_PROBE", "off");
    const h = harness([systemOff()]);
    expect(await runSourceProbes(h.deps, NOW)).toBe(0);
    expect(h.deps.fetcher).not.toHaveBeenCalled();
    expect(h.byId("s").autoSync).toBe(false);
    expect(h.deps.recordEvent).not.toHaveBeenCalled();
  });

  it("probes at most PROBES_PER_RUN due sources and never an X source", async () => {
    expect(PROBES_PER_RUN).toBe(2);
    const h = harness([
      systemOff({ id: "a" }),
      systemOff({ id: "b" }),
      systemOff({ id: "c" }),
      systemOff({ id: "x", platform: "X", handle: "@someone" }),
    ]);
    expect(await runSourceProbes(h.deps, NOW)).toBe(2);
    expect(h.deps.fetcher).toHaveBeenCalledTimes(2);
    const probed = h.deps.fetcher.mock.calls.map((c) => (c[0] as MonitoredSource).id);
    expect(probed).toEqual(["a", "b"]);
    expect(probed).not.toContain("x");
  });

  it("re-enables a source whose probe finds posts, and writes one ledger event for it", async () => {
    const h = harness([systemOff()]);
    await runSourceProbes(h.deps, NOW);
    expect(h.byId("s")).toMatchObject({ autoSync: true, probes: 0, lastPostAt: iso(NOW) });
    expect(h.byId("s").disabledReason).toBeUndefined();
    expect(h.deps.recordEvent).toHaveBeenCalledTimes(1);
    expect(h.deps.recordEvent).toHaveBeenCalledWith({
      action: "source_reenabled",
      actor: "sources:probe",
      actorKind: "system",
      targetCollection: "sources",
      targetId: "s",
      before: { autoSync: false, disabledReason: systemOff().disabledReason },
      after: { autoSync: true },
      reason: "weekly probe fetched 1 post(s)",
      reversible: true,
    });
    expect(h.deps.record).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: "s", ok: true, fetched: 1 }),
    );
  });

  it("counts a probe that returns no posts as a failure, with no event and the source left off", async () => {
    const h = harness([systemOff()]);
    h.deps.fetcher.mockResolvedValueOnce({ ok: true as const, posts: [] });
    await runSourceProbes(h.deps, NOW);
    expect(h.byId("s")).toMatchObject({ autoSync: false, probes: 1, lastProbeAt: iso(NOW) });
    expect(h.deps.recordEvent).not.toHaveBeenCalled();
    expect(h.deps.record).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: "probe found no posts" }),
    );
  });

  it("counts a fetch error as a failed probe and keeps the error", async () => {
    const h = harness([systemOff()]);
    h.deps.fetcher.mockResolvedValueOnce({ ok: false as const, error: "HTTP 403" });
    await runSourceProbes(h.deps, NOW);
    expect(h.byId("s")).toMatchObject({ autoSync: false, probes: 1, lastError: "HTTP 403" });
    expect(h.deps.recordEvent).not.toHaveBeenCalled();
  });

  it("counts a probe that throws as a failed one instead of retrying it every tick", async () => {
    const h = harness([systemOff()]);
    h.deps.fetcher.mockRejectedValueOnce(new Error("boom"));
    await expect(runSourceProbes(h.deps, NOW)).resolves.toBe(1);
    expect(h.byId("s")).toMatchObject({ autoSync: false, probes: 1, lastProbeAt: iso(NOW) });
    expect(h.deps.recordEvent).not.toHaveBeenCalled();
  });
});
