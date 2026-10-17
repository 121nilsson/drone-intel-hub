import type { ExtractedSpec } from "@/entities/drone/types";
import { parseNumber } from "@/entities/normalization/numeric";
import { semanticKeyFor } from "@/entities/normalization/semantic";
import { ExtractedSpecSchema } from "@/shared/contracts/extraction.schema";
import { type Money } from "@/entities/normalization/currency";
import { NUMBER, type AddSpec } from "./extractors/common";
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
import { extractUsv } from "./extractors/usv";
import {
  extractContractValue,
  extractPriceNumeric,
  extractUnitPrice,
} from "./pricing";

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
function extractMoney(raw: string, add: AddSpec) {
  const priced = extractPriceNumeric(raw);
  if (priced) {
    const money = priced as Money;
    add(
      "unit_cost",
      "Unit Cost / Price",
      money.amount,
      undefined,
      `${money.amount} ${money.currency}`,
    );
    return;
  }
  const deal = extractContractValue(raw);
  if (deal) add("contract_value", "Contract value", deal.value, undefined, deal.evidence);
}

/** Fiber-spool length ("recoiled 30 km of fiber"); a spec claim, so the same schema gate. */
function extractFiberSpool(raw: string, add: AddSpec) {
  const fiber = raw.match(new RegExp(`(${NUMBER})\\s*km\\s+(?:of\\s+)?(?:fiber|fibre|spool)`, "i"));
  if (fiber?.[1])
    add("fiber_spool", "Fiber spool length", parseNumber(fiber[1]) ?? Number.NaN, "km", fiber[0]);
}

/** Every heuristic fact in `raw`: spec claims plus payload, sensor, component and guidance observations. */
export function extractFacts(raw: string): Facts {
  const facts: Facts = { specs: [], payloads: [], sensors: [], components: [], guidance: [] };
  const seen = new Set<string>();
  const add: AddSpec = (key, label, value, unit, evidence) => {
    const token = `${key}|${String(value)}|${unit ?? ""}|${evidence}`;
    if (seen.has(token)) return;
    // Same boundary as AI output: a malformed spec is skipped, not the whole extraction.
    const semantic = semanticKeyFor(key, label);
    const spec = {
      key,
      label,
      value,
      ...(unit ? { unit } : {}),
      ...(semantic !== key ? { semantic } : {}),
      raw: evidence,
      evidence,
    };
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
  extractFiberSpool(raw, add);
  facts.guidance = [...new Set(facts.guidance)];
  return facts;
}
