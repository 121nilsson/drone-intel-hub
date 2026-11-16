import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  db: vi.fn(() => {
    throw new Error("the database driver must not be touched");
  }),
  recordAutonomyEvent: vi.fn(async () => {}),
  chatCompletionOnce: vi.fn(),
}));

vi.mock("@/shared/infra/postgres/db.server", () => ({
  dbConfigured: () => false,
  db: hoisted.db,
}));
vi.mock("@/shared/infra/autonomy/ledger.server", () => ({
  recordAutonomyEvent: hoisted.recordAutonomyEvent,
  recordVerificationRunEvent: vi.fn(async () => {}),
}));
vi.mock("@/shared/infra/ai-proxy.server", () => ({
  chatCompletionOnce: hoisted.chatCompletionOnce,
}));
vi.mock("@/shared/infra/ai-providers", () => ({
  getAvailableProviders: () => [{ name: "groq" }],
  getProviderModel: () => "reader-model",
}));

import { ENTAILMENT_VERSION } from "@/entities/drone/entailment";
import type { Drone, SpecClaim } from "@/entities/drone/types";
import { controlStrata, summarizeControls } from "@/entities/drone/verifier-controls";
import type { StorageBackend } from "@/shared/contracts/backend";
import type { ServerDocumentStore } from "@/shared/contracts/store";
import type {
  ControlRecord,
  PostTextRow,
  VerificationRepo,
} from "@/shared/contracts/verification-repo";
import { nullVerificationRepo } from "@/shared/infra/null-repos/verification";
import { setServerServices } from "@/shared/infra/server-services.server";
import {
  CEILING,
  runEntailment,
  tokenUsageToday,
} from "@/shared/infra/verification/entailment.server";
import {
  runVerifierControls,
  verifierControlsStatus,
} from "@/shared/infra/verification/controls.server";
import { postsFor, runServerVerification } from "@/shared/infra/verification/verify.server";

const claim = (over: Record<string, unknown> = {}): SpecClaim =>
  ({
    id: "c1",
    value: 40,
    raw: "40 km",
    source: "Reuters",
    sourceId: "p1",
    date: "2026-11-01",
    evidence: "range of 40 km",
    verification: { state: "verified", checks: [{ kind: "unit_dimension", verdict: "pass" }] },
    ...over,
  }) as unknown as SpecClaim;

const drone: Drone = {
  id: "lancet-3",
  name: "Lancet-3",
  aliases: [],
  specs: [{ key: "range", label: "Range", unit: "km", discoveredBy: "ai", claims: [claim()] }],
} as unknown as Drone;

/** A backend over an in-memory drones collection; `sql` says whether it has a database. */
const backend = (sql: boolean): StorageBackend => ({
  kind: sql ? "postgres" : "none",
  capabilities: { revisions: true, sql },
  serverStorage: sql,
  documents: async () =>
    ({
      load: async (c: string) => (c === "drones" ? [{ doc: drone, rev: 0 }] : null),
      seed: async () => {},
      put: async () => 1,
      remove: async () => {},
    }) as unknown as ServerDocumentStore,
  archiveCounts: async () => null,
});

/** An in-memory VerificationRepo that applies the same rules the SQL does. */
function fakeVerification(posts: PostTextRow[], spent = { input: 0, output: 0 }) {
  const controls: ControlRecord[] = [];
  const usage: [string, { input: number; output: number }][] = [];
  const asked: string[] = [];
  const repo: VerificationRepo = {
    postsForVerification: async () => [],
    postTexts: async (ids) => posts.filter((p) => ids.includes(p.id)),
    askedClaimIds: async (version) => {
      asked.push(version);
      return controls.filter((c) => c.entailmentVersion === version).map((c) => c.claimId);
    },
    // on conflict (claim_id, entailment_version) do nothing
    recordControl: async (c) => {
      if (
        !controls.some(
          (x) => x.claimId === c.claimId && x.entailmentVersion === c.entailmentVersion,
        )
      )
        controls.push(c);
    },
    controlVerdicts: async (version) =>
      controls
        .filter((c) => c.entailmentVersion === version)
        .map(({ verdict, family, language }) => ({ verdict, family, language })),
    usedToday: async () => spent,
    recordUsage: async (purpose, used) => {
      usage.push([purpose, used]);
    },
  };
  return { repo, controls, usage, asked };
}

const post: PostTextRow = {
  id: "p1",
  text: "The Lancet-3 has a range of 40 km according to the maker.",
  created_at: new Date("2026-11-01T10:00:00Z"),
};

