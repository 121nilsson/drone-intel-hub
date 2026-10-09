import { createServerFn } from "@tanstack/react-start";
import type { ReferenceFetchResult } from "./wikipedia";

export type { ReferenceFetchResult } from "./wikipedia";

/** Manual catalog import. The handler pulls Wikidata and Wikipedia on the server. */
export const fetchWikipediaReference = createServerFn({ method: "POST" }).handler(
  async (): Promise<ReferenceFetchResult> => {
    const { fetchReferenceCatalog } = await import("./wikipedia.server");
    return fetchReferenceCatalog();
  },
);
