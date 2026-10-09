import type { Domain, ReferenceCard } from "@/entities/drone/types";

/**
 * Pinned vehicle classes. A single query that unions all five property paths times out on the
 * public Wikidata query service, so each class is requested on its own and the ids are merged.
 */
export const REFERENCE_CLASSES: { qid: string; label: string; domain: Domain }[] = [
  { qid: "Q484000", label: "unmanned aerial vehicle", domain: "Air" },
  { qid: "Q1195578", label: "unmanned combat aerial vehicle", domain: "Air" },
  { qid: "Q15832656", label: "loitering munition", domain: "Air" },
  { qid: "Q4419860", label: "unmanned surface vehicle", domain: "Sea" },
  { qid: "Q2031473", label: "unmanned ground vehicle", domain: "Land" },
];

export const REFERENCE_LIMIT = 200;
export const SUMMARY_MAX = 600;

export const REFERENCE_HOSTS = [
  "query.wikidata.org",
  "www.wikidata.org",
  "en.wikipedia.org",
  "ru.wikipedia.org",
  "uk.wikipedia.org",
] as const;

const CLASS_DOMAIN: Record<string, Domain> = Object.fromEntries(
  REFERENCE_CLASSES.map((c) => [c.qid, c.domain]),
);

/** ISO codes for country items. An unmapped country stays "??" rather than a guessed code. */
const COUNTRY_ISO: Record<string, string> = {
  Q212: "UA",
  Q159: "RU",
  Q794: "IR",
  Q148: "CN",
  Q30: "US",
  Q865: "TW",
  Q423: "KP",
  Q43: "TR",
  Q183: "DE",
  Q36: "PL",
  Q142: "FR",
  Q145: "GB",
  Q801: "IL",
  Q184: "BY",
  Q16: "CA",
  Q408: "AU",
  Q17: "JP",
  Q213: "CZ",
  Q214: "SK",
  Q38: "IT",
  Q39: "CH",
  Q40: "AT",
  Q35: "DK",
  Q34: "SE",
  Q20: "NO",
  Q33: "FI",
  Q55: "NL",
  Q31: "BE",
  Q29: "ES",
  Q41: "GR",
  Q45: "PT",
  Q884: "KR",
  Q668: "IN",
  Q252: "ID",
  Q334: "SG",
  Q881: "VN",
  Q869: "TH",
  Q833: "MY",
  Q928: "PH",
  Q843: "PK",
  Q889: "AF",
  Q96: "MX",
  Q155: "BR",
  Q414: "AR",
  Q851: "SA",
  Q878: "AE",
  Q846: "QA",
  Q817: "KW",
  Q796: "IQ",
  Q858: "SY",
  Q219: "BG",
  Q218: "RO",
  Q224: "HR",
  Q37: "LT",
  Q211: "LV",
  Q191: "EE",
  Q232: "KZ",
  Q227: "AZ",
  Q230: "GE",
  Q399: "AM",
  Q265: "UZ",
  Q28: "HU",
  Q403: "RS",
  Q217: "MD",
  Q258: "ZA",
  Q79: "EG",
};

const WIKI_SITES = [
  ["enwiki", "en"],
  ["ruwiki", "ru"],
  ["ukwiki", "uk"],
] as const;

export type WikiLang = (typeof WIKI_SITES)[number][1];

const QID = /^Q\d+$/;
const ALIAS_CAP = 40;

/** NFKC, lowercased, with spaces and hyphens removed so "Shahed-136" and "Shahed 136" agree. */
export function referenceKey(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

export function isQid(value: string): boolean {
  return QID.test(value);
}

/** Entity URI from the query service. Anything that is not a Wikidata item id is dropped. */
export function qidFromUri(uri: string): string | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.host !== "www.wikidata.org") return null;
  const m = url.pathname.match(/^\/entity\/(Q\d+)$/);
  return m ? m[1]! : null;
}

export function classSparql(classQid: string): string {
  if (!isQid(classQid)) throw new Error("Invalid class");
  // Operator first: Ukraine (Q212) or Russia (Q159), either as the operator or as its country.
  return `SELECT DISTINCT ?item WHERE {
  {
    ?operator wdt:P17 wd:Q212 .
  } UNION {
    ?operator wdt:P17 wd:Q159 .
  } UNION {
    VALUES ?operator { wd:Q212 wd:Q159 }
  }
  ?item wdt:P137 ?operator .
  ?item wdt:P31/wdt:P279* wd:${classQid} .
}
LIMIT ${REFERENCE_LIMIT}`;
}

export function truncateSummary(text: string, max = SUMMARY_MAX): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  const base = space > max * 0.6 ? cut.slice(0, space) : cut;
  return `${base.trimEnd()}…`;
}

export type ReferenceFetchResult =
  | { ok: true; cards: ReferenceCard[]; truncated: boolean; skipped: number }
  | { ok: false; error: string };

