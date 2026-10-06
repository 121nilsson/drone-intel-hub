import { createServerFn } from "@tanstack/react-start";
import { fetchOne } from "./fetch-posts";

export type { FetchedPost } from "./fetch-posts";

interface Input {
  platform: "X" | "Telegram" | "RSS" | "Web";
  handle: string;
}

/** Fetches recent public posts for a monitored source. X requires a paid API, so it is unsupported. */
export const fetchSourcePosts = createServerFn({ method: "POST" })
  .validator((d: Input) => {
    if (!d || typeof d.handle !== "string" || d.handle.length > 300)
      throw new Error("Invalid source");
    return d;
  })
  .handler(async ({ data }) => fetchOne({ platform: data.platform, handle: data.handle }));
