import type { ExtractedSpec } from "@/entities/drone/types";
import { ExtractedSpecSchema } from "@/shared/contracts/extraction.schema";
import type { AddSpec } from "./extractors/common";
import { extractCuas } from "./extractors/cuas";
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
import { extractContractValue, extractUnitPrice } from "./pricing";

export interface Facts extends ObservationSink {
  specs: ExtractedSpec[];
}

/**
 * Spec extractors, run in order. Order matters only for display order and first-wins dedupe;
 * add a new system class (e.g. USV) by appending one entry.
 */
export const SPEC_EXTRACTORS: Array<(raw: string, add: AddSpec) => void> = [
  extractUav,
  extractUgv,
  extractCuas,
  extractShorad,
  extractStructure,
];

/** Unit price, else contract-scale value under its own key - never mixed. */
function extractMoney(raw: string, add: AddSpec) {
  const priced = extractUnitPrice(raw);
  if (priced) return add("unit_cost", "Unit Cost / Price", priced.value, undefined, priced.evidence);
  const deal = extractContractValue(raw);
  if (deal) add("contract_value", "Contract value", deal.value, undefined, deal.evidence);
}

/** Every heuristic fact in `raw`: spec claims plus payload, sensor, component and guidance observations. */
export function extractFacts(raw: string): Facts {
  const facts: Facts = { specs: [], payloads: [], sensors: [], components: [], guidance: [] };
  const seen = new Set<string>();
  const add: AddSpec = (key, label, value, unit, evidence) => {
    const token = `${key}|${String(value)}|${unit ?? ""}|${evidence}`;
    if (seen.has(token)) return;
    // Same boundary as AI output: a malformed spec is skipped, not the whole extraction.
    const spec = { key, label, value, ...(unit ? { unit } : {}), raw: evidence, evidence };
    if (!ExtractedSpecSchema.safeParse(spec).success) return;
    seen.add(token);
    facts.specs.push(spec);
  };

  for (const x of SPEC_EXTRACTORS) x(raw, add);
  extractCountedEquipment(raw, add, facts);
  extractSensors(raw, facts);
  extractGuidance(raw, add, facts);
  extractPropulsion(raw, facts);
  extractMoney(raw, add);
  facts.guidance = [...new Set(facts.guidance)];
  return facts;
}