export function parseSparqlIds(payload: unknown): { ids: string[]; rejected: number } {
  const bindings = asRecord(payload)?.results;
  const rows = asRecord(bindings)?.bindings;
  if (!Array.isArray(rows)) return { ids: [], rejected: 0 };
  const ids: string[] = [];
  let rejected = 0;
  for (const row of rows) {
    const value = asRecord(asRecord(row)?.item)?.value;
    if (typeof value !== "string") {
      rejected++;
      continue;
    }
    const id = qidFromUri(value);
    if (!id) {
      rejected++;
      continue;
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return { ids, rejected };
}

export interface ReferenceBuildInput {
  /** `action=wbgetentities` body for the catalog items. */
  entities: unknown;
  /** `action=wbgetentities` body for manufacturers and operators referenced by those items. */
  related?: unknown;
  /** `action=query` bodies, one per Wikipedia language that was requested. */
  extracts?: Partial<Record<WikiLang, unknown>>;
  /** Classes that matched each item while the SPARQL passes ran. */
  classes?: Record<string, Domain[]>;
}

export function buildReferenceCards(input: ReferenceBuildInput): {
  cards: ReferenceCard[];
  skipped: number;
} {
  const entities = readEntities(input.entities);
  const related = readEntities(input.related ?? {});
  const extracts = {
    en: indexExtracts(input.extracts?.en),
    ru: indexExtracts(input.extracts?.ru),
    uk: indexExtracts(input.extracts?.uk),
  };
  const cards: ReferenceCard[] = [];
  let skipped = 0;
  for (const [key, entity] of Object.entries(entities)) {
    if (!isQid(key) || entity.missing !== undefined) {
      skipped++;
      continue;
    }
    const card = cardFromEntity(key, entity, related, extracts, input.classes);
    if (!card) {
      skipped++;
      continue;
    }
    cards.push(card);
  }
  return { cards, skipped };
}

/** Qids of manufacturers and operators that are not themselves catalog items. */
export function relatedIds(entitiesPayload: unknown, known: ReadonlySet<string>): string[] {
  const ids: string[] = [];
  for (const [key, entity] of Object.entries(readEntities(entitiesPayload))) {
    if (!isQid(key)) continue;
    for (const prop of ["P137", "P176"] as const) {
      for (const id of claimIds(entity, prop)) {
        if (known.has(id) || COUNTRY_ISO[id] || ids.includes(id)) continue;
        ids.push(id);
      }
    }
  }
  return ids;
}

function cardFromEntity(
  qid: string,
  entity: RawEntity,
  related: Record<string, RawEntity>,
  extracts: Record<WikiLang, Map<string, WikiExtract>>,
  classes: Record<string, Domain[]> | undefined,
): ReferenceCard | null {
  const named = pickName(entity);
  if (!named) return null;
  const cyrillic = pickCyrillic(entity);
  const sitelink = pickSitelink(entity);
  const extract = sitelink ? extracts[sitelink.lang].get(sitelink.title) : undefined;
  const description =
    textAt(entity.descriptions, named.lang) || textAt(entity.descriptions, "en") || "";
  const summary = truncateSummary(extract?.extract || description);
  const title = sitelink?.title ?? named.name;
  const lang = sitelink?.lang ?? named.lang;
  const url = sitelink
    ? wikiUrl(sitelink.lang, sitelink.title)
    : `https://www.wikidata.org/wiki/${qid}`;
  const manufacturer = manufacturerOf(entity, related);
  return {
    wikidataId: qid,
    name: named.name.slice(0, 200),
    ...(cyrillic ? { cyrillic: cyrillic.slice(0, 200) } : {}),
    aliases: pickAliases(entity, named.name, cyrillic),
    domain: domainOf(qid, claimIds(entity, "P31"), classes),
    origin: originOf(entity),
    ...(manufacturer ? { manufacturer } : {}),
    operators: operatorCodes(entity, related),
    summary,
    lang,
    title,
    revisionId: extract?.revid ?? 0,
    url,
  };
}

function pickName(entity: RawEntity): { name: string; lang: WikiLang } | null {
  for (const lang of ["en", "uk", "ru"] as const) {
    const name = textAt(entity.labels, lang);
    if (name) return { name, lang };
  }
  return null;
}

function pickCyrillic(entity: RawEntity): string | undefined {
  for (const lang of ["ru", "uk"] as const) {
    const value = textAt(entity.labels, lang);
    if (value && /[\u0400-\u04FF]/.test(value)) return value;
  }
  return undefined;
}

function pickAliases(entity: RawEntity, name: string, cyrillic?: string): string[] {
  const skip = new Set(
    [referenceKey(name), cyrillic ? referenceKey(cyrillic) : ""].filter(Boolean),
  );
  const out: string[] = [];
  for (const lang of ["en", "ru", "uk"] as const) {
    const values = [textAt(entity.labels, lang), ...aliasValues(entity.aliases?.[lang])];
    for (const value of values) {
      const key = referenceKey(value);
      if (!key || skip.has(key)) continue;
      skip.add(key);
      out.push(value);
      if (out.length >= ALIAS_CAP) return out;
    }
  }
  return out;
}

function pickSitelink(entity: RawEntity): { lang: WikiLang; title: string } | null {
  for (const [site, lang] of WIKI_SITES) {
    const title = entity.sitelinks?.[site]?.title;
    if (typeof title !== "string") continue;
    const clean = title.trim();
    if (!clean || clean.length > 300 || /[|\n\r]/.test(clean)) continue;
    return { lang, title: clean };
  }
  return null;
}

function wikiUrl(lang: WikiLang, title: string): string {
  return `https://${lang}.wikipedia.org/wiki/${encodeURI(title.replace(/ /g, "_"))}`;
}

function domainOf(
  qid: string,
  p31: string[],
  classes: Record<string, Domain[]> | undefined,
): Domain {
  const found = new Set<Domain>();
  for (const domain of classes?.[qid] ?? []) found.add(domain);
  for (const id of p31) {
    const domain = CLASS_DOMAIN[id];
    if (domain) found.add(domain);
  }
  if (found.size === 1) return [...found][0]!;
  return "Multi";
}

function originOf(entity: RawEntity): string {
  for (const id of claimIds(entity, "P495")) {
    const iso = COUNTRY_ISO[id];
    if (iso) return iso;
  }
  return "??";
}

function operatorCodes(entity: RawEntity, related: Record<string, RawEntity>): string[] {
  const codes: string[] = [];
  for (const id of claimIds(entity, "P137")) {
    const direct = COUNTRY_ISO[id];
    const iso = direct ?? countryOf(related[id]);
    if (iso && !codes.includes(iso)) codes.push(iso);
  }
  return codes;
}

function countryOf(entity: RawEntity | undefined): string | undefined {
  if (!entity) return undefined;
  for (const id of claimIds(entity, "P17")) {
    const iso = COUNTRY_ISO[id];
    if (iso) return iso;
  }
  return undefined;
}

function manufacturerOf(entity: RawEntity, related: Record<string, RawEntity>): string | undefined {
  for (const id of claimIds(entity, "P176")) {
    const name = entityLabel(related[id]);
    if (name) return name.slice(0, 200);
  }
  return undefined;
}

function entityLabel(entity: RawEntity | undefined): string | undefined {
  if (!entity) return undefined;
  return (
    textAt(entity.labels, "en") ||
    textAt(entity.labels, "uk") ||
    textAt(entity.labels, "ru") ||
    undefined
  );
}

interface RawEntity {
  missing?: unknown;
  labels?: Record<string, { value?: unknown }>;
  descriptions?: Record<string, { value?: unknown }>;
  aliases?: Record<string, unknown>;
  claims?: Record<string, unknown>;
  sitelinks?: Record<string, { title?: unknown }>;
}

interface WikiExtract {
  extract: string;
  revid: number;
  title: string;
}

function claimIds(entity: RawEntity, prop: string): string[] {
  const claims = entity.claims?.[prop];
  if (!Array.isArray(claims)) return [];
  const usable = claims.filter((c) => asRecord(c)?.rank !== "deprecated");
  const preferred = usable.filter((c) => asRecord(c)?.rank === "preferred");
  const ids: string[] = [];
  for (const claim of preferred.length ? preferred : usable) {
    const id = asRecord(asRecord(asRecord(asRecord(claim)?.mainsnak)?.datavalue)?.value)?.id;
    if (typeof id === "string" && isQid(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function textAt(bag: Record<string, { value?: unknown }> | undefined, lang: string): string {
  const value = bag?.[lang]?.value;
  return typeof value === "string" ? value.trim() : "";
}

function aliasValues(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const value = asRecord(item)?.value;
    if (typeof value === "string" && value.trim()) out.push(value.trim());
  }
  return out;
}

function readEntities(payload: unknown): Record<string, RawEntity> {
  const body = asRecord(payload);
  const bag = asRecord(body?.entities) ?? (body && !body.results && !body.query ? body : {});
  const out: Record<string, RawEntity> = {};
  for (const [key, value] of Object.entries(bag)) {
    if (value && typeof value === "object") out[key] = value as RawEntity;
  }
  return out;
}

function indexExtracts(payload: unknown): Map<string, WikiExtract> {
  const map = new Map<string, WikiExtract>();
  const query = asRecord(asRecord(payload)?.query);
  const pages = query?.pages;
  const list = Array.isArray(pages)
    ? pages
    : pages && typeof pages === "object"
      ? Object.values(pages)
      : [];
  for (const page of list) {
    const row = asRecord(page);
    if (!row || row.missing !== undefined) continue;
    const title = typeof row.title === "string" ? row.title : "";
    if (!title) continue;
    const revisions = Array.isArray(row.revisions) ? row.revisions : [];
    const revid = asRecord(revisions[0])?.revid;
    map.set(title, {
      title,
      extract: typeof row.extract === "string" ? row.extract : "",
      revid: typeof revid === "number" ? revid : 0,
    });
  }
  const hop = new Map<string, string>();
  for (const key of ["normalized", "redirects"] as const) {
    const rows = query?.[key];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const from = asRecord(row)?.from;
      const to = asRecord(row)?.to;
      if (typeof from === "string" && typeof to === "string") hop.set(from, to);
    }
  }
  for (const [from, to] of hop) {
    const dest = map.get(to) ?? map.get(hop.get(to) ?? "");
    if (dest && !map.has(from)) map.set(from, dest);
  }
  return map;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}
