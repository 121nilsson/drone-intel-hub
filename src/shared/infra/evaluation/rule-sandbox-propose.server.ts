import { db, dbConfigured } from "@/shared/infra/postgres/db.server";
import { compileRuleSnapshot, RULE_LANGUAGES, type RuleKind } from "@/shared/contracts/rules";
import { hypothesisId } from "@/shared/infra/evaluation/hypotheses";
import { json } from "@/shared/infra/evaluation/rule-sandbox-store.server";
import type { ProposeInput } from "@/shared/infra/evaluation/rule-sandbox-types.server";

export const KINDS: readonly RuleKind[] = [
  "add_cue",
  "context_filter",
  "add_alias",
  "add_stopword",
  "add_unit_scale",
];

/**
 * The key a rule aims at, from its payload, so analyst-written and generated rules of the same
 * aim share one trust category ("add_stopword:system_name", "add_cue:range").
 */
export function defaultTargetKey(kind: RuleKind, p: Record<string, unknown>): string | null {
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  if (kind === "add_stopword" || kind === "add_alias") return "system_name";
  if (kind === "add_cue") return s(p["target"] ?? p["semanticKey"]);
  if (kind === "context_filter") return s(p["key"] ?? p["semanticKey"]);
  if (kind === "add_unit_scale") return "cost.unit";
  return null;
}

export async function proposeRule(
  input: ProposeInput,
): Promise<{ ok: boolean; id?: string; reason?: string }> {
  if (!dbConfigured()) return { ok: false, reason: "no database configured" };
  if (!KINDS.includes(input.kind)) return { ok: false, reason: `unknown kind ${input.kind}` };
  const language = input.language ?? "all";
  if (!RULE_LANGUAGES.includes(language))
    return { ok: false, reason: `unknown language ${language}` };
  const id = hypothesisId(input.kind, input.payload);
  const row = { id, kind: input.kind, language, payload: input.payload };
  const compiled = compileRuleSnapshot([row]);
  if (compiled.invalid.includes(id)) return { ok: false, reason: "payload does not compile" };
  const origin = input.origin ?? "analyst";
  const targetKey = input.targetKey ?? defaultTargetKey(input.kind, input.payload);
  // Re-proposing a rejected or quarantined pattern does not resurrect it; a human must.
  await db()`
    insert into dynamic_rules (id, kind, language, payload, status, origin, target_key, rationale, evidence, decided_by)
    values (${id}, ${input.kind}, ${language}, ${json(input.payload)}, 'candidate', ${origin},
      ${targetKey}, ${input.rationale ?? null}, ${json(input.evidence ?? null)}, ${origin})
    on conflict (id) do nothing`;
  return { ok: true, id };
}
