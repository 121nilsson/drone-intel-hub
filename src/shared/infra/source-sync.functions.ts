import { createServerFn } from "@tanstack/react-start";
import { readSyncState, runAutoSync, type SyncState } from "./source-sync.server";

export type { SyncState } from "./source-sync.server";

/** Throttle state for the UI, and a manual trigger for the same job the cron runs. */
export const getSyncState = createServerFn({ method: "GET" }).handler(
  async (): Promise<SyncState> => readSyncState(),
);

export const triggerAutoSync = createServerFn({ method: "POST" })
  .validator((d: { minIntervalMs?: number; force?: boolean } | undefined) => ({
    ...(typeof d?.minIntervalMs === "number" ? { minIntervalMs: d.minIntervalMs } : {}),
    force: d?.force === true,
  }))
  .handler(async ({ data }) => runAutoSync(data));
