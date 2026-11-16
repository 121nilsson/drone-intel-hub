import type { WorkProgress } from "@/shared/infra/ingest/auto-ingest";
import {
  SYNC_COOLDOWN_SLOT,
  SYNC_PROGRESS_SLOT,
  SYNC_SLOT,
} from "@/shared/contracts/sync-state-repo";
import { serverServices } from "./server-services.server";

/** The slot names live in the port's contract so the adapters that write them share them. */
export { SYNC_COOLDOWN_SLOT, SYNC_PROGRESS_SLOT, SYNC_SLOT };

export interface SyncCooldown {
  level: number;
  until: string;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function parseSyncCooldown(raw: unknown): SyncCooldown | null {
  const value = typeof raw === "string" ? safeJson(raw) : raw;
  if (!value || typeof value !== "object") return null;
  const c = value as Record<string, unknown>;
  const level = num(c["level"]);
  const until = c["until"];
  if (level === null || typeof until !== "string" || Number.isNaN(Date.parse(until))) return null;
  return { level, until };
}

/** Accept only a complete heartbeat. A corrupt blob is "no progress", not a thrown read. */
export function parseSyncProgress(raw: unknown): WorkProgress | null {
  const value = typeof raw === "string" ? safeJson(raw) : raw;
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  const phase = p["phase"];
  if (phase !== "fetching" && phase !== "analysing" && phase !== "done") return null;
  if (typeof p["current"] !== "string" || typeof p["updatedAt"] !== "string") return null;
  const index = num(p["index"]);
  const total = num(p["total"]);
  const processed = num(p["processed"]);
  const irrelevant = num(p["irrelevant"]);
  const merged = num(p["merged"]);
  const queued = num(p["queued"]);
  const failed = num(p["failed"]);
  const remaining = num(p["remaining"]);
  if (
    index === null ||
    total === null ||
    processed === null ||
    irrelevant === null ||
    merged === null ||
    queued === null ||
    failed === null ||
    remaining === null
  )
    return null;
  const currentId = p["currentId"];
  const promoted = num(p["promoted"]);
  const discarded = num(p["discarded"]);
  return {
    phase,
    current: p["current"],
    ...(typeof currentId === "string" ? { currentId } : {}),
    index,
    total,
    processed,
    irrelevant,
    merged,
    ...(promoted !== null ? { promoted } : {}),
    ...(discarded !== null ? { discarded } : {}),
    queued,
    failed,
    remaining,
    updatedAt: p["updatedAt"],
  };
}

export interface SyncState {
  lastSync: string | null;
  configured: boolean;
  progress: WorkProgress | null;
  cooldownUntil: string | null;
}

/** Throttle state for the UI. Never throws. */
export async function readSyncState(): Promise<SyncState> {
  const unavailable: SyncState = {
    lastSync: null,
    configured: false,
    progress: null,
    cooldownUntil: null,
  };
  const partial: SyncState = {
    lastSync: null,
    configured: true,
    progress: null,
    cooldownUntil: null,
  };
  try {
    const rows = await serverServices().syncState.readSlots([
      SYNC_SLOT,
      SYNC_PROGRESS_SLOT,
      SYNC_COOLDOWN_SLOT,
    ]);
    // null: the backend has no database.
    if (!rows) return unavailable;
    let lastSync: string | null = null;
    let progress: WorkProgress | null = null;
    let cooldownUntil: string | null = null;
    for (const row of rows) {
      if (row.name === SYNC_SLOT) {
        const raw = row.lastSync;
        lastSync = raw ? new Date(raw).toISOString() : null;
      } else if (row.name === SYNC_PROGRESS_SLOT) {
        progress = parseSyncProgress(row.lastResult);
      } else if (row.name === SYNC_COOLDOWN_SLOT) {
        const c = parseSyncCooldown(row.lastResult);
        if (c && Date.parse(c.until) > Date.now()) cooldownUntil = c.until;
      }
    }
    return { lastSync, configured: true, progress, cooldownUntil };
  } catch (e) {
    console.error("[sync-state]", e);
    return partial;
  }
}