beforeEach(() => {
  vi.stubEnv("AI_VERIFIER", "on");
  hoisted.chatCompletionOnce.mockResolvedValue({
    ok: true,
    content: JSON.stringify({ answers: [{ ref: "1", verdict: "contradicted" }] }),
    usage: { input: 120, output: 12 },
  });
});
afterEach(() => {
  setServerServices(null);
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("verifier controls over the VerificationRepo port", () => {
  it("asks one control per post, stores it through the port and spends tokens through it", async () => {
    const fake = fakeVerification([post]);
    setServerServices({ backend: backend(true), verification: fake.repo });

    const r = await runVerifierControls();

    expect(r).toMatchObject({ ran: true, asked: 1, unsupported: 1, supported: 0 });
    expect(fake.controls).toHaveLength(1);
    const [stored] = fake.controls;
    expect(stored).toMatchObject({
      claimId: "c1",
      droneId: "lancet-3",
      specKey: "range",
      sourceId: "p1",
      verdict: "contradicted",
      span: null,
      provider: "groq",
      model: "reader-model",
      entailmentVersion: ENTAILMENT_VERSION,
    });
    // The control shows an altered figure, never the true one.
    expect(stored!.alteredValue).not.toBe(stored!.trueValue);
    expect(fake.usage).toEqual([["controls", { input: 120, output: 12 }]]);
    expect(hoisted.recordAutonomyEvent).toHaveBeenCalledTimes(1);
    expect(hoisted.db).not.toHaveBeenCalled();

    // The same claim is not asked twice at one entailment version.
    const again = await runVerifierControls();
    expect(again).toMatchObject({ ran: true, asked: 0, reason: "no claim to control" });
    expect(fake.asked).toEqual([ENTAILMENT_VERSION, ENTAILMENT_VERSION]);
  });

  it("stops at the daily ceiling the ledger reports, before it calls a reader", async () => {
    const fake = fakeVerification([post], { input: CEILING.input, output: 0 });
    setServerServices({ backend: backend(true), verification: fake.repo });

    const r = await runVerifierControls();

    expect(r.reason).toContain("daily token ceiling reached");
    expect(r.asked).toBe(0);
    expect(hoisted.chatCompletionOnce).not.toHaveBeenCalled();
    expect(fake.controls).toEqual([]);
    expect(hoisted.recordAutonomyEvent).not.toHaveBeenCalled();
  });

  it("reports the controls' record from what the port stores for this entailment version", async () => {
    const fake = fakeVerification([post]);
    setServerServices({ backend: backend(true), verification: fake.repo });
    await runVerifierControls();

    const status = await verifierControlsStatus();

    const rows = await fake.repo.controlVerdicts(ENTAILMENT_VERSION);
    expect(status).toEqual({ summary: summarizeControls(rows), strata: controlStrata(rows) });
    expect(rows).toHaveLength(1);
  });

  it("reads today's spend through the port, against the same purposes the ceiling covers", async () => {
    const usedToday = vi.fn(async () => ({ input: 7, output: 3 }));
    setServerServices({
      backend: backend(true),
      verification: { ...fakeVerification([]).repo, usedToday },
    });

    expect(await tokenUsageToday()).toEqual({ input: 7, output: 3, ceiling: CEILING });
    expect(usedToday).toHaveBeenCalledWith(["verifier", "challenger", "controls"]);
  });

  it("hands the deterministic run the posts the port returns", async () => {
    const postsForVerification = vi.fn(async () => [
      { id: "p9", sourceName: null, url: null, text: "A post.", contentHash: "h" },
    ]);
    setServerServices({
      backend: backend(true),
      verification: { ...fakeVerification([]).repo, postsForVerification },
    });
    const pending = {
      ...drone,
      specs: [{ ...drone.specs[0]!, claims: [claim({ sourceId: "p9" })] }],
    };

    const posts = await postsFor([pending]);

    expect(postsForVerification).toHaveBeenCalledWith(["p9"], []);
    expect(posts).toEqual([
      { id: "p9", sourceName: "", url: "", text: "A post.", contentHash: "h" },
    ]);
  });
});

describe("the null adapter reproduces the old no-database behaviour", () => {
  beforeEach(() => {
    // The environment decides: no DATABASE_URL and no Lovable Cloud means the null adapters.
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    setServerServices(null);
  });

  it("answers the status reads with nothing, as dbConfigured() === false did", async () => {
    expect(await tokenUsageToday()).toEqual({ input: 0, output: 0, ceiling: CEILING });
    expect(await verifierControlsStatus()).toEqual({
      summary: summarizeControls([]),
      strata: controlStrata([]),
    });
  });

  it("keeps the early returns of the jobs that need a database", async () => {
    const empty = {
      posts: 0,
      claims: 0,
      supported: 0,
      unsupported: 0,
      contradicted: 0,
      notFound: 0,
      uncertain: 0,
      deferred: 0,
      tokens: { input: 0, output: 0 },
    };
    expect(await runEntailment()).toEqual({
      ran: false,
      reason: "no database configured",
      ...empty,
    });
    expect(await runVerifierControls()).toMatchObject({
      ran: false,
      reason: "no database configured",
      asked: 0,
    });
    await expect(runServerVerification()).rejects.toThrow(
      "Server verification needs DATABASE_URL (PostgreSQL)",
    );
  });

  it("throws what db() threw for the operations that write or read posts", async () => {
    await expect(
      nullVerificationRepo.recordUsage("controls", { input: 1, output: 1 }),
    ).rejects.toThrow("DATABASE_URL not set");
    await expect(nullVerificationRepo.postTexts(["p1"])).rejects.toThrow("DATABASE_URL not set");
    await expect(
      nullVerificationRepo.recordControl({} as unknown as ControlRecord),
    ).rejects.toThrow("DATABASE_URL not set");
    expect(hoisted.db).not.toHaveBeenCalled();
  });
});
