import { createServerFn } from "@tanstack/react-start";
import { chatCompletionOnce, type ChatInput, type ChatResult } from "./ai-proxy.server";

export type { ChatInput, ChatResult } from "./ai-proxy.server";

/**
 * Server-side proxy to any OpenAI-compatible endpoint (NVIDIA NIM, OpenAI, vLLM...).
 *
 * Thin request-scoped wrapper around the shared transport, so the browser can reach the
 * provider without the key. Scheduled jobs call `chatCompletionOnce` directly instead -
 * a server function has no Start context outside a request.
 */
export const chatCompletion = createServerFn({ method: "POST" })
  .validator((d: ChatInput) => {
    if (!d?.model) throw new Error("Model required");
    return d;
  })
  .handler(async ({ data }): Promise<ChatResult> => chatCompletionOnce(data));

/**
 * Non-secret provider config resolved from the server environment (.env.local).
 * The API key itself is deliberately never returned - it stays on the server.
 */
export const getEnvProviderConfig = createServerFn({ method: "POST" }).handler(async () => {
  const { readProviderEnvConfig } = await import("./provider-env.server");
  return readProviderEnvConfig();
});

/**
 * Translate text to English using a small translation model.
 * Used by the Queue and Sources pages to make Russian/Ukrainian posts readable.
 */
export const translateText = createServerFn({ method: "POST" })
  .validator((d: { text: string; model?: string }) => {
    if (!d?.text?.trim()) throw new Error("Text required");
    return d;
  })
  .handler(
    async ({ data }): Promise<{ ok: true; translated: string } | { ok: false; error: string }> => {
      const result = await chatCompletionOnce({
        model: data.model ?? "nvidia/riva-translate-4b-instruct-v2",
        system:
          "Translate the following text to English. If the text is already in English, return it unchanged. Preserve technical terms, numbers, and proper nouns.",
        prompt: data.text,
        json: false,
        tier: "tier1",
      });
      if (!result.ok) return { ok: false as const, error: result.error };
      return { ok: true as const, translated: result.content };
    },
  );
