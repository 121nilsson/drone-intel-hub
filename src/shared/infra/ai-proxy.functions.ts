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
export const getEnvProviderConfig = createServerFn({ method: "GET" }).handler(async () => ({
  hasKey: !!process.env["NVIDIA_API_KEY"]?.trim(),
  baseUrl: process.env["NVIDIA_BASE_URL"]?.trim() || undefined,
  tier1Model: process.env["NVIDIA_TIER1_MODEL"]?.trim() || undefined,
  tier2Model: process.env["NVIDIA_TIER2_MODEL"]?.trim() || undefined,
}));
