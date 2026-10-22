import { describe, expect, it } from "vitest";
import type { AIProviderSettings } from "@/shared/contracts/ai";
import { OpenAICompatibleExtractor } from "@/shared/infra/openai-compatible-ai";
import type { ChatInput } from "@/shared/infra/ai-proxy.server";

const cfg: AIProviderSettings = {
  baseUrl: "https://x.test",
  apiKey: "test-key",
  tier1Model: "tier1",
  tier2Model: "tier2",
  translateModel: "tier2",
  escalationThreshold: 0.6,
  autoMergeThreshold: 0.85,
  autoPromoteThreshold: 0.9,
  autoDiscardThreshold: 0.2,
  heuristicFirst: true,
};

describe("the AI extractor's prompt budget", () => {
  /**
   * Storage and prompt window are separate decisions: an article is stored whole so the heuristic
   * and later jobs read it, while the AI call takes a bounded window. Tying the prompt to storage
   * was how raising the collection cap would have quietly multiplied every escalated call's cost.
   */
  it("reads a bounded window and leaves the rest of the stored post untouched", async () => {
    let prompt = "";
    const extractor = new OpenAICompatibleExtractor(1, cfg, async (input: ChatInput) => {
      prompt = input.prompt;
      return { ok: true, content: "{}", model: "test-model" };
    });

    const raw = `${"A".repeat(40_000)}tail-marker`;
    const extraction = await extractor.extract(raw, []);

    const report = prompt.split("Report:\n")[1] ?? "";
    expect(report).toHaveLength(30_000);
    expect(report).not.toContain("tail-marker");
    // The post itself keeps the tail; only what is sent to the model is cut.
    expect(raw).toContain("tail-marker");
    expect(extraction.metadata?.promptVersion).toBeDefined();
  });
});
