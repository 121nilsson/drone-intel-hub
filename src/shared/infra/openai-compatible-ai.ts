import type { Drone, Extraction } from "@/entities/drone/types";
import type { AIProviderSettings, BriefingSummarizer, IntelExtractor } from "@/shared/contracts/ai";
import { chatCompletion } from "./ai-proxy.functions";

const EXTRACT_SYS = `You are a defense technical intelligence analyst. Extract drone system data from raw reports.
Reply in json with keys: name (string|null), aliases (string[]), domain ("Air"|"Land"|"Sea"|"Multi"|null), origin (ISO2|null), operators (ISO2[]), propulsion (string|null),
specs (array of {key: snake_case, label, value: number|string, unit|null}) — include ANY novel attribute (e.g. jammers count, fiber spool length),
rfBands (string[]), systems (array of {name, matchId: catalog id|null, variantOf: catalog id|null}) listing EVERY drone system mentioned (e.g. attacker and interceptor),
matchId (id from catalog or null), confidence (0..1), rationale (short).
Only match a catalog id when the name matches exactly; a different variant number (Geran-5 vs Geran-2) is a NEW system with variantOf set.
If a price/unit cost appears, add spec {key:"unit_cost", label:"Unit Cost / Price", value:"$15,000 - $20,000"}.`;

export class OpenAICompatibleExtractor implements IntelExtractor {
  readonly label: string;
  constructor(readonly tier: 1 | 2, private cfg: AIProviderSettings) {
    this.label = tier === 1 ? cfg.tier1Model : cfg.tier2Model;
  }
  async extract(raw: string, catalog: Drone[]): Promise<Extraction> {
    const index = catalog.map((d) => `${d.id}: ${[d.name, d.cyrillic, ...d.aliases].filter(Boolean).join(" / ")}`).join("\n");
    const r = await chatCompletion({ data: {
      baseUrl: this.cfg.baseUrl, apiKey: this.cfg.apiKey, model: this.tier === 1 ? this.cfg.tier1Model : this.cfg.tier2Model,
      system: EXTRACT_SYS + (this.tier === 2 ? "\nThink carefully about ambiguous aliases and transliterations before matching." : ""),
      prompt: `Catalog:\n${index}\n\nReport:\n${raw}`, json: true,
    } });
    if (!r.ok) throw new Error(r.error);
    const j = JSON.parse(r.content.replace(/^```json|```$/g, "").trim()) as Record<string, unknown>;
    const strs = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
    return {
      ...(j["name"] ? { name: String(j["name"]) } : {}),
      aliases: strs(j["aliases"]),
      ...(j["domain"] ? { domain: j["domain"] as Extraction["domain"] & string } : {}),
      ...(j["origin"] ? { origin: String(j["origin"]) } : {}),
      operators: strs(j["operators"]),
      ...(j["propulsion"] ? { propulsion: String(j["propulsion"]) } : {}),
      specs: Array.isArray(j["specs"]) ? (j["specs"] as Record<string, unknown>[]).map((s) => ({
        key: String(s["key"]), label: String(s["label"] ?? s["key"]), value: s["value"] as number | string, ...(s["unit"] ? { unit: String(s["unit"]) } : {}),
      })) : [],
      rfBands: strs(j["rfBands"]),
      systems: Array.isArray(j["systems"]) ? (j["systems"] as Record<string, unknown>[]).filter((s) => s["name"]).map((s) => ({
        name: String(s["name"]),
        ...(s["matchId"] && catalog.some((d) => d.id === s["matchId"]) ? { matchId: String(s["matchId"]) } : {}),
        ...(s["variantOf"] ? { variantOf: String(s["variantOf"]) } : {}),
      })) : [],
      ...(j["matchId"] && catalog.some((d) => d.id === j["matchId"]) ? { matchId: String(j["matchId"]) } : {}),
      confidence: Math.max(0, Math.min(1, Number(j["confidence"]) || 0)),
      rationale: String(j["rationale"] ?? ""),
    };
  }
}

export class OpenAICompatibleSummarizer implements BriefingSummarizer {
  constructor(private cfg: AIProviderSettings) {}
  async summarize(context: string) {
    const r = await chatCompletion({ data: {
      baseUrl: this.cfg.baseUrl, apiKey: this.cfg.apiKey, model: this.cfg.tier2Model, json: false,
      system: "Write a terse 4-6 sentence executive intelligence summary of weekly drone technology shifts. No preamble.",
      prompt: context,
    } });
    if (!r.ok) throw new Error(r.error);
    return r.content;
  }
}
