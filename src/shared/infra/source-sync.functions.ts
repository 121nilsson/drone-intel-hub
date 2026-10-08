import { createServerFn } from "@tanstack/react-start";
import { readSyncState, type SyncState } from "./sync-state-read.server";
import { runAutoSync } from "./source-sync.server";

export type { SyncState } from "./sync-state-read.server";

/** Throttle state for the UI, and a manual trigger for the same job the cron runs. */
export const getSyncState = createServerFn({ method: "POST" }).handler(
  async (): Promise<SyncState> => readSyncState(),
);

export const triggerAutoSync = createServerFn({ method: "POST" })
  .validator((d: { minIntervalMs?: number; force?: boolean } | undefined) => ({
    ...(typeof d?.minIntervalMs === "number" ? { minIntervalMs: d.minIntervalMs } : {}),
    force: d?.force === true,
  }))
  .handler(async ({ data }) => runAutoSync(data));
