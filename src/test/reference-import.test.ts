import { describe, expect, it } from "vitest";
import { SEED_DRONES } from "@/entities/drone/seed";
import type { Drone, ReferenceCard } from "@/entities/drone/types";
import { applyReference } from "@/features/catalog/reference-import";
import {
  buildReferenceCards,
  classSparql,
  parseSparqlIds,
  REFERENCE_LIMIT,
  truncateSummary,
} from "@/shared/infra/wikipedia";
import { fetchReferenceCatalog } from "@/shared/infra/wikipedia.server";

const NOW = "2026-01-01T00:00:00.000Z";
const LATER = "2026-02-01T00:00:00.000Z";

const geran = SEED_DRONES.find((d) => d.id === "geran-2")!;

function card(
  over: Partial<ReferenceCard> & Pick<ReferenceCard, "wikidataId" | "name">,
): ReferenceCard {
  return {
    aliases: [],
    domain: "Air",
    origin: "IR",
    operators: ["RU"],
    summary: "Lead paragraph from Wikipedia.",
    lang: "en",
    title: over.name,
    revisionId: 10,
    url: `https://en.wikipedia.org/wiki/${encodeURI(over.name.replace(/ /g, "_"))}`,
    ...over,
  };
}

describe("applyReference", () => {
  it("enriches seed Geran-2 from Shahed-136 and keeps a later Geran-2 id on the same card", () => {
    const shahed = card({
      wikidataId: "Q111",
      name: "Shahed 136",
      cyrillic: "Герань-2",
      aliases: ["Shahed-136"],
      summary: "A much longer encyclopedia lead that must not replace the seed summary.",
      operators: ["RU", "UA"],
    });
    const later = card({ wikidataId: "Q222", name: "Geran-2", aliases: ["Герань"] });
    const report = applyReference([geran], [shahed, later], NOW);

    expect(report.created).toBe(0);
    expect(report.enriched).toBe(1);
    expect(report.linked).toBe(1);
    expect(report.changed).toHaveLength(1);
    const next = report.changed[0]!;
    expect(next.id).toBe("geran-2");
    expect(next.reference?.wikidataId).toBe("Q111");
    expect(next.reference?.alsoIds).toEqual(["Q222"]);
    expect(next.summary).toBe(geran.summary);
    expect(next.operators).toEqual(["RU"]);
    expect(next.origin).toBe("IR");
    expect(next.propulsion).toBe(geran.propulsion);
    expect(next.specs).toBe(geran.specs);
    expect(next.rf).toBe(geran.rf);
    expect(next.components).toBe(geran.components);
    expect(next.cyrillic).toBe("Герань-2");
    expect(geran.reference).toBeUndefined();

    const again = applyReference([next], [shahed, later], LATER);
    expect(again.skipped).toBe(2);
    expect(again.changed).toEqual([]);
    expect(next.updatedAt).toBe(NOW);
  });

  it("links the Wikidata label HESA Shahed 136 through its Geran-2 alias", () => {
    const report = applyReference(
      [geran],
      [
        card({
          wikidataId: "Q109044360",
          name: "HESA Shahed 136",
          cyrillic: "Шахед 136",
          aliases: ["Shahed-136", "Geran-2", "Shahed"],
          summary: "Encyclopedia lead that must not replace the seed summary.",
        }),
      ],
      NOW,
    );
    expect(report.created).toBe(0);
    expect(report.enriched).toBe(1);
    expect(report.changed[0]!.id).toBe("geran-2");
    expect(report.changed[0]!.summary).toBe(geran.summary);
    expect(report.changed[0]!.reference?.wikidataId).toBe("Q109044360");
  });

  it("keeps Shahed-238 separate when the only overlap is the shared alias Shahed", () => {
    const report = applyReference(
      [geran],
      [card({ wikidataId: "Q333", name: "Shahed-238", aliases: ["Shahed"], origin: "IR" })],
      NOW,
    );
    expect(report.created).toBe(1);
    expect(report.enriched).toBe(0);
    expect(report.linked).toBe(0);
    expect(report.changed).toHaveLength(1);
    expect(report.changed[0]!.id).toBe("shahed-238");
    expect(report.changed[0]!.name).toBe("Shahed-238");
    expect(report.changed[0]!.aliases).toContain("Shahed");
    expect(report.changed[0]!.propulsion).toBe("Unknown");
    expect(report.changed[0]!.specs).toEqual([]);
  });

  it("fills an empty summary and leaves a written summary in place", () => {
    // exactOptionalPropertyTypes forbids explicit `undefined` on optional properties, so
    // the three fields are destructured out of the seed instead of overridden.
    const { cyrillic, manufacturer, reference, ...geranBase } = geran;
    void cyrillic;
    void manufacturer;
    void reference;
    const empty: Drone = {
      ...geranBase,
      id: "blank",
      name: "Blank",
      aliases: [],
      summary: "  ",
      operators: [],
      origin: "??",
      specs: [],
    };
    const filled = applyReference(
      [empty],
      [
        card({
          wikidataId: "Q444",
          name: "Blank",
          summary: "Filled from the lead.",
          origin: "UA",
          operators: ["UA"],
          manufacturer: "Ukrspecsystems",
        }),
      ],
      NOW,
    );
    expect(filled.enriched).toBe(1);
    expect(filled.changed[0]!.summary).toBe("Filled from the lead.");
    expect(filled.changed[0]!.origin).toBe("UA");
    expect(filled.changed[0]!.operators).toEqual(["UA"]);
    expect(filled.changed[0]!.manufacturer).toBe("Ukrspecsystems");

    const kept = applyReference(
      [geran],
      [card({ wikidataId: "Q111", name: "Shahed 136", summary: "Replacement lead." })],
      NOW,
    );
    expect(kept.changed[0]!.summary).toBe(geran.summary);
  });

  it("does not rewrite a drone when the same revision is imported again", () => {
    const source = card({ wikidataId: "Q555", name: "Orlan-10", revisionId: 4 });
    const first = applyReference([], [source], NOW);
    expect(first.created).toBe(1);
    const second = applyReference(first.changed, [source], LATER);
    expect(second.skipped).toBe(1);
    expect(second.changed).toEqual([]);
    expect(first.changed[0]!.updatedAt).toBe(NOW);
    expect(first.changed[0]!.reference?.revisionId).toBe(4);
  });
});

