import type { Procurement } from "@/entities/procurement/types";
import type { ProcurementExtractor } from "@/shared/contracts/ai";
import { ProcurementExtractionSchema } from "@/shared/contracts/extraction.schema";
import { chatCompletion } from "./ai-proxy.functions";
import type { ChatTransport } from "./ai-proxy.server";

const PROCURE_SYS = `You are a defense procurement analyst. Extract contract and grant information from the report.
Reply in json with keys: company (string), country (ISO2), amount (string|null), currency (string|null),
program (string|null), product (string|null), customer (string|null), announcedAt (string|null), notes (string|null).
Only report information that appears in the text. If no procurement info is found, return null for all fields.`;

/**
 * Extracts procurement records through a chat transport.
 *
 * The transport is injected, so the same extractor works in both contexts: the browser passes
 * the server-function bridge (keeps the key off the client), while a scheduled task passes
 * `chatCompletionOnce` because server functions have no context outside a request.
 */
export function openAIProcurementExtractor(
  cfg: { baseUrl: string; apiKey: string; model: string },
  chat: ChatTransport = (i) => chatCompletion({ data: i }),
): ProcurementExtractor {
  return async (raw: string, source: string) => {
    const r = await chat({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      system: PROCURE_SYS,
      prompt: raw,
      json: true,
      tier: "tier2",
    });
    if (!r.ok) return null;
    try {
      const parsed = ProcurementExtractionSchema.safeParse(
        JSON.parse(r.content.replace(/^```json|```$/g, "").trim()),
      );
      if (!parsed.success) return null;
      const j = parsed.data;
      return {
        id: crypto.randomUUID(),
        company: j.company,
        country: j.country,
        ...(j.amount ? { amount: j.amount } : {}),
        ...(j.currency ? { currency: j.currency } : {}),
        ...(j.program ? { program: j.program } : {}),
        ...(j.product ? { product: j.product } : {}),
        ...(j.customer ? { customer: j.customer } : {}),
        ...(j.announcedAt ? { announcedAt: j.announcedAt } : {}),
        source,
        ...(j.notes ? { notes: j.notes } : {}),
        createdAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  };
}
