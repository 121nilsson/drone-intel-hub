import { createServerFn } from "@tanstack/react-start";
import { chatCompletionOnce, type ChatInput, type ChatResult } from "./ai-proxy.server";
import { DEFAULT_SETTINGS } from "./settings-defaults";
import type { Drone } from "@/entities/drone/types";
import { sanitizeText } from "@/shared/infra/json-sanitize";
import { buildSystemEvidenceDigest } from "@/shared/infra/system-evidence-digest";
import { parseModelJson, humanizeBriefItem, stripPointerNotation } from "./model-json";

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

/**
 * The dossier brief. The digest is machine notation, and models of every size parrot it back as
 * unreadable paths ("specifications.wingspan.claims[0].value") unless the prompt names that
 * failure explicitly - so it does, and the parser still scrubs notation that slips through
 * (model-json's humanizeBriefItem).
 */
const SYSTEM_SUMMARY_SYSTEM =
  "You are a defense-system analyst writing the dossier brief of an entry in a systems " +
  "catalogue. The user message is an internal evidence digest in JSON notation: its keys, field " +
  "names and array indexes (system.id, specifications.range.claims[0].value, " +
  "specifications[0].label ...) are machine references - never copy them, in parentheses or " +
  "otherwise, into anything you write. " +
  "Return ONLY one JSON object with the keys overview, verified, caveats, provenance, nextChecks. " +
  "overview: 2-4 plain sentences on what the system appears to be and how this catalogue " +
  "documents it. Prose, never a list. " +
  "verified: one item per supported fact, each a complete readable sentence that states the fact " +
  'and names its source naturally, like "Wikipedia infobox gives a 2.5 m wingspan" or ' +
  '"Euromaidan Press (2026-10-11) reports a 10 kg warhead". The entry\'s own record - id, name, ' +
  "domain, origin - is the dossier's header, not a fact; never list it as an item. " +
  "caveats: what is disputed, single-sourced, low-confidence or unverified, in the same wording. " +
  "provenance: one item per source you actually used: outlet or feed name, optionally with a " +
  "date or URL. No field lists, no paths. " +
  "nextChecks: 1-3 concrete verifications still missing. " +
  "Keep every item short. Use only the supplied data; do not invent facts.";

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
    // List items an analyst reads; notation lines the model copied off the digest drop here.
    const items = (v: unknown): string[] =>
      Array.isArray(v)
        ? v
            .map((x) => humanizeBriefItem(sanitizeText(String(x))))
            .filter((x): x is string => Boolean(x))
        : [];
    const brief = parsed
      ? {
          overview: stripPointerNotation(sanitizeText(String(parsed["overview"] ?? "").trim())),
          verified: items(parsed["verified"]),
          caveats: items(parsed["caveats"]),
          provenance: items(parsed["provenance"]),
          nextChecks: items(parsed["nextChecks"]),
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