describe("wikipedia reference parser", () => {
  it("rejects a QID that is not Q plus digits and ignores sitelinks outside en, ru, and uk", () => {
    const built = buildReferenceCards({
      entities: {
        entities: {
          "not-a-qid": { labels: { en: { value: "Ignored" } } },
          Qx: { labels: { en: { value: "Also ignored" } } },
          Q1: {
            labels: { en: { value: "Shahed 136" }, ru: { value: "Герань-2" } },
            aliases: { en: [{ value: "Shahed-136" }, { value: "Moped" }] },
            descriptions: { en: { value: "Short description." } },
            claims: {
              P31: [{ rank: "normal", mainsnak: { datavalue: { value: { id: "Q15832656" } } } }],
              P495: [{ rank: "normal", mainsnak: { datavalue: { value: { id: "Q794" } } } }],
              P137: [{ rank: "normal", mainsnak: { datavalue: { value: { id: "Q159" } } } }],
              P176: [{ rank: "normal", mainsnak: { datavalue: { value: { id: "Q999" } } } }],
            },
            sitelinks: {
              frwiki: { title: "Shahed français" },
              enwiki: { title: "HESA Shahed 136" },
            },
          },
          Q2: {
            labels: { en: { value: "French only" } },
            sitelinks: { frwiki: { title: "Page française" } },
          },
        },
      },
      related: {
        entities: {
          Q999: { labels: { en: { value: "HESA" } } },
        },
      },
      extracts: {
        en: {
          query: {
            pages: [
              {
                title: "HESA Shahed 136",
                extract: "The HESA Shahed 136 is a loitering munition.",
                revisions: [{ revid: 42 }],
              },
            ],
          },
        },
      },
    });

    expect(built.skipped).toBe(2);
    expect(built.cards.map((c) => c.wikidataId)).toEqual(["Q1", "Q2"]);
    const shahed = built.cards[0]!;
    expect(shahed.url).toBe("https://en.wikipedia.org/wiki/HESA_Shahed_136");
    expect(shahed.title).toBe("HESA Shahed 136");
    expect(shahed.revisionId).toBe(42);
    expect(shahed.summary).toBe("The HESA Shahed 136 is a loitering munition.");
    expect(shahed.cyrillic).toBe("Герань-2");
    expect(shahed.origin).toBe("IR");
    expect(shahed.operators).toEqual(["RU"]);
    expect(shahed.manufacturer).toBe("HESA");
    expect(shahed.domain).toBe("Air");
    expect(shahed.aliases).toEqual(["Moped"]);
    expect(built.cards[1]!.url).toBe("https://www.wikidata.org/wiki/Q2");
  });

  it("drops SPARQL bindings that are not Wikidata item ids", () => {
    const parsed = parseSparqlIds({
      results: {
        bindings: [
          { item: { value: "http://www.wikidata.org/entity/Q123" } },
          { item: { value: "http://www.wikidata.org/entity/P31" } },
          { item: { value: "http://evil.example/Q1" } },
          { item: { value: "not a url" } },
        ],
      },
    });
    expect(parsed.ids).toEqual(["Q123"]);
    expect(parsed.rejected).toBe(3);
  });

  it("selects Ukraine and Russia vehicles by operator, origin, or country", () => {
    const query = classSparql("Q484000");
    expect(query).toContain("wd:Q484000");
    expect(query).toContain("wd:Q212");
    expect(query).toContain("wd:Q159");
    expect(query).toContain("wdt:P137");
    expect(query).toContain("wdt:P495");
    expect(query).toContain("wdt:P17");
    expect(query).toContain("wdt:P279");
    expect(query).toContain(`LIMIT ${REFERENCE_LIMIT}`);
    expect(() => classSparql("nope")).toThrow();
  });

  it("skips a Wikipedia category item", () => {
    const built = buildReferenceCards({
      entities: {
        entities: {
          Q9: {
            labels: { en: { value: "Category:Supercam S350" } },
            claims: {
              P31: [{ rank: "normal", mainsnak: { datavalue: { value: { id: "Q4167836" } } } }],
            },
          },
        },
      },
    });
    expect(built.cards).toEqual([]);
    expect(built.skipped).toBe(1);
  });

  it("uses the item country when country of origin is absent", () => {
    const built = buildReferenceCards({
      entities: {
        entities: {
          Q5: {
            labels: { en: { value: "Supercam" } },
            claims: {
              P17: [{ rank: "normal", mainsnak: { datavalue: { value: { id: "Q159" } } } }],
            },
          },
        },
      },
    });
    expect(built.cards[0]!.origin).toBe("RU");
  });

  it("truncates a long lead on a word boundary", () => {
    const text = `${"word ".repeat(200)}tail`;
    const cut = truncateSummary(text, 50);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(51);
    expect(cut.includes("  ")).toBe(false);
  });
});

