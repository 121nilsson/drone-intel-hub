import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  dbConfigured: vi.fn(() => true),
  db: vi.fn(() => {
    throw new Error("the database must not be touched");
  }),
  recordAutonomyEvent: vi.fn(async () => {}),
  chatCompletionOnce: vi.fn(async () => {
    throw new Error("no reader may be called");
  }),
}));

vi.mock("@/shared/infra/postgres/db.server", () => ({
  dbConfigured: hoisted.dbConfigured,
  db: hoisted.db,
}));
vi.mock("@/shared/infra/autonomy/ledger.server", () => ({
  recordAutonomyEvent: hoisted.recordAutonomyEvent,
}));
vi.mock("@/shared/infra/ai-proxy.server", () => ({
  chatCompletionOnce: hoisted.chatCompletionOnce,
}));

import type { StorageBackend } from "@/shared/contracts/backend";
import { setServerServices } from "@/shared/infra/server-services.server";
import { runVerifierControls } from "@/shared/infra/verification/controls.server";

/** A backend that has (or lacks) a SQL database, whatever the environment says. */
const backend = (sql: boolean): StorageBackend => ({
  kind: sql ? "postgres" : "none",
  capabilities: { revisions: true, sql },
  serverStorage: sql,
  documents: async () => {
    throw new Error("the document store must not be touched");
  },
  archiveCounts: async () => null,
});

beforeEach(() => {
  hoisted.dbConfigured.mockReturnValue(true);
  setServerServices({ backend: backend(true) });
});
afterEach(() => {
  setServerServices(null);
  vi.unstubAllEnvs();
  hoisted.db.mockClear();
  hoisted.recordAutonomyEvent.mockClear();
  hoisted.chatCompletionOnce.mockClear();
});

describe("verifier controls with the switch off", () => {
  it("asks no control, stores nothing and writes no ledger event", async () => {
    vi.stubEnv("AI_VERIFIER", "off");
    const r = await runVerifierControls();
    expect(r.ran).toBe(false);
    expect(r.reason).toBe("AI_VERIFIER=off");
    expect(r.asked).toBe(0);
    expect(hoisted.db).not.toHaveBeenCalled();
    expect(hoisted.chatCompletionOnce).not.toHaveBeenCalled();
    expect(hoisted.recordAutonomyEvent).not.toHaveBeenCalled();
  });

  it("does nothing without a database", async () => {
    vi.stubEnv("AI_VERIFIER", "on");
    hoisted.dbConfigured.mockReturnValue(false);
    setServerServices({ backend: backend(false) });
    const r = await runVerifierControls();
    expect(r).toMatchObject({ ran: false, reason: "no database configured", asked: 0 });
    expect(hoisted.db).not.toHaveBeenCalled();
    expect(hoisted.recordAutonomyEvent).not.toHaveBeenCalled();
  });
});
