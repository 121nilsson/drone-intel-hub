import { describe, expect, it } from "vitest";
import type { Extraction } from "@/entities/drone/types";
import { HeuristicExtractor } from "@/shared/infra/heuristic-ai";
import { EXTRACTION_CORPUS, type ExtractionFixture } from "./fixtures/extraction-corpus";

/** Shared expectations, so the local and the live run judge an extraction the same way. */
function expectFixture(fixture: ExtractionFixture, e: Extraction) {
  const keys = new Set(e.specs.map((s) => s.key));
  if (fixture.expectNoSpecs) {
    expect(
      e.specs.map((s) => s.key),
      `${fixture.name}: expected no specs`,
    ).toEqual([]);
  }
  for (const key of fixture.expectedKeys) {
    expect(keys, `${fixture.name}: missing ${key}`).toContain(key);
  }
  const systems = new Set((e.systems ?? []).map((s) => s.name));
  for (const system of fixture.systems ?? []) {
    expect(systems, `${fixture.name}: missing system ${system}`).toContain(system);
  }
}

describe("extraction corpus (heuristic)", () => {
  const t = new HeuristicExtractor(1);
  for (const fixture of EXTRACTION_CORPUS) {
    it(fixture.name, async () => {
      expectFixture(fixture, await t.extract(fixture.text, []));
    });
  }
});

// Opt-in: LIVE_EXTRACTION=1 npx vitest run src/test/extraction-corpus.test.ts
// Sends the same corpus through the configured provider. Skipped by default, so no network and
// no server-only module is loaded unless the variable is set.
describe.skipIf(!process.env["LIVE_EXTRACTION"])("extraction corpus (live provider)", () => {
  it("meets the same expectations through OpenAICompatibleExtractor", async () => {
    const { readProviderEnvConfig } = await import("@/shared/infra/provider-env.server");
    const { chatCompletionOnce } = await import("@/shared/infra/ai-proxy.server");
    const { OpenAICompatibleExtractor } = await import("@/shared/infra/openai-compatible-ai");
    const { DEFAULT_SETTINGS } = await import("@/shared/infra/settings-defaults");
    const env = await readProviderEnvConfig();
    const cfg = {
      ...DEFAULT_SETTINGS,
      baseUrl: env.baseUrl ?? DEFAULT_SETTINGS.baseUrl,
      tier1Model: env.tier1Model ?? DEFAULT_SETTINGS.tier1Model,
      apiKey: "",
    };
    const extractor = new OpenAICompatibleExtractor(1, cfg, chatCompletionOnce);
    for (const fixture of EXTRACTION_CORPUS) {
      expectFixture(fixture, await extractor.extract(fixture.text, []));
    }
  }, 120_000);
});
