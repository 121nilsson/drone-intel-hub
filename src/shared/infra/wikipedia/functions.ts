import { createServerFn } from "@tanstack/react-start";
import type { ReferenceFetchResult } from "./index";

export type { ReferenceFetchResult } from "./index";

/** Manual catalog import. The handler pulls Wikidata and Wikipedia on the server. */
export const fetchWikipediaReference = createServerFn({ method: "POST" }).handler(
  async (): Promise<ReferenceFetchResult> => {
    const { fetchReferenceCatalog } = await import("./server");
    return fetchReferenceCatalog();
  },
);
