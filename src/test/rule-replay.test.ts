import { afterEach, describe, expect, it, vi } from "vitest";
import { recordAutonomyEvent } from "@/shared/infra/autonomy/ledger.server";
import { replayRule, REPLAY_MAX_POSTS } from "@/shared/infra/evaluation/rule-sandbox-replay.server";

// Keep the database out of it: the switch-off path must return before any query.
vi.mock("@/shared/infra/postgres/db.server", () => ({
  dbConfigured: () => true,
  db: () => {
    throw new Error("database touched while rule replay is switched off");
  },
}));
vi.mock("@/shared/infra/autonomy/ledger.server", () => ({
  recordAutonomyEvent: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("rule replay switch", () => {
  it("changes nothing and writes no ledger event when switched off", async () => {
    vi.stubEnv("RULE_REPLAY", "off");
    const result = await replayRule("rule-1");
    expect(result).toEqual({ claims: 0, requeued: [], skipped: "switched off or no database" });
    expect(recordAutonomyEvent).not.toHaveBeenCalled();
  });

  it("caps the posts one quarantine may hand back", () => {
    expect(REPLAY_MAX_POSTS).toBe(200);
  });
});