describe("fetchReferenceCatalog", () => {
  it("reads fixtures from the pinned hosts and skips a bad item id", async () => {
    const hosts: string[] = [];
    let sparql = 0;
    const fetchImpl = async (url: string) => {
      const parsed = new URL(url);
      hosts.push(parsed.host);
      if (parsed.host === "query.wikidata.org") {
        sparql++;
        const bindings = [{ item: { value: "http://www.wikidata.org/entity/Q1" } }];
        if (sparql === 1) bindings.push({ item: { value: "http://evil.example/Q9" } });
        return Response.json({ results: { bindings } });
      }
      if (parsed.host === "www.wikidata.org") {
        expect(parsed.searchParams.get("ids")).toBe("Q1");
        return Response.json({
          entities: {
            Q1: {
              labels: { en: { value: "Shahed 136" }, ru: { value: "Герань-2" } },
              claims: {
                P31: [{ rank: "normal", mainsnak: { datavalue: { value: { id: "Q15832656" } } } }],
                P137: [{ rank: "normal", mainsnak: { datavalue: { value: { id: "Q159" } } } }],
              },
              sitelinks: { enwiki: { title: "HESA Shahed 136" }, frwiki: { title: "Ignoré" } },
            },
          },
        });
      }
      if (parsed.host === "en.wikipedia.org") {
        return Response.json({
          query: {
            pages: [
              {
                title: "HESA Shahed 136",
                extract: "Iranian loitering munition.",
                revisions: [{ revid: 7 }],
              },
            ],
          },
        });
      }
      throw new Error(`unexpected host ${parsed.host}`);
    };

    const result = await fetchReferenceCatalog({ fetchImpl, pauseMs: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sparql).toBe(5);
    expect(new Set(hosts)).toEqual(
      new Set(["query.wikidata.org", "www.wikidata.org", "en.wikipedia.org"]),
    );
    expect(result.truncated).toBe(false);
    expect(result.skipped).toBe(1);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]!.summary).toBe("Iranian loitering munition.");
    expect(result.cards[0]!.revisionId).toBe(7);
    expect(result.cards[0]!.operators).toEqual(["RU"]);
  });

  it("retries a rate limit and then reads the catalog", async () => {
    let sparql = 0;
    const fetchImpl = async (url: string) => {
      const parsed = new URL(url);
      if (parsed.host === "query.wikidata.org") {
        sparql++;
        if (sparql === 1)
          return new Response("slow", { status: 429, headers: { "retry-after": "0" } });
        return Response.json({
          results: { bindings: [{ item: { value: "http://www.wikidata.org/entity/Q1" } }] },
        });
      }
      if (parsed.host === "www.wikidata.org") {
        return Response.json({
          entities: {
            Q1: {
              labels: { en: { value: "Orlan-10" } },
              sitelinks: { enwiki: { title: "Orlan-10" } },
            },
          },
        });
      }
      return Response.json({
        query: {
          pages: [{ title: "Orlan-10", extract: "Reconnaissance UAV.", revisions: [{ revid: 3 }] }],
        },
      });
    };
    const result = await fetchReferenceCatalog({ fetchImpl, pauseMs: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cards[0]!.name).toBe("Orlan-10");
    expect(sparql).toBe(6);
  });

  it("fails the import when a request fails", async () => {
    const fetchImpl = async () => new Response("no", { status: 503 });
    const result = await fetchReferenceCatalog({ fetchImpl, pauseMs: 0 });
    expect(result).toEqual({ ok: false, error: "HTTP 503 (query.wikidata.org)" });
  });
});
