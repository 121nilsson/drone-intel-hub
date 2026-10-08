import { createServerFn } from "@tanstack/react-start";
import { fetchOne } from "./fetch-posts";

export type { FetchedPost } from "./fetch-posts";

interface Input {
  platform: "X" | "Telegram" | "RSS" | "Web";
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
    const { extractArticleText } = await import("./article.server");
    return fetchOne(
      { platform: data.platform, handle: data.handle },
      {
        timeoutMs: Number(process.env["FETCH_TIMEOUT_MS"] ?? 15_000),
        ...(process.env["X_BRIDGE_BASE"] ? { xBridgeBase: process.env["X_BRIDGE_BASE"] } : {}),
        articleText: extractArticleText,
      },
    );
  });
