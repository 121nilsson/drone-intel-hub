import type { ExtractedSpec } from "@/entities/drone/types";
import { parseNumber } from "@/entities/normalization/numeric";
import { parseMoney } from "@/entities/normalization/currency";
import { semanticKeyFor } from "@/entities/normalization/semantic";
import { ExtractedSpecSchema } from "@/shared/contracts/extraction.schema";
import { type Money } from "@/entities/normalization/currency";
import type { RuleSnapshot } from "@/shared/contracts/rules";
import { NUMBER, type AddSpec } from "./extractors/common";
import { extractCuas } from "./extractors/cuas";
import { applyContextFilters, extractDynamicCues } from "./extractors/dynamic";
import {
  extractCountedEquipment,
  extractGuidance,
  extractPropulsion,
  extractSensors,
  type ObservationSink,
} from "./extractors/observations";
import { extractShorad } from "./extractors/shorad";
import { extractStructure } from "./extractors/structure";
import { extractUav } from "./extractors/uav";
import { extractUgv } from "./extractors/ugv";
import { extractUsv } from "./extractors/usv";
import { extractContractValue, extractPriceNumeric, extractUnitPrice } from "./pricing";

export interface Facts extends ObservationSink {
  specs: ExtractedSpec[];
}

/**
 * Spec extractors, run in order. Order matters only for display order and first-wins dedupe;
 * add a new system class by appending one entry.
 */
export const SPEC_EXTRACTORS: Array<(raw: string, add: AddSpec) => void> = [
  extractUav,
  extractUgv,
  extractUsv,
  extractCuas,
  extractShorad,
  extractStructure,
];

/** Unit price, else contract-scale value under its own key - never mixed. */
function extractMoney(raw: string, add: AddSpec, scales: RuleSnapshot["scales"] = []) {
  const unit = extractUnitPrice(raw, scales);
  if (unit) {
    const money = parseMoney(unit.value, scales);
    if (money) {
      add("unit_cost", "Unit Cost / Price", money.amount, undefined, unit.evidence);
      return;
    }
  }
  const deal = extractContractValue(raw, scales);
  if (deal) add("contract_value", "Contract value", deal.value, undefined, deal.evidence);
}

/** Fiber-spool length ("recoiled 30 km of fiber"); a spec claim, so the same schema gate. */
function extractFiberSpool(raw: string, add: AddSpec) {
  const fiber = raw.match(new RegExp(`(${NUMBER})\\s*km\\s+(?:of\\s+)?(?:fiber|fibre|spool)`, "i"));
  if (fiber?.[1])
    add("fiber_spool", "Fiber spool length", parseNumber(fiber[1]) ?? Number.NaN, "km", fiber[0]);
}

function buildSpec(
  key: string,
  label: string,
  value: number | string,
  unit: string | undefined,
  evidence: string,
): ExtractedSpec {
  const semantic = semanticKeyFor(key, label);
  return {
    key,
    label,
    value,
    ...(unit ? { unit } : {}),
    ...(semantic !== key ? { semantic } : {}),
    raw: evidence,
    evidence,
  };
}

/** Re-key a claim (context-filter reroute); the label follows the key so semantics agree. */
const relabel = (s: ExtractedSpec, key: string) =>
  buildSpec(key, key.replace(/_/g, " "), s.value, s.unit, s.evidence ?? s.raw ?? "");

/**
 * Every heuristic fact in `raw`: spec claims plus payload, sensor, component and guidance
 * observations. `rules` adds dynamic cue vocabulary and context filters on top of the static
 * lexicons; without it the output is exactly the static engine's.
 */
export function extractFacts(raw: string, rules?: RuleSnapshot): Facts {
  const facts: Facts = { specs: [], payloads: [], sensors: [], components: [], guidance: [] };
  const seen = new Set<string>();
  const add: AddSpec = (key, label, value, unit, evidence) => {
    const token = `${key}|${String(value)}|${unit ?? ""}|${evidence}`;
    if (seen.has(token)) return;
    // Same boundary as AI output: a malformed spec is skipped, not the whole extraction.
    const spec = buildSpec(key, label, value, unit, evidence);
    if (!ExtractedSpecSchema.safeParse(spec).success) return;
    seen.add(token);
    facts.specs.push(spec);
  };

  for (const x of SPEC_EXTRACTORS) x(raw, add);
  if (rules?.cues.length) {
    // A dynamic cue only fills gaps: a figure a static cue already read is not restated.
    const known = (key: string, value: number | string, unit?: string) =>
      facts.specs.some((s) => s.key === key && s.value === value && s.unit === unit);
    extractDynamicCues(
      raw,
      (key, label, value, unit, evidence) => {
        if (!known(key, value, unit)) add(key, label, value, unit, evidence);
      },
      rules.cues,
    );
  }
  extractCountedEquipment(raw, add, facts);
  extractSensors(raw, facts);
  extractGuidance(raw, add, facts);
  extractPropulsion(raw, facts);
  extractMoney(raw, add, rules?.scales);
  extractFiberSpool(raw, add);
  if (rules?.filters.length)
    facts.specs = applyContextFilters(raw, facts.specs, rules.filters, relabel);
  facts.guidance = [...new Set(facts.guidance)];
  return facts;
}
