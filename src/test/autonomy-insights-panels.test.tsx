import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { VerifierControlsStatus } from "@/shared/contracts/verification";
import type { SourceFetchHealth } from "@/shared/contracts/autonomy-insights";
import type { Drone } from "@/entities/drone/types";
import { VerifierControlsPanel } from "@/features/autonomy/verifier-controls-panel";
import { PromptVersionPanel } from "@/features/autonomy/prompt-version-panel";
import { SourceHealthPanel } from "@/features/autonomy/source-health-panel";
import { eventLabel } from "@/features/autonomy/event-labels";

/**
 * The three panels on the Autonomy page render from the services and the store they are given.
 * Each is tested with a fake service set, the way settings-providers.test.tsx does it.
 */

let mockServices: { autonomyInsights: unknown };
let mockDrones: Drone[] = [];
let mockSources: { id: string; name: string }[] = [];

vi.mock("@/shared/infra/use-services", () => ({
  useServices: () => mockServices,
  useDrones: () => mockDrones,
  useSources: () => mockSources,
  useAttached: () => true,
}));

afterEach(() => {
  cleanup();
  mockDrones = [];
  mockSources = [];
});

const controlsStatus = (over: Partial<VerifierControlsStatus> = {}): VerifierControlsStatus => ({
  summary: { asked: 0, supported: 0, unsupported: 0, uncertain: 0, falseSupportBound: 0 },
  strata: [],
  ...over,
});

describe("Second reader on injected errors", () => {
  it("says no controls were asked when none have run", async () => {
    mockServices = {
      autonomyInsights: { controls: async () => controlsStatus(), sourceHealth: async () => [] },
    };
    render(<VerifierControlsPanel />);
    expect(
      await screen.findByText("No controls asked yet. The job runs hourly."),
    ).toBeInTheDocument();
  });

  it("marks an over-budget stratum and shows its bound as a percentage", async () => {
    mockServices = {
      autonomyInsights: {
        controls: async () =>
          controlsStatus({
            summary: {
              asked: 40,
              supported: 5,
              unsupported: 30,
              uncertain: 5,
              falseSupportBound: 0.12,
            },
            strata: [
              {
                family: "Radar",
                language: "en",
                asked: 40,
                supported: 5,
                unsupported: 30,
                uncertain: 5,
                falseSupportBound: 0.12,
                status: "over",
              },
            ],
          }),
        sourceHealth: async () => [],
      },
    };
    render(<VerifierControlsPanel />);
    const table = within(await screen.findByRole("table", { name: "Second reader strata" }));
    expect(table.getByText("Over budget")).toBeInTheDocument();
    expect(table.getByText("Radar")).toBeInTheDocument();
    expect(table.getByText("12.0%")).toBeInTheDocument();
    expect(screen.getByText("Upper bound")).toBeInTheDocument();
    expect(screen.getByText("against a 5% budget")).toBeInTheDocument();
  });
});

describe("Verified share by prompt version", () => {
  it("says so when there are no claims", () => {
    render(<PromptVersionPanel />);
    expect(screen.getByText("No machine-extracted claims yet.")).toBeInTheDocument();
  });

  it("shows each version's share of its claims, and unknown lineage as unknown", () => {
    const claim = (state?: "verified" | "rejected", promptVersion?: string) => ({
      value: "10 kg",
      source: "Feed",
      ...(promptVersion ? { lineage: { promptVersion } } : {}),
      ...(state ? { verification: { state, checks: [] } } : {}),
    });
    mockDrones = [
      {
        id: "d1",
        name: "Alpha",
        specs: [
          {
            key: "mass",
            label: "Mass",
            claims: [claim("verified", "v3"), claim("rejected", "v3")],
          },
          { key: "range", label: "Range", claims: [claim("verified")] },
        ],
      },
    ] as unknown as Drone[];

    render(<PromptVersionPanel />);
    const table = within(screen.getByRole("table", { name: "Verified share by prompt version" }));
    expect(table.getByText("v3")).toBeInTheDocument();
    expect(table.getByText("unknown")).toBeInTheDocument();
    // v3: two claims, one verified and one rejected.
    const v3 = table.getByText("v3").closest("tr") as HTMLElement;
    // Verified and rejected are each one of two claims.
    expect(within(v3).getAllByText("50%")).toHaveLength(2);
  });
});

describe("Source fetch health", () => {
  it("says every source fetched cleanly when none is flagged", async () => {
    mockServices = {
      autonomyInsights: {
        controls: async () => controlsStatus(),
        sourceHealth: async () => [
          { sourceId: "s1", fetches: 100, failures: 0, fetched: 40, relevant: 3 },
        ],
      },
    };
    render(<SourceHealthPanel />);
    expect(await screen.findByText("Every source fetched without trouble.")).toBeInTheDocument();
  });

  it("lists failing sources first, names them, and falls back to the id", async () => {
    mockSources = [
      { id: "s1", name: "Alpha Feed" },
      { id: "s2", name: "Beta Feed" },
    ];
    const health: SourceFetchHealth[] = [
      { sourceId: "s2", fetches: 50, failures: 1, fetched: 9, relevant: 2, drift: "quiet" },
      {
        sourceId: "s1",
        fetches: 50,
        failures: 12,
        fetched: 0,
        relevant: 0,
        drift: "failing",
        lastError: "HTTP 503",
        lastOkAt: "2026-11-01T08:30:00.000Z",
      },
      { sourceId: "s9", fetches: 4, failures: 2, fetched: 0, relevant: 0 },
      { sourceId: "clean", fetches: 10, failures: 0, fetched: 5, relevant: 1 },
    ];
    mockServices = {
      autonomyInsights: {
        controls: async () => controlsStatus(),
        sourceHealth: async () => health,
      },
    };
    render(<SourceHealthPanel />);
    const table = within(await screen.findByRole("table", { name: "Source fetch health" }));
    const rows = table.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Alpha Feed");
    expect(rows[0]).toHaveTextContent("Failing");
    expect(rows[0]).toHaveTextContent("HTTP 503");
    expect(rows[0]).toHaveTextContent("2026-11-01 08:30");
    expect(rows[1]).toHaveTextContent("Beta Feed");
    expect(rows[1]).toHaveTextContent("Quiet");
    // No drift flag, but failures: after the flagged ones, under the id it could not resolve.
    expect(rows[2]).toHaveTextContent("s9");
    expect(rows[2]).toHaveTextContent("Unsteady");
    expect(table.queryByText("clean")).toBeNull();
  });

  it("leaves out a source with a stray failure and no drift flag", async () => {
    mockServices = {
      autonomyInsights: {
        controls: async () => controlsStatus(),
        sourceHealth: async () => [
          { sourceId: "s1", fetches: 4000, failures: 3, fetched: 900, relevant: 0 },
        ],
      },
    };
    render(<SourceHealthPanel />);
    expect(await screen.findByText("Every source fetched without trouble.")).toBeInTheDocument();
  });
});

describe("Decision ledger labels", () => {
  it("shows a known kind as its label", () => {
    expect(eventLabel("verification_run")).toBe("Verification run");
    expect(eventLabel("rule_probation_started")).toBe("Rule back on probation");
  });

  it("shows an unknown kind as the raw kind", () => {
    expect(eventLabel("some_future_kind")).toBe("some_future_kind");
  });
});
