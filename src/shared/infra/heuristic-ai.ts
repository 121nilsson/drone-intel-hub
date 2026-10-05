import type { Domain, Drone, ExtractedSpec, Extraction } from "@/entities/drone/types";
import type { BriefingSummarizer, IntelExtractor } from "@/shared/contracts/ai";
import { droneHaystack } from "./local-repository";

const num = (s: string) => parseFloat(s.replace(",", "."));

function scan(raw: string, catalog: Drone[], deep: boolean): Extraction {
  const t = raw.toLowerCase();
  const specs: ExtractedSpec[] = [];
  const grab = (re: RegExp, key: string, label: string, unit: string) => {
    const m = raw.match(re); if (m?.[1]) specs.push({ key, label, value: num(m[1]), unit });
  };
  grab(/(\d+(?:[.,]\d+)?)\s*km\/h/i, "speed", "Cruise speed", "km/h");
  grab(/range[^\d]{0,20}(\d+(?:[.,]\d+)?)\s*km/i, "range", "Range", "km");
  grab(/(\d+(?:[.,]\d+)?)\s*kg\b/i, "payload", "Payload", "kg");
  grab(/(\d+(?:[.,]\d+)?)\s*km\s+(?:of\s+)?(?:fiber|fibre|spool)/i, "fiber_spool", "Fiber spool length", "km");
  // Emergent attributes: "N jammers", "N cameras", "N missiles", ...
  for (const m of raw.matchAll(/(\d+)\s+(jammers?|cameras?|missiles?|rotors?|antennas?)/gi)) {
    const noun = m[2]!.toLowerCase().replace(/s$/, "");
    specs.push({ key: `${noun}s`, label: `Number of ${noun}s`, value: Number(m[1]) });
  }
  const rfBands = [...raw.matchAll(/(\d+(?:[.,]\d+)?)\s*(mhz|ghz)/gi)].map((m) => `${m[1]} ${m[2]!.toUpperCase()}`);
  if (/crpa|kometa/i.test(raw)) rfBands.push("CRPA");
  const domain: Domain | undefined = /usv|boat|naval|sea|maritime/.test(t) ? "Sea" : /ugv|tracked|ground robot|land/.test(t) ? "Land" : /uav|fpv|drone|loitering|wing/.test(t) ? "Air" : undefined;
  const origin = /russia|russian|рос/.test(t) ? "RU" : /ukrain|укр/.test(t) ? "UA" : /iran/.test(t) ? "IR" : undefined;

  let matchId: string | undefined; let best = 0;
  for (const d of catalog) {
    const names = [d.name, d.cyrillic ?? "", ...d.aliases].filter(Boolean).map((n) => n.toLowerCase());
    let score = names.some((n) => n.length > 2 && t.includes(n)) ? 1 : 0;
    if (!score && deep) {
      const tokens = droneHaystack(d).split(/[\s|/-]+/).filter((x) => x.length > 3);
      score = tokens.filter((x) => t.includes(x)).length / Math.max(tokens.length, 1);
    }
    if (score > best) { best = score; matchId = d.id; }
  }
  if (best < (deep ? 0.25 : 1)) matchId = undefined;
  const nameMatch = raw.match(/["«“]([^"»”]{2,40})["»”]/);
  const name = nameMatch?.[1];

  let confidence = 0.2 + specs.length * 0.12 + (domain ? 0.1 : 0) + (matchId ? 0.3 : 0) + (rfBands.length ? 0.08 : 0);
  if (deep) confidence += 0.15;
  confidence = Math.min(0.97, confidence);
  return {
    ...(name ? { name } : {}), aliases: [], ...(domain ? { domain } : {}), ...(origin ? { origin } : {}),
    operators: origin ? [origin] : [], specs, rfBands, ...(matchId ? { matchId } : {}), confidence,
    rationale: `${deep ? "Tier 2 reasoning" : "Tier 1 screening"}: ${specs.length} specs, ${rfBands.length} RF refs${matchId ? `, matched ${matchId}` : ""}.`,
  };
}

export class HeuristicExtractor implements IntelExtractor {
  readonly label: string;
  constructor(readonly tier: 1 | 2) { this.label = tier === 1 ? "Local screener" : "Local deep matcher"; }
  async extract(raw: string, catalog: Drone[]) { return scan(raw, catalog, this.tier === 2); }
}

export class HeuristicSummarizer implements BriefingSummarizer {
  async summarize(context: string) {
    return `Automated digest (local engine — connect an AI provider in Settings for narrative analysis).\n\n${context}`;
  }
}
