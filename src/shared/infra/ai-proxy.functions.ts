import { createServerFn } from "@tanstack/react-start";
import { chatCompletionOnce, type ChatInput, type ChatResult } from "./ai-proxy.server";
import { DEFAULT_SETTINGS } from "./settings-defaults";
import type { Drone } from "@/entities/drone/types";
import { sanitizeText } from "@/shared/infra/json-sanitize";
import { buildSystemEvidenceDigest } from "@/shared/infra/system-evidence-digest";
import { parseModelJson } from "./model-json";

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

const SYSTEM_SUMMARY_SYSTEM =
  "You are a defense-system analyst." +
  "Return ONLY a JSON object with these keys: overview (string), verified (string[]), caveats (string[]), " +
  "provenance (string[]), nextChecks (string[]). " +
  "overview: 2-4 sentences saying what the system appears to be and how it is documented here. " +
  "verified: one short item per supported fact, each prefixed with the source/feed/excerpt it came from when you know it. " +
  "caveats: disputed, low-confidence, ambiguous, or unverified items. Do not merge them into verified. " +
  "provenance: which record fields or source passages each conclusion rested on. " +
  "nextChecks: the most valuable missing verification. Keep every item short. Use only supplied data and do not invent facts.";

export const generateSystemSummary = createServerFn({ method: "POST" })
  .validator((d: { drone: Drone }) => {
    if (!d?.drone?.id) throw new Error("Drone required");
    return d;
  })
  .handler(async ({ data }) => {
    const env = await (await import("./provider-env.server")).readProviderEnvConfig();
    if (!env.hasKey) return { ok: false as const, error: "AI provider not configured" };
    const d = data.drone;
    const digest = buildSystemEvidenceDigest(d);
    const facts = digest;
    const result = await chatCompletionOnce({
      model: env.tier2Model ?? DEFAULT_SETTINGS.tier2Model,
      system: SYSTEM_SUMMARY_SYSTEM,
      prompt: "SYSTEM EVIDENCE DIGEST:\n" + JSON.stringify(facts, null, 2),
      json: true,
      tier: "tier2",
    });
    if (!result.ok) return { ok: false as const, error: result.error };
    // The raw-markdown brief a dossier used to settle on came from models that fenced (or
    // thought-wrapped) their JSON: content fell through JSON.parse into the fallback path and
    // the whole fenced blob was stored as the brief. The shared parser recovers the object;
    // a structurally failed structure falls back to the model's prose.
    const parsed = parseModelJson(result.content);
    const brief = parsed
      ? {
          overview: sanitizeText(String(parsed["overview"] ?? "").trim()),
          verified: Array.isArray(parsed["verified"])
            ? parsed["verified"].map((x: unknown) => sanitizeText(String(x)))
            : [],
          caveats: Array.isArray(parsed["caveats"])
            ? parsed["caveats"].map((x: unknown) => sanitizeText(String(x)))
            : [],
          provenance: Array.isArray(parsed["provenance"])
            ? parsed["provenance"].map((x: unknown) => sanitizeText(String(x)))
            : [],
          nextChecks: Array.isArray(parsed["nextChecks"])
            ? parsed["nextChecks"].map((x: unknown) => sanitizeText(String(x)))
            : [],
        }
      : {
          overview: sanitizeText(result.content.trim()),
          verified: [],
          caveats: [],
          provenance: [],
          nextChecks: [],
        };
    return { ok: true as const, summary: brief.overview, brief };
  });
