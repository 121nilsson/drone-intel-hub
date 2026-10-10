import type {
  Drone,
  ExtractedSpec,
  Extraction,
  PayloadObservation,
  SensorObservation,
  SupplyComponent,
  SystemExtraction,
} from "@/entities/drone/types";
import type { AIProviderSettings, BriefingSummarizer, IntelExtractor } from "@/shared/contracts/ai";
import { chatCompletion } from "./ai-proxy.functions";
import { chatCompletionOnce, type ChatTransport } from "./ai-proxy.server";
import {
  AIExtractionSchema,
  EXTRACTION_PROMPT_VERSION,
  EXTRACTION_SCHEMA_VERSION,
} from "@/shared/contracts/extraction.schema";
import { mentions } from "./heuristic-ai";
import extractionPrompt from "@/shared/contracts/extraction-prompt.json";

const EXTRACT_SYS = extractionPrompt.system;

export class OpenAICompatibleExtractor implements IntelExtractor {
  readonly label: string;
  /**
   * `chat` is injected so the same extractor works in both contexts: the browser passes the
   * server-function bridge (keeps the key off the client), while a scheduled task passes
   * `chatCompletionOnce` because server functions have no context outside a request.
   */
  constructor(
    readonly tier: 1 | 2,
    private cfg: AIProviderSettings,
    private chat: ChatTransport = (i) => chatCompletion({ data: i }),
  ) {
    this.label = tier === 1 ? cfg.tier1Model : cfg.tier2Model;
  }
  async extract(raw: string, catalog: Drone[], context?: Extraction): Promise<Extraction> {
    const named = catalog.filter((d) =>
      [d.name, d.cyrillic ?? "", ...d.aliases].some((name) => mentions(raw, name)),
    );
    const stems = new Set(
      [...raw.matchAll(/\b([\p{L}]{3,})-\p{N}+\w*\b/giu)].map((m) => m[1]!.toLowerCase()),
    );
    const likely = catalog.filter((d) =>
      [d.name, ...d.aliases].some((name) => stems.has(name.split("-")[0]!.toLowerCase())),
    );
    const shortlist = [...new Map([...named, ...likely].map((d) => [d.id, d])).values()].slice(
      0,
      30,
    );
    const index = shortlist
      .map((d) => `${d.id}: ${[d.name, d.cyrillic, ...d.aliases].filter(Boolean).join(" / ")}`)
      .join("\n");
    const r = await this.chat({
      baseUrl: this.cfg.baseUrl,
      apiKey: this.cfg.apiKey,
      model: this.tier === 1 ? this.cfg.tier1Model : this.cfg.tier2Model,
      system:
        EXTRACT_SYS +
        (this.tier === 2
          ? "\nThink carefully about ambiguous aliases and transliterations before matching."
          : ""),
      prompt: `Catalog candidates:\n${index || "(none)"}\n\nDeterministic observations:\n${
        context ? JSON.stringify(context) : "(none)"
      }\n\nReport:\n${raw}`,
      json: true,
      tier: this.tier === 1 ? "tier1" : "tier2",
    });
    if (!r.ok) throw new Error(r.error);
    const decoded: unknown = JSON.parse(r.content.replace(/^```json|```$/g, "").trim());
    const parsed = AIExtractionSchema.safeParse(decoded);
    if (!parsed.success)
      throw new Error(
        `Invalid extraction JSON: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`,
      );
    const j = parsed.data;
    const validId = (id: string | null | undefined) =>
      id && shortlist.some((d) => d.id === id) ? id : undefined;
    const systems = j.systems.map((s) => ({
      name: s.name,
      ...(validId(s.matchId) ? { matchId: validId(s.matchId)! } : {}),
      ...(validId(s.variantOf) ? { variantOf: validId(s.variantOf)! } : {}),
    }));
    const systemExtractions = j.systemExtractions.map(({ matchId, variantOf, ...s }) => ({
      ...s,
      ...(validId(matchId) ? { matchId: validId(matchId)! } : {}),
      ...(validId(variantOf) ? { variantOf: validId(variantOf)! } : {}),
    }));
    return {
      ...(j.name ? { name: j.name } : {}),
      aliases: j.aliases,
      ...(j.domain ? { domain: j.domain } : {}),
      ...(j.origin ? { origin: j.origin } : {}),
      ...(j.manufacturer ? { manufacturer: j.manufacturer } : {}),
      operators: j.operators,
      ...(j.propulsion ? { propulsion: j.propulsion } : {}),
      ...(j.installation ? { installation: j.installation } : {}),
      specs: j.specs as ExtractedSpec[],
      rfBands: j.rfBands,
      systems,
      systemExtractions: systemExtractions as SystemExtraction[],
      components: j.components as SupplyComponent[],
      payloads: j.payloads as PayloadObservation[],
      sensors: j.sensors as SensorObservation[],
      guidance: j.guidance,
      ...(validId(j.matchId) ? { matchId: validId(j.matchId)! } : {}),
      confidence: j.confidence,
      rationale: j.rationale,
      metadata: {
        schemaVersion: EXTRACTION_SCHEMA_VERSION,
        engine: "ai",
        model: this.tier === 1 ? this.cfg.tier1Model : this.cfg.tier2Model,
        promptVersion: EXTRACTION_PROMPT_VERSION,
        analyzedAt: new Date().toISOString(),
      },
    };
  }
}

export class OpenAICompatibleSummarizer implements BriefingSummarizer {
  constructor(
    private cfg: AIProviderSettings,
    private chat: ChatTransport = (i) => chatCompletion({ data: i }),
  ) {}
  async summarize(context: string) {
    const r = await this.chat({
      baseUrl: this.cfg.baseUrl,
      apiKey: this.cfg.apiKey,
      model: this.cfg.tier2Model,
      json: false,
      system:
        "Write a terse 4-6 sentence executive intelligence summary of weekly drone technology shifts. No preamble.",
      prompt: context,
      tier: "tier2",
    });
    if (!r.ok) throw new Error(r.error);
    return r.content;
  }
}
