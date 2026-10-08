import { createServerFn } from "@tanstack/react-start";
import { dbConfigured } from "@/shared/infra/postgres/db.server";
import {
  getSharedBriefingSummary,
  putSharedBriefingSummary,
  resolveSharedBriefingSummary,
} from "@/shared/infra/briefing-summary.server";

export type BriefingExecutiveSummaryResponse =
  | { status: "no_db" }
  | { status: "hit"; summary: string; generatedAt: number; shared: true }
  | { status: "miss" };

export const fetchBriefingExecutiveSummary = createServerFn({ method: "POST" })
  .validator((d: { context: string }) => {
    if (!d?.context?.trim()) throw new Error("context required");
    return d;
  })
  .handler(async ({ data }): Promise<BriefingExecutiveSummaryResponse> => {
    if (!dbConfigured()) return { status: "no_db" };
    const resolved = await resolveSharedBriefingSummary(data.context);
    if (!resolved) return { status: "miss" };
    return {
      status: "hit",
      summary: resolved.summary,
      generatedAt: resolved.generatedAt,
      shared: true,
    };
  });

/** After a browser-side summarizer run, publish the result for other users. */
export const storeBriefingExecutiveSummary = createServerFn({ method: "POST" })
  .validator((d: { context: string; summary: string; generatedAt: number }) => {
    if (!d?.context?.trim()) throw new Error("context required");
    if (typeof d.summary !== "string" || !d.summary.trim()) throw new Error("summary required");
    if (typeof d.generatedAt !== "number" || !Number.isFinite(d.generatedAt)) {
      throw new Error("generatedAt required");
    }
    return d;
  })
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    if (!dbConfigured()) return { ok: false };
    const existing = await getSharedBriefingSummary(data.context, Date.now());
    if (existing) return { ok: true };
    await putSharedBriefingSummary(data.context, data.summary, data.generatedAt);
    return { ok: true };
  });
