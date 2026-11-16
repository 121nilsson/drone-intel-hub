import type { SandboxResult } from "@/shared/infra/evaluation/sandbox";
import { iso, rulesRepo } from "@/shared/infra/evaluation/rule-sandbox-store.server";
import type { Json, RuleView } from "@/shared/infra/evaluation/rule-sandbox-types.server";

export async function listRules(limit = 100): Promise<RuleView[]> {
  const rows = await rulesRepo().ruleListRows(limit);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    language: r.language,
    payload: (r.payload ?? {}) as { [k: string]: Json },
    status: r.status,
    origin: r.origin,
    targetKey: r.targetKey,
    rationale: r.rationale,
    evidence: (r.evidence ?? null) as Json,
    createdAt: iso(r.createdAt)!,
    promotedAt: iso(r.promotedAt),
    shadow: (r.shadowMetrics as RuleView["shadow"]) ?? null,
    lastEvaluation: r.evalReport
      ? {
          ...(r.evalReport as SandboxResult),
          evaluatedAt: iso(r.evalAt)!,
          rulesVersion: r.evalVersion,
        }
      : null,
  }));
}
