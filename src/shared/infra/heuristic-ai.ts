import type { Domain, Drone, Extraction, SystemExtraction } from "@/entities/drone/types";
import type { BriefingSummarizer, IntelExtractor } from "@/shared/contracts/ai";
import { extractFacts, extractRfBands, mentionsName, resolveSystems } from "./heuristics";

/**
 * Local heuristic IntelExtractor. Orchestration only: names live in ./heuristics/names,
 * facts in ./heuristics/facts and its extractors, vocabulary in @/shared/lexicons.
 */
export {
  detectNames,
  extractContractValue,
  extractPrice,
  extractUnitPrice,
  mentions,
  mentionsName,
  resolveSystems,
} from "./heuristics";

function contextForSystem(raw: string, name: string): string {
  const clauses = raw.split(/(?<=[.!?;\n])\s+/);
  const hits = clauses.filter((clause) => mentionsName(clause, name));
  return hits.join(" ");
}

function scan(raw: string, catalog: Drone[], deep: boolean): Extraction {
  const t = raw.toLowerCase();
  const facts = extractFacts(raw);
  const specs = facts.specs;
  const rfBands = extractRfBands(raw);
  const domain: Domain | undefined = /usv|boat|naval|sea drone|maritime/.test(t)
    ? "Sea"
    : /ugv|tracked|ground robot/.test(t)
      ? "Land"
      : /uav|fpv|drone|loitering|wing|interceptor|bomber/.test(t)
        ? "Air"
        : undefined;
  const origin = /russia|russian|рос(?:сия)?|москва/.test(t)
    ? "RU"
    : /ukraine|україна|украина|укр/.test(t)
      ? "UA"
      : /iran|иран/.test(t)
        ? "IR"
        : /china|китай/.test(t)
          ? "CN"
          : /turkey|türkiye|turkiye|турция/.test(t)
            ? "TR"
            : /israel/.test(t)
              ? "IL"
              : undefined;

  const systems = resolveSystems(raw, catalog);
  const matched = systems.filter((s) => s.matchId);
  const novel = systems.filter((s) => !s.matchId);
  // Single unambiguous catalog match only when no new/variant system is the subject
  const matchId = matched.length === 1 && novel.length === 0 ? matched[0]!.matchId : undefined;
  const primary = novel[0] ?? matched[0];

  let confidence =
    0.2 +
    specs.length * 0.1 +
    (domain ? 0.1 : 0) +
    (matchId ? 0.3 : 0) +
    (rfBands.length ? 0.08 : 0);
  if (systems.length > 1) confidence -= 0.1;
  if (deep) confidence += 0.1;
  confidence = Math.max(0.05, Math.min(0.97, confidence));
  const variants = novel
    .filter((s) => s.variantOf)
    .map((s) => `${s.name} (variant of ${s.variantOf})`);
  const systemExtractions: SystemExtraction[] = systems.map((system) => {
    const context = contextForSystem(raw, system.name);
    const local = context
      ? extractFacts(context)
      : { specs: [], payloads: [], sensors: [], components: [], guidance: [] };
    return {
      ...system,
      specs: systems.length === 1 ? specs : local.specs,
      rfBands: systems.length === 1 ? rfBands : extractRfBands(context),
      payloads: systems.length === 1 ? facts.payloads : local.payloads,
      sensors: systems.length === 1 ? facts.sensors : local.sensors,
      components: systems.length === 1 ? facts.components : local.components,
      guidance: systems.length === 1 ? facts.guidance : local.guidance,
      confidence: Math.max(0.05, Math.min(0.97, confidence - (systems.length > 1 ? 0.1 : 0))),
      rationale: context
        ? "Facts attributed from the clause naming this system."
        : "Identity detected; facts require attribution.",
    };
  });
  return {
    ...(primary ? { name: primary.name } : {}),
    aliases: [],
    ...(domain ? { domain } : {}),
    ...(origin ? { origin } : {}),
    operators: origin ? [origin] : [],
    specs,
    rfBands,
    systems,
    systemExtractions,
    components: facts.components,
    payloads: facts.payloads,
    sensors: facts.sensors,
    guidance: facts.guidance,
    ...(matchId ? { matchId } : {}),
    confidence,
    rationale: `${deep ? "Tier 2 reasoning" : "Tier 1 screening"}: ${systems.length} system(s) detected, ${specs.length} specs, ${rfBands.length} RF refs${matchId ? `, matched ${matchId}` : ""}${variants.length ? `; new variant: ${variants.join(", ")}` : ""}.`,
    metadata: {
      schemaVersion: 2,
      engine: "heuristic",
      analyzedAt: new Date().toISOString(),
    },
  };
}

export class HeuristicExtractor implements IntelExtractor {
  readonly label: string;
  constructor(readonly tier: 1 | 2) {
    this.label = tier === 1 ? "Local screener" : "Local deep matcher";
  }
  async extract(raw: string, catalog: Drone[]) {
    return scan(raw, catalog, this.tier === 2);
  }
}

export class HeuristicSummarizer implements BriefingSummarizer {
  async summarize(context: string) {
    return `Automated digest (local engine — connect an AI provider in Settings for narrative analysis).\n\n${context}`;
  }
}
