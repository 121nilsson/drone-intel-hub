import type { Domain } from "@/entities/drone/types";
import {
  REFERENCE_CLASSES,
  REFERENCE_HOSTS,
  REFERENCE_LIMIT,
  buildReferenceCards,
  classSparql,
  isQid,
  parseSparqlIds,
  relatedIds,
  type ReferenceFetchResult,
  type WikiLang,
} from "./wikipedia";

export type { ReferenceFetchResult } from "./wikipedia";

const USER_AGENT = "DroneIntelHub/1.0 (catalog reference import)";
const ENTITY_BATCH = 50;
const TITLE_BATCH = 20;
const PAUSE_MS = 100;

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Loads the reference catalog from Wikidata and Wikipedia. Hosts are fixed; nothing here
 * accepts a caller-supplied URL. A failed request fails the import. An item with no label
 * is skipped and counted.
 */
export async function fetchReferenceCatalog(opts?: {
  fetchImpl?: FetchImpl;
  pauseMs?: number;
}): Promise<ReferenceFetchResult> {
  const pauseMs = opts?.pauseMs ?? PAUSE_MS;
  let primed = false;
  const fetchImpl: FetchImpl = async (url, init) => {
    if (primed) await sleep(pauseMs);
    primed = true;
    return (opts?.fetchImpl ?? fetch)(url, init);
  };
  try {
    const ids: string[] = [];
    const classes: Record<string, Domain[]> = {};
    let truncated = false;
    let skipped = 0;
    for (const cls of REFERENCE_CLASSES) {
      if (ids.length >= REFERENCE_LIMIT) {
        truncated = true;
        break;
      }
      const parsed = parseSparqlIds(await postSparql(fetchImpl, cls.qid));
      skipped += parsed.rejected;
      if (parsed.ids.length >= REFERENCE_LIMIT) truncated = true;
      for (const id of parsed.ids) {
        const domains = classes[id] ?? [];
        if (!domains.includes(cls.domain)) domains.push(cls.domain);
        classes[id] = domains;
        if (ids.includes(id)) continue;
        if (ids.length >= REFERENCE_LIMIT) {
          truncated = true;
          continue;
        }
        ids.push(id);
      }
    }
    if (ids.length === 0) return { ok: true, cards: [], truncated, skipped };

    const entities = await getEntities(fetchImpl, ids);
    const extra = relatedIds(entities, new Set(ids)).slice(0, REFERENCE_LIMIT * 2);
    const related = extra.length ? await getEntities(fetchImpl, extra) : { entities: {} };
    const titles = titlesByLang(entities);
    const extracts: Partial<Record<WikiLang, unknown>> = {};
    for (const lang of ["en", "ru", "uk"] as const) {
      const list = titles[lang];
      if (!list?.length) continue;
      extracts[lang] = await getExtracts(fetchImpl, lang, list);
    }
    const built = buildReferenceCards({ entities, related, extracts, classes });
    return { ok: true, cards: built.cards, truncated, skipped: skipped + built.skipped };
  } catch (e) {
    return { ok: false, error: failMessage(e) };
  }
}

async function postSparql(fetchImpl: FetchImpl, classQid: string): Promise<unknown> {
  return getJson(fetchImpl, "https://query.wikidata.org/sparql", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/sparql-results+json",
    },
    body: new URLSearchParams({ query: classSparql(classQid) }),
  });
}

async function getEntities(fetchImpl: FetchImpl, ids: string[]): Promise<unknown> {
  const merged: Record<string, unknown> = {};
  for (const batch of chunk(ids.filter(isQid), ENTITY_BATCH)) {
    const url = new URL("https://www.wikidata.org/w/api.php");
    url.searchParams.set("action", "wbgetentities");
    url.searchParams.set("ids", batch.join("|"));
    url.searchParams.set("props", "labels|aliases|descriptions|claims|sitelinks");
    url.searchParams.set("languages", "en|ru|uk");
    url.searchParams.set("format", "json");
    const body = await getJson(fetchImpl, url.toString());
    const entities = asRecord(body)?.["entities"];
    if (!entities || typeof entities !== "object") continue;
    Object.assign(merged, entities);
  }
  return { entities: merged };
}

