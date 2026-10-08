import { createHash } from "node:crypto";
import type { JSONValue } from "postgres";
import {
  isBriefingSummaryFresh,
  parseBriefingSummaryStored,
  type BriefingSummaryStored,
} from "@/features/briefing/briefing-summary-shared";
import { DEFAULT_SETTINGS } from "@/shared/infra/settings-defaults";
import { chatCompletionOnce } from "@/shared/infra/ai-proxy.server";
import { readProviderEnvConfig } from "@/shared/infra/provider-env.server";
import { db, dbConfigured } from "@/shared/infra/postgres/db.server";

export const BRIEFING_SUMMARY_SLOT = "briefing:executive_summary";

const SUMMARY_SYSTEM =
  "Write a terse 4-6 sentence executive intelligence summary of weekly drone technology shifts. No preamble.";

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
  const fingerprint = briefingContextFingerprint(context);
  const stored = await readStored();
  if (!stored) return null;
  if (stored.contextFingerprint !== fingerprint) return null;
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
  const env = readProviderEnvConfig();
  const apiKey = process.env["NVIDIA_API_KEY"]?.trim();
  if (!env.hasKey || !apiKey) {
    return `Automated digest (local engine — set NVIDIA_API_KEY on the server for narrative analysis).\n\n${context}`;
  }
  const model = env.tier2Model ?? DEFAULT_SETTINGS.tier2Model;
  const baseUrl = env.baseUrl ?? DEFAULT_SETTINGS.baseUrl;
  const r = await chatCompletionOnce({
    baseUrl,
    apiKey,
    model,
    json: false,
    system: SUMMARY_SYSTEM,
    prompt: context,
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

  const env = readProviderEnvConfig();
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
