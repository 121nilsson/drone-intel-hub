import { createServerFn } from "@tanstack/react-start";
import { fetchOne } from "./fetch-posts";
import type { MonitoredSource } from "@/entities/source/types";
import type { SourceFetchHealth } from "@/shared/contracts/autonomy-insights";

export type { FetchedPost } from "./fetch-posts";

interface Input {
  platform: "X" | "Telegram" | "RSS" | "Web" | "Bluesky";
  handle: string;
}

/**
 * Fetches recent public posts for a monitored source. X requires a paid API unless an RSS bridge
 * is configured, so it is unsupported by default.
 *
 * The article extractor is imported lazily and injected: `fetch-posts.ts` is on the browser's
 * import path, so a static import of jsdom would pull a DOM parser into the client bundle.
 */
export const fetchSourcePosts = createServerFn({ method: "POST" })
  .validator((d: Input) => {
    if (!d || typeof d.handle !== "string" || d.handle.length > 300)
      throw new Error("Invalid source");
    return d;
  })
  .handler(async ({ data }) => {
    const { extractArticleText } = await import("../article.server");
    const source: MonitoredSource = {
      id: `fetch-${data.handle}`,
      name: data.handle,
      platform: data.platform,
      handle: data.handle,
      domain: "Multi",
      notes: "Ad-hoc manual fetch",
    };
    return fetchOne(source, {
      timeoutMs: Number(process.env["FETCH_TIMEOUT_MS"] ?? 15_000),
      ...(process.env["X_BRIDGE_BASE"] ? { xBridgeBase: process.env["X_BRIDGE_BASE"] } : {}),
      ...(process.env["X_JINA_READER"] === "1" ? { xJinaReader: true } : {}),
      articleText: extractArticleText,
    });
  });

/**
 * Per-source fetch health for the Autonomy page. The window is clamped to the log's retention, so
 * a page cannot ask for history the log no longer keeps.
 */
export const fetchSourceFetchHealth = createServerFn({ method: "GET" })
  .validator((d: { days?: number } | undefined) => ({
    days:
      typeof d?.days === "number" && Number.isFinite(d.days)
        ? Math.min(Math.max(Math.floor(d.days), 1), 90)
        : 30,
  }))
  .handler(async ({ data }): Promise<SourceFetchHealth[]> => {
    const { listSourceFetchHealth } = await import("./fetch-log.server");
    return await listSourceFetchHealth(data.days);
  });