function titlesByLang(entitiesPayload: unknown): Partial<Record<WikiLang, string[]>> {
  const entities = asRecord(asRecord(entitiesPayload)?.["entities"]) ?? {};
  const out: Partial<Record<WikiLang, string[]>> = {};
  for (const entity of Object.values(entities)) {
    const sitelinks = asRecord(asRecord(entity)?.["sitelinks"]);
    const picked = preferredSite(sitelinks);
    if (!picked) continue;
    const list = out[picked.lang] ?? [];
    if (!list.includes(picked.title)) list.push(picked.title);
    out[picked.lang] = list;
  }
  return out;
}

/** English article when one exists, otherwise Russian, otherwise Ukrainian. */
function preferredSite(
  sitelinks: Record<string, unknown> | null,
): { lang: WikiLang; title: string } | null {
  if (!sitelinks) return null;
  for (const [site, lang] of [
    ["enwiki", "en"],
    ["ruwiki", "ru"],
    ["ukwiki", "uk"],
  ] as const) {
    const title = asRecord(sitelinks[site])?.["title"];
    if (
      typeof title === "string" &&
      title.trim() &&
      title.length <= 300 &&
      !/[|\n\r]/.test(title)
    ) {
      return { lang, title: title.trim() };
    }
  }
  return null;
}

async function getExtracts(
  fetchImpl: FetchImpl,
  lang: WikiLang,
  titles: string[],
): Promise<unknown> {
  const pages: unknown[] = [];
  const normalized: unknown[] = [];
  const redirects: unknown[] = [];
  for (const batch of chunk(titles, TITLE_BATCH)) {
    const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
    url.searchParams.set("action", "query");
    url.searchParams.set("prop", "extracts|revisions");
    url.searchParams.set("exintro", "1");
    url.searchParams.set("explaintext", "1");
    url.searchParams.set("exlimit", String(TITLE_BATCH));
    url.searchParams.set("rvprop", "ids");
    url.searchParams.set("redirects", "1");
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");
    url.searchParams.set("titles", batch.join("|"));
    const query = asRecord(asRecord(await getJson(fetchImpl, url.toString()))?.["query"]);
    const queryPages = query?.["pages"];
    if (Array.isArray(queryPages)) pages.push(...queryPages);
    const queryNormalized = query?.["normalized"];
    if (Array.isArray(queryNormalized)) normalized.push(...queryNormalized);
    const queryRedirects = query?.["redirects"];
    if (Array.isArray(queryRedirects)) redirects.push(...queryRedirects);
  }
  return { query: { pages, normalized, redirects } };
}

async function getJson(fetchImpl: FetchImpl, url: string, init?: RequestInit): Promise<unknown> {
  const host = new URL(url).host;
  if (!REFERENCE_HOSTS.includes(host as (typeof REFERENCE_HOSTS)[number])) {
    throw new Error("Unexpected reference host");
  }
  // Source fetches default to 15s. The Wikidata query service is often slower than that on a
  // cold plan, so this import waits at least 45s unless FETCH_TIMEOUT_MS is 0 (disabled).
  const configured = Number(process.env["FETCH_TIMEOUT_MS"] ?? 15_000);
  const timeoutMs = configured > 0 ? Math.max(configured, 45_000) : 0;
  const headers = new Headers(init?.headers);
  headers.set("user-agent", USER_AGENT);
  if (!headers.has("accept")) headers.set("accept", "application/json");
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, {
      ...init,
      headers,
      ...(timeoutMs > 0 ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
    if (res.status === 429 && attempt < 3) {
      await sleep(retryDelay(res, attempt));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} (${host})`);
    return res.json();
  }
}

/** Honor Retry-After when Wikidata asks us to slow down. Otherwise wait 1s, 2s, 4s. */
function retryDelay(res: Response, attempt: number): number {
  const header = res.headers.get("retry-after");
  const seconds = header === null ? Number.NaN : Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 20_000);
  return 1000 * 2 ** attempt;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function failMessage(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === "TimeoutError" || e.name === "AbortError") return "Reference import timed out";
    const msg = e.message.replace(/\s+/g, " ").trim();
    return msg.slice(0, 160) || "Reference import failed";
  }
  return "Reference import failed";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}
