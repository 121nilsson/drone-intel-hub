import { createHash } from "node:crypto";
import type { JSONValue } from "postgres";
import {
  isBriefingSummaryFresh,
  parseBriefingSummaryStored,
  type BriefingSummaryStored,
} from "@/features/briefing/briefing-summary-shared";
import { DEFAULT_SETTINGS } from "@/shared/infra/settings-defaults";
import { BRIEFING_SUMMARY_SYSTEM } from "@/shared/contracts/ai";
import { chatCompletionOnce } from "@/shared/infra/ai-proxy.server";
import { readProviderEnvConfig } from "@/shared/infra/provider-env.server";
import { db, dbConfigured } from "@/shared/infra/postgres/db.server";

export const BRIEFING_SUMMARY_SLOT = "briefing:executive_summary";

export function briefingContextFingerprint(context: string): string {
  return createHash("sha256").update(context, "utf8").digest("hex");
}

async function readStored(): Promise<BriefingSummaryStored | null> {
  const rows = await db()`
    select last_result from sync_state where name = ${BRIEFING_SUMMARY_SLOT}`;
  const row = rows[0];
  if (!row) return null;
  return parseBriefingSummaryStored(row["last_result"]);
}

async function writeStored(entry: BriefingSummaryStored) {
  const conn = db();
  await conn`
    insert into sync_state (name, last_sync, last_result)
    values (${BRIEFING_SUMMARY_SLOT}, now(), ${conn.json(entry as unknown as JSONValue)})
    on conflict (name) do update
      set last_sync = excluded.last_sync,
          last_result = excluded.last_result`;
}

export async function getSharedBriefingSummary(
  context: string,
  now = Date.now(),
): Promise<BriefingSummaryStored | null> {
  if (!dbConfigured()) return null;
  // Freshness alone decides. The context is built from the week's posts and changes on every
  // sync; keying reuse on its fingerprint would regenerate the summary (a tier-2 call) on nearly
  // every page view. The summary may lag the live panels by up to the TTL. `context` is kept in
  // the signature for callers and for the fingerprint stored alongside a new summary.
  void context;
  const stored = await readStored();
  if (!stored) return null;
  if (!isBriefingSummaryFresh(stored.generatedAt, now)) return null;
  return stored;
}

export async function putSharedBriefingSummary(
  context: string,
  summary: string,
  generatedAt: number,
): Promise<void> {
  if (!dbConfigured()) return;
  const trimmed = summary.trim();
  if (trimmed.length < 20 || trimmed.length > 20_000) return;
  await writeStored({
    summary: trimmed,
    generatedAt,
    contextFingerprint: briefingContextFingerprint(context),
  });
}

async function summarizeOnServer(context: string): Promise<string> {
  // Async: reading the provider table is a dynamic import, so it is awaited rather than
  // inspected synchronously.
  const env = await readProviderEnvConfig();
  if (!env.hasKey) {
    return `Automated digest (local engine — set a provider key such as GROQ_API_KEY or NVIDIA_API_KEY on the server for narrative analysis).\n\n${context}`;
  }
  // No key or URL here: the transport resolves both per provider, so the summary falls through
  // the same chain as extraction instead of being pinned to one provider's credentials.
  const r = await chatCompletionOnce({
    model: env.tier2Model ?? DEFAULT_SETTINGS.tier2Model,
    json: false,
    system: BRIEFING_SUMMARY_SYSTEM,
    prompt: context,
    tier: "tier2",
  });
  if (!r.ok) throw new Error(r.error);
  return r.content;
}

/** Read cache, or generate once on the server when a provider key is configured. */
export async function resolveSharedBriefingSummary(
  context: string,
  now = Date.now(),
): Promise<BriefingSummaryStored | null> {
  const hit = await getSharedBriefingSummary(context, now);
  if (hit) return hit;
  if (!dbConfigured()) return null;

  const env = await readProviderEnvConfig();
  if (!env.hasKey) return null;

  const summary = await summarizeOnServer(context);
  const generatedAt = Date.now();
  const entry: BriefingSummaryStored = {
    summary,
    generatedAt,
    contextFingerprint: briefingContextFingerprint(context),
  };
  await writeStored(entry);
  return entry;
}
