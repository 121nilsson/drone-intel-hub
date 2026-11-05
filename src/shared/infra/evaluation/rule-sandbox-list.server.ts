import { db, dbConfigured } from "@/shared/infra/postgres/db.server";
import type { SandboxResult } from "@/shared/infra/evaluation/sandbox";
import { iso } from "@/shared/infra/evaluation/rule-sandbox-store.server";
import type { Json, RuleView } from "@/shared/infra/evaluation/rule-sandbox-types.server";

export async function listRules(limit = 100): Promise<RuleView[]> {
  if (!dbConfigured()) return [];
  const rows = await db()`
    select r.*, e.report as eval_report, e.evaluated_at as eval_at, e.rules_version as eval_version
    from dynamic_rules r
    left join lateral (
      select report, evaluated_at, rules_version from rule_evaluations
      where rule_id = r.id order by evaluated_at desc limit 1
    ) e on true
    order by case r.status when 'candidate_passed' then 0 when 'shadow' then 1
      when 'active' then 2 when 'candidate' then 3 else 4 end, r.created_at desc
    limit ${limit}`;
  return rows.map((r) => ({
    id: r["id"] as string,
    kind: r["kind"] as string,
    language: r["language"] as string,
    payload: (r["payload"] ?? {}) as { [k: string]: Json },
    status: r["status"] as string,
    origin: r["origin"] as string,
    targetKey: (r["target_key"] as string | null) ?? null,
    rationale: (r["rationale"] as string | null) ?? null,
    evidence: (r["evidence"] ?? null) as Json,
    createdAt: iso(r["created_at"])!,
    promotedAt: iso(r["promoted_at"]),
    shadow: (r["shadow_metrics"] as RuleView["shadow"]) ?? null,
    lastEvaluation: r["eval_report"]
      ? {
          ...(r["eval_report"] as SandboxResult),
          evaluatedAt: iso(r["eval_at"])!,
          rulesVersion: (r["eval_version"] as number | null) ?? null,
        }
      : null,
  }));
}
